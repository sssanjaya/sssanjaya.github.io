---
title: "Node spawnSync hangs testing a script against a mock API"
description: "spawnSync blocks the Node event loop, so a mock HTTP server in the same process never answers the child. Use async spawn and await the close event."
date: 2026-09-30
tags: [testing, javascript, cloudflare, ci]
takeaways:
  - "spawnSync blocks the parent's event loop until the child exits, so an HTTP server in the same process cannot answer the child's requests."
  - "With a timeout set, a deadlocked spawnSync returns status null, signal SIGTERM, and error code ETIMEDOUT with empty stderr."
  - "Running the child with async spawn and awaiting its close event lets the mock server answer while the script runs."
  - "Reading the API base URL from an environment variable, like CF_API in this repo's Cloudflare scripts, lets a test point a real script at a local mock without changing its code."
  - "A mock that records every request lets a test assert what the script sent, not only what it printed."
---

If a test starts a mock HTTP server with Node's `http` module and then runs the script under test with `child_process.spawnSync`, the test hangs. `spawnSync` blocks the parent's event loop until the child exits, and the mock server needs that same event loop to answer the child's requests. The fix is to run the child with async `spawn` and await its `close` event, so the server keeps handling requests while the script runs.

This came up while testing the two Cloudflare scripts in `infra/cloudflare/`, which set this site's security headers and HSTS (HTTP Strict Transport Security) value. What they do is covered in [security headers and HSTS preload as code](/security-headers-and-hsts-preload-as-code/). This post is about how to test them without touching the real Cloudflare application programming interface (API).

## Pointing a real script at a mock with one environment variable

Both scripts read their API base URL from `CF_API` and fall back to Cloudflare's:

```js
const API = process.env.CF_API ?? "https://api.cloudflare.com/client/v4";
const TOKEN = process.env.CLOUDFLARE_ZONE_TOKEN;
const ZONE = process.env.CF_ZONE_NAME ?? "sanjayhona.com.np";
```

The `Env:` comment in `security-headers.mjs` names the purpose: `CF_API  optional API base (tests)`. Every request goes through one helper that builds the URL as `` `${API}${path}` ``, so setting `CF_API=http://127.0.0.1:<port>` sends every call to a local server. The script itself does not change, and the test runs the same file the workflow runs.

The commit messages for both scripts record what was tested this way. For `security-headers.mjs`: an empty zone, existing rules kept with ours updated in place, and a bad token failing before any write. For `hsts.mjs`: a 6-month value patched, an already-at-target value skipped, and a bad token failing before writing.

## spawnSync hangs with a local HTTP server

The first test setup ran the script with `spawnSync` and deadlocked. This minimal version reproduces it. It starts a server on a random port, then runs the script:

```js
import http from "node:http";
import { spawnSync } from "node:child_process";

const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ success: true, result: [] }));
});
server.listen(0, "127.0.0.1", () => {
  const { port } = server.address();
  const r = spawnSync("node", ["infra/cloudflare/hsts.mjs"], {
    env: { ...process.env, CF_API: `http://127.0.0.1:${port}`, CLOUDFLARE_ZONE_TOKEN: "test" },
    encoding: "utf8",
    timeout: 5000,
  });
  console.log({ status: r.status, signal: r.signal, error: r.error?.code, stderr: r.stderr });
  server.close();
});
```

On Node 22 this waits the full 5 seconds and prints:

```text
{ status: null, signal: 'SIGTERM', error: 'ETIMEDOUT', stderr: '' }
```

## Why the event loop is the problem

The server's listening socket exists, so the child's connection attempt is not refused. But the request handler is JavaScript in the parent process, and it only runs when the parent's event loop gets a turn. The Node docs for [`child_process.spawnSync()`](https://nodejs.org/api/child_process.html#child_processspawnsynccommand-args-options) state that it "will not return until the child process has fully closed", and the synchronous methods block the event loop while they wait.

So the parent waits for the child to exit, and the child waits for the parent to answer its `fetch`. Neither can move. The first request `hsts.mjs` makes is the zone lookup, so it never gets past that line.

The same applies to `execSync` and `execFileSync`. It does not apply when the mock runs in a separate process, because then the mock has its own event loop.

| Approach | Parent event loop while child runs | Mock in same process answers |
|---|---|---|
| `spawnSync`, `execSync`, `execFileSync` | Blocked | No |
| `spawn` with an awaited `close` event | Free | Yes |
| `util.promisify(execFile)` | Free | Yes |

## Running the child with async spawn

The fix keeps the same server and swaps the child call for [`spawn`](https://nodejs.org/api/child_process.html#child_processspawncommand-args-options). [`events.once()`](https://nodejs.org/api/events.html#eventsonceemitter-name-options) turns the `close` event into a promise that resolves with the exit code:

```js
async function run(script, env, args = []) {
  const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, ...env } });
  let stdout = "", stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  const [code] = await once(child, "close");
  return { code, stdout, stderr };
}
```

`close` fires after the process has exited and its stdio streams have closed, so `stdout` and `stderr` are complete when the promise resolves. `process.execPath` runs the same Node binary as the test, instead of whichever `node` is first on `PATH`.

With the mock from the previous section, which answers every request with an empty `result`, the same run finishes in under half a second:

```text
{ code: 1, stderr: '::error::zone sanjayhona.com.np not visible to this token\n' }
```

That is the correct result. An empty zone list is what the script's own check reports as `zone ... not visible to this token`, and it exits 1.

If you use `util.promisify(execFile)` instead, note that the promise rejects when the child exits non-zero. Tests that expect an exit code of 1 then need a `try`/`catch` to read it.

## A mock that routes and records requests

A catch-all response is enough to prove the loop is free. Real tests need different answers per call and a record of what the script sent. This version, written for this post and run against the current `hsts.mjs` with the built-in [`node:test`](https://nodejs.org/api/test.html) runner, maps `"METHOD /path"` to a handler and saves every request:

```js
async function mockApi(routes) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    const key = `${req.method} ${req.url}`;
    calls.push({ key, auth: req.headers.authorization, body });
    const [status, json] = routes[key]?.(body) ?? [404, { success: false, errors: [] }];
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(json));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { base: `http://127.0.0.1:${server.address().port}`, calls, close: () => server.close() };
}
```

Port `0` asks the operating system for a free port, so parallel tests do not collide. A test for the 6-month case then reads:

```js
const ok = (result) => [200, { success: true, errors: [], result }];
const sixMonths = { enabled: true, max_age: 15552000, include_subdomains: true, preload: true, nosniff: true };

test("patches a 6-month HSTS value to one year", async (t) => {
  const api = await mockApi({
    "GET /zones?name=example.com": () => ok([{ id: "z1" }]),
    "GET /zones/z1/settings/security_header": () => ok({ value: { strict_transport_security: sixMonths } }),
    "PATCH /zones/z1/settings/security_header": (body) => ok(body),
  });
  t.after(api.close);
  const r = await run("infra/cloudflare/hsts.mjs", {
    CF_API: api.base, CF_ZONE_NAME: "example.com", CLOUDFLARE_ZONE_TOKEN: "test",
  });
  assert.equal(r.code, 0, r.stderr);
  const patch = api.calls.find((c) => c.key.startsWith("PATCH"));
  assert.equal(patch.body.value.strict_transport_security.max_age, 31536000);
  assert.equal(patch.auth, "Bearer test");
});
```

The `PATCH` handler echoes the body back as `result`, because `hsts.mjs` prints `out.value.strict_transport_security` from the response. The assertions check the request, not the log line: the new `max_age` and the bearer token the script sent.

Swapping the `PATCH` handler for `() => [403, { success: false, errors: [{ code: 9109, message: "mock" }] }]` gives the failure case. The script exits 1 with:

```text
::error::PATCH /zones/z1/settings/security_header -> 403 9109: mock
```

That error format, and how it maps to missing token permissions, is the subject of [least-privilege Cloudflare API tokens](/cloudflare-api-token-least-privilege/).

## Checklist for testing a script against a local mock

1. Read the API base from an environment variable, with the real URL as the default.
2. Start the mock with `listen(0, "127.0.0.1")` and read the port from `server.address()`.
3. Run the script with `spawn` or a promisified `execFile`, never a `*Sync` call, when the mock shares the test's process.
4. Pass `process.execPath` as the command so the child uses the test's Node.
5. Record each request in the mock and assert on method, path, headers, and body.
6. Close the server in `t.after()` so a failed assertion does not leave it listening.

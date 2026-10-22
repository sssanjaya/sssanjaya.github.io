---
title: "CVE-2026-111770: MCP SDK Sent Alice's Result to Bob"
description: "MCP TypeScript server 2.0.0 to 2.2.0 routed HTTP responses by JSON-RPC id alone, so a shared server leaked results across clients. Upgrade to 2.3.0 and rewire."
date: 2026-10-22T01:59:24Z
tags: [mcp, ai-security, security, typescript]
takeaways:
  - "CVE-2026-111770 lets an MCP server built on @modelcontextprotocol/server 2.0.0 through 2.2.0 deliver one HTTP client's responses and notifications to another client."
  - "The transport matched responses to connections by JSON-RPC id alone, and SDK clients number requests from 0, so two clients collide on their first call."
  - "The vulnerable wiring, one McpServer created at startup and reused for every request, was the example in the README of the hono, express, fastify, and node adapter packages."
  - "Upgrading to 2.3.0 is not enough: 2.3.0 refuses shared instances, so the code must build a server per request, per session, or through a createMcpHandler factory."
  - "Building a new McpServer and transport inside the request handler fixes the leak on 2.2.0 as well."
---

Two clients call the same MCP (Model Context Protocol) server tool at the same moment. Both requests carry `"id":0`, and Bob gets back `"profile of alice"`. [GHSA-jm63-cq47-j5jp](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-jm63-cq47-j5jp) (CVE-2026-111770, published 2026-10-15) covers this in `@modelcontextprotocol/server` 2.0.0 through 2.2.0 over HTTP: upgrade to 2.3.0 and stop sharing one server or transport across requests.

<figure>
  <img src="/diagrams/mcp-sdk-shared-server-leak-sequence.svg" alt="Sequence diagram: Alice and Bob both send tools/call with id 0 to one shared transport. The map entry 0 to stream A is overwritten by 0 to stream B, so Alice's finished result is looked up as id 0, written to Bob's stream, and Alice gets no answer." width="900" height="600" loading="lazy" />
  <figcaption>One map keyed by JSON-RPC id serves every client. The second request with id 0 overwrites the first, and the next result for id 0 goes to whoever wrote last.</figcaption>
</figure>

## What the advisory says

The advisory's summary is short:

> In affected versions, an MCP server reached over HTTP could deliver one client's responses and notifications to another client. This happened when clients shared one stateless transport, or one `McpServer` or `Server` instance.

And the root cause:

> Messages were matched to a connection by JSON-RPC `id` alone. SDK clients number requests from 0, so ids collide in normal use.

GitHub's advisory rates it High, CVSS 3.1 score 7.7 (`AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:L/A:H`), filed as CWE-362, a race condition on a shared resource. The attack complexity is High because the leak needs two requests with the same id in flight at once. The advisory is explicit that the ids "collide in normal use", so any server with concurrent clients meets that condition.

## Why the README pattern leaked

The vulnerable wiring was not exotic. The advisory says that until the fix, the README examples of `@modelcontextprotocol/hono`, `express`, `fastify`, and `node` showed it. The `@modelcontextprotocol/node` 2.1.0 README on npm reads:

```ts
const server = new McpServer({ name: 'my-server', version: '1.0.0' });
const app = createMcpExpressApp();

app.post('/mcp', async (req, res) => {
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    // ...
    await transport.handleRequest(req, res, req.body);
});
```

The transport is fresh per request, but the `McpServer` is created once at startup. Every request reconnects the same server object, so a response that finishes late is written through whichever transport the server holds at that moment.

The shared-transport variant fails at a lower level. In the 2.2.0 build, the Streamable HTTP transport keeps a single `Map` from request id to stream:

```js
this._requestToStreamMapping.set(message.id, streamId);
// ... later, when the response is sent:
const streamId = this._requestToStreamMapping.get(requestId);
```

And the client side starts counting at zero (`_requestMessageId = 0;` in the shared protocol code). Two clients, two first calls, one key. Think of a coat check that hands out ticket number 0 to every guest: the last coat checked under 0 is the one everyone gets back.

## Reproducing CVE-2026-111770 locally

The lab uses Node 22.22.0 and plain `node:http`, with `@modelcontextprotocol/server` 2.2.0 and `@modelcontextprotocol/node` 2.1.0 for the vulnerable side, and server 2.3.0 with node 2.1.1 for the fixed side. The server registers one tool that waits `delayMs`, then returns the name it was given:

```js
// Pattern from the package README: one McpServer created at startup.
const server = new McpServer({ name: 'demo', version: '1.0.0' });
server.registerTool('get_profile', {
  inputSchema: { user: z.string(), delayMs: z.number() },
}, async ({ user, delayMs }) => {
  await new Promise(r => setTimeout(r, delayMs));
  return { content: [{ type: 'text', text: `profile of ${user}` }] };
});

createServer(async (req, res) => {
  const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}).listen(3000, '127.0.0.1');
```

The client fires two `tools/call` requests at once, both with `id: 0`. Alice's call takes 50 ms, Bob's takes 500 ms, and Alice sends first:

```js
const call = (user, delayMs) => fetch('http://127.0.0.1:3000/mcp', {
  method: 'POST',
  signal: AbortSignal.timeout(3000),
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'tools/call',
    params: { name: 'get_profile', arguments: { user, delayMs } } }),
});
for (const p of [call('alice', 50), call('bob', 500)]) p.then(print);
```

Running it against 2.2.0 with the README wiring shows Bob reading Alice's data:

```text
[128ms] bob received: HTTP 200 event: message data: {"result":{"content":[{"type":"text","text":"profile of alice"}]},"jsonrpc":"2.0","id":0}
[1922ms] alice received: nothing (TypeError)
```

With one stateless transport shared by all requests, the result is the same leak, and Alice waits until her client gives up:

```text
[147ms] bob received: HTTP 200 event: message data: {"result":{"content":[{"type":"text","text":"profile of alice"}]},"jsonrpc":"2.0","id":0}
[3005ms] alice received: nothing (TimeoutError)
```

Timing decides who loses. With the delays reversed (Alice slow, Bob fast), the same README server returned the right profile to each client. A test where the first request also finishes first never shows the bug.

## What 2.3.0 changes

On 2.3.0 the same README server no longer leaks. It refuses the second connection instead:

```text
[161ms] bob received: HTTP 500 Use a separate Server instance per connection: this instance is already connected to a transport. To connect it to a new transport, call close() first.
[159ms] alice received: HTTP 200 event: message data: {"result":{"content":[{"type":"text","text":"profile of alice"}]},"jsonrpc":"2.0","id":0}
```

The 500 and its text come from the lab handler catching the error `connect()` throws; the SDK's error code for it is `ALREADY_CONNECTED`. A shared stateless transport on 2.3.0 rejects every request after its first, even when they arrive one at a time:

```text
HTTP/1.1 200 OK            (first request)
HTTP/1.1 500 Internal Server Error
content-type: text/plain; charset=UTF-8
```

That is the advisory's warning in practice: "**You also need to change your code.** The SDK now refuses to be shared, so an affected app fails requests after upgrading."

<figure>
  <img src="/diagrams/mcp-sdk-shared-server-leak-lab.svg" alt="Grid of six lab runs. One server at startup: 2.2.0 leaks profile of alice to Bob, 2.3.0 returns HTTP 500 already connected. Shared stateless transport: 2.2.0 leaks, 2.3.0 returns HTTP 500. New server and transport per request: each client gets its own result on both versions." width="900" height="420" loading="lazy" />
  <figcaption>Red cells leak data, amber cells fail loudly, green cells are correct. Only the wiring change is green on both versions.</figcaption>
</figure>

## The fix that works on both versions

Building the server inside the handler fixes 2.2.0 too, which matches the advisory's note that "If you cannot upgrade yet, the same change fixes affected versions":

```js
const buildServer = () => {
  const server = new McpServer({ name: 'demo', version: '1.0.0' });
  server.registerTool('get_profile', /* same tool */);
  return server;
};

createServer(async (req, res) => {
  const server = buildServer();
  const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}).listen(3000, '127.0.0.1');
```

Running the same two-client test against this wiring on 2.2.0 and on 2.3.0 prints the same thing:

```text
[135ms] alice received: HTTP 200 event: message data: {"result":{"content":[{"type":"text","text":"profile of alice"}]},"jsonrpc":"2.0","id":0}
[136ms] bob received: HTTP 200 event: message data: {"result":{"content":[{"type":"text","text":"profile of bob"}]},"jsonrpc":"2.0","id":0}
```

The advisory lists three accepted shapes:

| Wiring | What to build |
|---|---|
| `createMcpHandler()` | Pass a factory that builds a new `McpServer` on every call |
| Per request | A new `McpServer` and a new transport inside the request handler |
| Per session | Set `sessionIdGenerator`, keep one `McpServer` and one transport per session |

It also lists what is not affected: `createMcpHandler()` with a per-call factory, stdio servers, and `@modelcontextprotocol/sdk` 1.26.0 and later.

<figure>
  <img src="/diagrams/mcp-sdk-shared-server-leak-check.svg" alt="Decision flow: over HTTP, on @modelcontextprotocol/server 2.0.0 to 2.2.0, with the McpServer or transport created once at startup means affected. No at any step means outside the advisory or not affected. Affected servers upgrade to 2.3.0 and change the wiring, since 2.3.0 rejects shared instances with ALREADY_CONNECTED." width="900" height="500" loading="lazy" />
  <figcaption>Three questions decide exposure. The version alone does not: wiring matters before and after the upgrade.</figcaption>
</figure>

## The other MCP SDK fixes published the same day

GitHub published two more TypeScript SDK advisories on 2026-10-15, both about memory exhaustion on HTTP servers:

| Advisory | Problem | Fixed in |
|---|---|---|
| [GHSA-46jr-4wx8-v453](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-46jr-4wx8-v453) (CVE-2026-111768, 7.5) | One request under the default 4 MiB body limit could exhaust memory during validation | sdk 1.32.0, server 2.3.0, plus opt-in `maxToolInputElements` |
| [GHSA-f897-62hf-6gxq](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-f897-62hf-6gxq) (no CVE, 7.5) | No limit on request body size or JSON-RPC batch length | sdk 1.30.1, server 2.1.0, node 2.1.0, hono 2.0.1 |

For GHSA-46jr-4wx8-v453 the advisory states: "Upgrading alone changes nothing." The new element limit is off by default and has to be set.

## What to do

1. Find HTTP MCP servers on `@modelcontextprotocol/server` 2.0.0 through 2.2.0: `npm ls @modelcontextprotocol/server` in each service.
2. Search the code for an `McpServer` or `NodeStreamableHTTPServerTransport` constructed outside the request handler, especially code copied from an adapter README before the fix.
3. Move construction into the handler, into a `createMcpHandler()` factory, or into a per-session map with `sessionIdGenerator` set. This closes the leak on 2.2.0 today.
4. Upgrade to `@modelcontextprotocol/server` 2.3.0 or later (2.3.1 is the current release on [npm](https://registry.npmjs.org/@modelcontextprotocol%2fserver) as of 2026-10-22), and watch for HTTP 500 responses or `ALREADY_CONNECTED` errors after deploy: they mean some path still shares an instance.
5. Test with two concurrent clients that both send `"id":0` and different tool latencies. Assert each client gets its own result.
6. While upgrading, set `maxToolInputElements` and review `maxRequestBodySize` for CVE-2026-111768.

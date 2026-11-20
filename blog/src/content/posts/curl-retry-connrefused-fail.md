---
title: "curl --retry Skips Connection Refused and 404s: A Lab"
description: "curl --retry 5 does not retry a refused connection or a 404, so wait-for-ready scripts fail in 0 s. Lab output, and the flag set that waits correctly."
date: 2026-11-20T11:08:33Z
tags: [curl, shell, deployments, reliability]
takeaways:
  - "curl --retry treats a refused connection as permanent, so a health check against a service that has not bound its port yet exits 7 in 0 seconds with no retries."
  - "curl --retry retries timeouts and HTTP 408, 429, 500, 502, 503 and 504, but not a 404, and without --fail a 404 exits 0 so the script thinks the service is up."
  - "The default backoff doubles from 1 second, so --retry 5 gives up after about 31 seconds of waiting, which is too short for a slow-starting service."
  - "When the body goes to stdout, every failed attempt's body stays in the output, so body=$(curl --retry 5 ...) can hold warming up twice before ok."
  - "A wait-for-ready check that behaves: curl -fsS --retry 60 --retry-connrefused --retry-delay 1 --retry-max-time 60 --max-time 5 -o /dev/null URL."
---

`curl --retry 5 http://127.0.0.1:8080/healthz` against a service that is still starting does not retry five times. It fails once, in 0 ms, with exit 7, and your deploy script moves on. The [curl man page](https://curl.se/docs/manpage.html#--retry-connrefused) says it plainly: "Normally, a refused connection is not considered a transient error". This lab runs curl 8.5.0, the version in [Ubuntu 24.04](https://packages.ubuntu.com/noble-updates/curl), against a small test server and shows which failures `--retry` actually retries, how long it waits, and the flag set that waits for real.

<figure>
  <img src="/diagrams/curl-retry-connrefused-fail-decision.svg" alt="Decision chart for curl --retry 5 on curl 8.5.0. Timeout (exit 28), DNS lookup failure (exit 6), and HTTP 408, 429, 500, 502, 503, 504 are retried. Connection refused (exit 7) is not retried and fails in 0 seconds. HTTP 404 is not retried and exits 0 unless --fail is set. --retry-all-errors retries everything." width="900" height="590" loading="lazy" />
  <figcaption>Three kinds of failure get retried. The two that a starting service produces most often, a refused connection and a 404 from a router with no routes yet, do not. Source: sandbox runs and the <a href="https://curl.se/docs/manpage.html#--retry">curl man page</a>.</figcaption>
</figure>

## What --retry counts as transient

The [`--retry` entry](https://curl.se/docs/manpage.html#--retry) defines the list: "Transient error means either: a timeout, an FTP 4xx response code or an HTTP 408, 429, 500, 502, 503, 504, 522 or 524 response code." The 522 and 524 codes arrived in [curl 8.17.0](https://curl.se/changes.html), so 8.5.0 does not retry those two.

Everything outside that list fails on the first attempt. Two cases matter for anyone who writes `until healthy; do ...` logic with curl:

- **Connection refused.** Nothing listens on the port yet. This is the normal state for the first seconds of every container and systemd service start.
- **HTTP 404.** The listener is up, but the route is not registered yet, or an ingress has no backend. curl received a complete reply, so by default it is not an error at all.

## Lab setup

The test server is about 20 lines of Python `http.server`. It runs in one of three modes: open the port late, answer 404 until warm, or answer 503 with `Retry-After: 3` until warm. Every command below ran on Ubuntu 24.04 with:

```text
curl 8.5.0 (x86_64-pc-linux-gnu) libcurl/8.5.0 OpenSSL/3.0.13 zlib/1.3 brotli/1.1.0 zstd/1.5.5 libidn2/2.3.7 libpsl/0.21.2 (+libidn2/2.3.7) libssh/0.10.6/openssl/zlib nghttp2/1.59.0 librtmp/2.3 OpenLDAP/2.6.10
```

`--no-progress-meter` hides the progress bar but keeps curl's retry warnings, which `-s` would hide. The `exit=` and `elapsed=` lines come from a small shell wrapper that prints `$?` and wall-clock time after each run.

## Run 1: the port opens 5 seconds late

Plain `--retry 5`:

```console
$ curl --no-progress-meter --retry 5 http://127.0.0.1:8080/healthz
curl: (7) Failed to connect to 127.0.0.1 port 8080 after 0 ms: Couldn't connect to server
exit=7 elapsed=0.0s
```

One attempt, no warning, exit 7. Add `--retry-connrefused`:

```console
$ curl --no-progress-meter --retry 5 --retry-connrefused http://127.0.0.1:8080/healthz
curl: (7) Failed to connect to 127.0.0.1 port 8080 after 0 ms: Couldn't connect to server
Warning: Problem : connection refused. Will retry in 1 seconds. 5 retries left.
curl: (7) Failed to connect to 127.0.0.1 port 8080 after 0 ms: Couldn't connect to server
Warning: Problem : connection refused. Will retry in 2 seconds. 4 retries left.
curl: (7) Failed to connect to 127.0.0.1 port 8080 after 0 ms: Couldn't connect to server
Warning: Problem : connection refused. Will retry in 4 seconds. 3 retries left.
ok
exit=0 elapsed=7.0s
```

For contrast, a name that does not resolve is retried without any extra flag. curl 8.5.0 logs it as a timeout:

```console
$ curl --no-progress-meter --retry 3 http://does-not-exist.invalid/
curl: (6) Could not resolve host: does-not-exist.invalid
Warning: Problem : timeout. Will retry in 1 seconds. 3 retries left.
```

## Run 2: the app answers 404 until it is warm

```console
$ curl --no-progress-meter --retry 5 http://127.0.0.1:8081/healthz
no route yet
exit=0 elapsed=0.0s
```

This is the worst result in the lab. curl exits 0, prints the error body, and a script that checks `$?` reports the service healthy. `--fail` turns the 404 into exit 22, but still does not retry it:

```console
$ curl --no-progress-meter --fail --retry 5 http://127.0.0.1:8081/healthz
curl: (22) The requested URL returned error: 404
exit=22 elapsed=0.0s
```

The man page for [`--retry-all-errors`](https://curl.se/docs/manpage.html#--retry-all-errors) covers this case: "If you want to retry on all response codes that indicate HTTP errors (4xx and 5xx) then combine with --fail." With both flags, the same server is retried until it answers 200, at 7.0 s. The same entry calls the flag the "sledgehammer" and says not to use it by default, because it retries everything, including errors that will never clear.

## Run 3: 503 with Retry-After

```console
$ curl --no-progress-meter --retry 5 http://127.0.0.1:8083/healthz
warming up
Warning: Problem : HTTP error. Will retry in 3 seconds. 5 retries left.
warming up
Warning: Problem : HTTP error. Will retry in 3 seconds. 4 retries left.
ok
exit=0 elapsed=6.0s
```

503 is on the transient list, so this works out of the box. curl waited 3 seconds each time, not 1 then 2, because the man page says curl "complies with the Retry-After: response header". Look at stdout, though: `warming up` appears twice before `ok`.

<figure>
  <img src="/diagrams/curl-retry-connrefused-fail-lab-results.svg" alt="Bar chart of seconds until curl exits in seven lab runs. Port opens at 5 s with --retry 5: 0.0 s, exit 7. With --retry-connrefused: 7.0 s, ok. 404 for 5 s with --retry 5: 0.0 s, exit 0 on a 404 body. With --fail --retry-all-errors: 7.0 s, ok. 503 with Retry-After 3: 6.0 s, ok. Port opens at 40 s with --retry 5 --retry-connrefused: 31.0 s, exit 7. With --retry 60 --retry-delay 1 --retry-max-time 60: 40.1 s, ok." width="960" height="642" loading="lazy" />
  <figcaption>The two 0.0 s bars are the dangerous ones: one fails a deploy for no reason, the other passes a broken one. Source: sandbox runs with curl 8.5.0 against a local Python test server.</figcaption>
</figure>

## Retried bodies pile up on stdout

The [`--retry` entry](https://curl.se/docs/manpage.html#--retry) explains it: "Before retrying, curl removes data that the failed attempt wrote to an output file set with --output or --remote-name. It cannot do that for data written to stdout, a pipe or a shell redirect". A script that captures the body sees every attempt:

```console
$ cat dup.sh
body=$(curl -sS --retry 5 http://127.0.0.1:8085/healthz)
printf '%s\n' "$body" | cat -A
$ bash dup.sh
warming up$
warming up$
ok$
```

Two fixes both work in the lab. Write to a file with `-o body.txt`, and the file holds only `ok`. Or add `-f`: the 503 bodies are suppressed, curl prints `curl: (22) The requested URL returned error: 503` to stderr for each attempt, and `$body` is `ok`.

## The backoff runs out before slow services start

Default backoff starts at 1 second and doubles. The man page says it caps at 10 minutes per wait. With `--retry 5`, the waits are 1, 2, 4, 8 and 16 seconds, so curl gives up 31 seconds after the first attempt. A service that needs 40 seconds to bind its port never gets checked again after the 15-second attempt, 25 seconds before it comes up.

<figure>
  <img src="/diagrams/curl-retry-connrefused-fail-backoff-timeline.svg" alt="Timeline of attempts. The service opens its port at 40 seconds. With --retry 5 --retry-connrefused, attempts fire at 0, 1, 3, 7, 15 and 31 seconds and curl exits 7 at 31.0 seconds. With --retry 60 --retry-connrefused --retry-delay 1 --retry-max-time 60, curl tries every second and gets ok at 40.1 seconds." width="960" height="400" loading="lazy" />
  <figcaption>Doubling backoff leaves a 16-second gap and stops at 31 s. A fixed 1-second delay with a time cap catches the port the second it opens. Source: sandbox runs with curl 8.5.0.</figcaption>
</figure>

Bounding by time instead of by count fixes this. `--retry-delay 1` replaces the doubling with a fixed wait, and [`--retry-max-time`](https://curl.se/docs/manpage.html#--retry-max-time) stops retrying once the total passes the limit. Set `--retry` high so the time cap is what ends the loop:

```console
$ curl -fsS --retry 60 --retry-connrefused --retry-delay 1 --retry-max-time 60 --max-time 5 -o /dev/null http://127.0.0.1:8091/healthz
curl: (7) Failed to connect to 127.0.0.1 port 8091 after 0 ms: Couldn't connect to server
[38 more identical lines]
exit=0 elapsed=40.1s
```

That run printed 40 refused attempts, then succeeded. `--max-time 5` matters too: the man page notes that a transfer already in progress "is allowed to run to completion even if this makes the total wall clock time exceed the limit", so a hung request needs its own cap.

## Flag reference for wait-for-ready checks

| Flag | What it changes | Use in a readiness check |
| --- | --- | --- |
| `--retry-connrefused` | Retries ECONNREFUSED | Yes, a starting service refuses connections |
| `-f`, `--fail` | 4xx and 5xx exit 22, body suppressed | Yes, so a 404 is not exit 0 |
| `--retry-all-errors` | Retries every error, with `-f` also 4xx | Only when a 404 is a normal warm-up state |
| `--retry-delay 1` | Fixed wait, no doubling | Yes, keeps checks frequent |
| `--retry-max-time 60` | Total retry budget in seconds | Yes, size it to the real start time |
| `--max-time 5` | Caps each single attempt | Yes, so one hang cannot eat the budget |

## What to do

1. Grep your deploy scripts, CI jobs, Dockerfiles and Helm hooks for `curl` with `--retry` and without `--retry-connrefused`: `grep -rn -- '--retry' . | grep -v -- '--retry-connrefused'`.
2. Add `-f` (or `--fail-with-body` if you need the body for logs) to every curl call whose exit code gates a deploy.
3. Replace count-based waits with a time budget: `--retry 60 --retry-delay 1 --retry-max-time <seconds>`, where the seconds come from the slowest start you have seen, plus margin.
4. Add `--max-time` so a single hung attempt cannot block the loop.
5. Never capture a retried body from stdout. Use `-o file` or `-f` so failed attempts do not end up in the output.
6. If your app returns 404 while warming up, prefer a dedicated readiness endpoint that returns 503 until ready. 503 is retried by default and honors `Retry-After`, so you do not need `--retry-all-errors`.

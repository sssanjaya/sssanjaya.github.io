---
title: "OpenTelemetry JS SDK 3.0 RC: OTEL_ sampler vars ignored"
description: "OpenTelemetry JS SDK 3.0.0-rc.0 drops env var config from the trace SDK, so hand-built tracers ignore OTEL_TRACES_SAMPLER. Check your setup before upgrading."
date: 2026-10-20T10:06:32Z
tags: [opentelemetry, observability, sre, nodejs]
takeaways:
  - "The OpenTelemetry JS SDK 3.0 release candidate, published to npm on October 13, 2026, replaces sdk-trace-base, sdk-trace-node, and sdk-trace-web with a single @opentelemetry/sdk-trace package."
  - "The @opentelemetry/sdk-trace package does not read OTEL_TRACES_SAMPLER, OTEL_TRACES_SAMPLER_ARG, the OTEL_BSP_* batch variables, or the span limit variables."
  - "A service that builds its own TracerProvider and sets a ratio sampler only through environment variables records every root span after moving to sdk-trace."
  - "NodeSDK from @opentelemetry/sdk-node still reads the OTEL_ environment variables in 0.300.0-rc.0, so it is the migration path for env-var-based configuration."
  - "SDK 3.0 requires Node.js 22.15.0 or later, and deep imports into package build folders fail with ERR_PACKAGE_PATH_NOT_EXPORTED."
---

The OpenTelemetry JavaScript SDK 3.0 release candidate shipped to npm on October 13, 2026, and its new `@opentelemetry/sdk-trace` package no longer reads `OTEL_` environment variables. Any Node.js service that builds its own tracer provider and sets sampling or batch limits only through env vars will lose those settings on upgrade, and a 10% ratio sampler becomes 100%. Find those services now, and either move them to `NodeSDK` or set the sampler and limits in code.

## What shipped on October 13

The [npm registry record for `@opentelemetry/sdk-trace`](https://registry.npmjs.org/@opentelemetry/sdk-trace) shows `3.0.0-rc.0` published at 21:24 UTC on October 13, 2026, under the `canary` tag. The `latest` tag still points to `2.12.0` as of October 20, 2026. The same day, `@opentelemetry/api` `1.10.0-rc.0`, `@opentelemetry/core` `3.0.0-rc.0`, and `@opentelemetry/sdk-node` `0.300.0-rc.0` were published.

The final release date has moved once. The project's [planning issue #6926](https://github.com/open-telemetry/opentelemetry-js/issues/6926) now lists "SDK 3.0 release: October 15, 2026 (original plan was: September 30, 2026)". That date has passed and 3.0.0 is not on npm yet, so treat the timing as still developing. The issue also says "2.x will continue to receive high-severity bugfix and security releases until October 15, 2027".

The breaking changes are spread across the [main CHANGELOG](https://github.com/open-telemetry/opentelemetry-js/blob/main/CHANGELOG.md), the [experimental packages CHANGELOG](https://github.com/open-telemetry/opentelemetry-js/blob/main/experimental/CHANGELOG.md), and the [3.x migration guide](https://github.com/open-telemetry/opentelemetry-js/blob/main/doc/3.x/migration-guide.md). The ones that affect running services:

| Change | What breaks |
| --- | --- |
| `sdk-trace-base`, `sdk-trace-node`, `sdk-trace-web` removed | Imports fail. Replace with `@opentelemetry/sdk-trace`. |
| `sdk-trace` ignores `OTEL_` env vars | Sampler, batch, and limit settings set by env var stop applying. No error. |
| `BatchSpanProcessor` and `SimpleSpanProcessor` take an options object | Old positional form fails at export time in plain JavaScript. |
| Node.js floor raised to `>=22.15.0` | Node.js 18 and 20 services cannot upgrade. |
| `exports` maps on every package | Deep imports such as `@opentelemetry/core/build/src/...` fail. |
| Jaeger exporter and propagator removed | Move to OTLP export and W3C `traceparent`. |
| `@opentelemetry/api-logs` folded into `@opentelemetry/api` | Logs API imports change. |
| `NodeSDK` singular options removed | `spanProcessor`, `metricReader`, `logRecordProcessor` become arrays. |

## Why sampling silently changes

In 2.x, `BasicTracerProvider` and `NodeTracerProvider` fall back to environment variables when no option is passed. The migration guide lists the variables `TracerProvider` in `sdk-trace` no longer reads: `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG`, the four `OTEL_BSP_*` batch variables, and the `OTEL_ATTRIBUTE_*` and `OTEL_SPAN_*` limits. In its words, "Roughly speaking sdk-trace is the same as sdk-trace-base, but with any reading of environment variables removed."

The guide recommends the `sdk-node` package for env var support. The [3.x announcement](https://github.com/open-telemetry/opentelemetry-js/blob/main/doc/3.x/announcement.md) gives the reason: the trace SDK supported env var configuration that the logs and metrics SDKs did not.

A sandbox test on Node.js 22 confirms it. With `OTEL_TRACES_SAMPLER=traceidratio` and `OTEL_TRACES_SAMPLER_ARG=0.1`, each setup started 10,000 root spans:

![Bar chart: with a 10% ratio sampler set by env var, BasicTracerProvider 2.12.0 recorded 976 of 10,000 spans, NodeTracerProvider 2.12.0 recorded 909, NodeSDK 0.300.0-rc.0 recorded 989, and TracerProvider from sdk-trace 3.0.0-rc.0 and 2.12.0 recorded all 10,000.](/diagrams/opentelemetry-js-sdk-3-sampler-env.svg)

Two results matter for operators:

- **The change already applies on 2.x.** `@opentelemetry/sdk-trace` `2.12.0` is a 2.x release and also ignores the variables. A team that moved early to the new package and sets its sampler by env var may already be sampling at 100%.
- **Batch limits reset too.** With `OTEL_BSP_MAX_QUEUE_SIZE=100`, the `BatchSpanProcessor` from `sdk-trace-base` 2.12.0 used a queue of 100. The 3.0.0-rc.0 one used the default of 2048.

The effect lands on the backend: more spans exported, higher ingest cost, more load on collectors and tail samplers. Nothing in the application logs it.

## The BatchSpanProcessor constructor trap

The migration guide changes the constructor from `new BatchSpanProcessor(anExporter, otherOptions)` to `new BatchSpanProcessor({ exporter: anExporter, ...otherOptions })`. In the sandbox, plain JavaScript using the old form against 3.0.0-rc.0 constructed without error. The first flush then rejected with:

```text
TypeError: Cannot read properties of undefined (reading 'export')
```

No spans were exported. The new form exported normally. Search for the old call shape before upgrading, since startup will not catch it.

## Deep imports and bundlers

Every package now ships an `exports` map. In the sandbox, `require('@opentelemetry/core/build/src/index.js')` under 3.0.0-rc.0 failed with:

```text
ERR_PACKAGE_PATH_NOT_EXPORTED Package subpath './build/src/index.js' is not defined by "exports"
```

The rc.0 CHANGELOG also replaces the `browser` field with `#platform` subpath imports. The migration guide says webpack 5 needs 5.54 or later, Jest needs 29.4 or later, and a bundle built for Node.js without the `node` condition (for example esbuild `platform: 'neutral'`) gets the browser build. Check Node.js services and functions that ship as bundles.

## What to check

### 1. Find code that uses removed packages or deep imports

```bash
grep -rnE "@opentelemetry/(sdk-trace-(base|node|web)|exporter-jaeger|propagator-jaeger|shim-opentracing|shim-opencensus|api-logs)['\"/]|@opentelemetry/[a-z-]+/build/" \
  --include='*.js' --include='*.cjs' --include='*.mjs' --include='*.ts' \
  --exclude-dir=node_modules .
```

Then check transitive use, since distributions and internal wrapper libraries often pull these in:

```bash
npm ls @opentelemetry/sdk-trace-base @opentelemetry/sdk-trace-node @opentelemetry/exporter-jaeger --all
```

### 2. Find services that rely on env vars for trace settings

List every deployment that sets `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG`, or `OTEL_BSP_*` and does not start the SDK through `NodeSDK`. For those, pick one fix:

- Switch to `NodeSDK` from `@opentelemetry/sdk-node`. In the sandbox, `0.300.0-rc.0` still applied the ratio sampler from env vars (989 of 10,000 spans).
- Keep `TracerProvider` and pass the sampler, `spanLimits`, and batch options in code.

### 3. Measure span volume across the upgrade

Record span volume per service in your tracing backend before and after each upgrade. A jump close to `1 / ratio` for one service means its sampler stopped applying.

### 4. Plan the runtime and propagation work

- Move Node.js 18 and 20 services to 22.15.0 or later first.
- If any service still sends `uber-trace-id`, the guide warns that switching only some services "will break distributed traces". It suggests migrating all services together or running both propagators with `CompositePropagator` during the move.
- 2.x gets high-severity and security fixes until October 15, 2027, so there is time to do this in order.

The Claude Code post on [auditing auto mode with OpenTelemetry events](/claude-code-opentelemetry-auto-mode-audit/) covers a related problem: attribute limits that quietly drop data before it reaches the backend.

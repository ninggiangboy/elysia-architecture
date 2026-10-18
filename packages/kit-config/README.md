# @kit/config

## Purpose

Typed configuration made of slices. Each package or module owns the environment variables it reads (`defineSlice`), `loadConfig` parses them all against one environment and fails once with every problem, and `.env.example` is generated from the slices.

## Install

```bash
bun add @kit/config
```

Inside this repository it is a workspace package; outside, a build in `dist/` is what you get (`bun run build`).

## Ports

Defines `ConfigSlice`. No ports: it is a library.

## Configuration

<!-- config:start -->
_Generated from the config slice by `bun scripts/package-docs.ts`; the reference app's `.env.example` lists the same variables._

| Variable | Default | Description |
| --- | --- | --- |
| `NODE_ENV` | `production` | Runtime mode. The OpenAPI docs are served only in development. |
| `PORT` | `3000` | Port the API listens on. |
| `APP_ROLES` | `api,worker` | `api` serves HTTP; `worker` runs the outbox relay and with it every event handler, including the heavy ones (avatar thumbnails). Split them: `api` on web boxes, `worker` on their own. |
| `APP_PROCESSES` | `1` | Cluster mode: processes sharing PORT (a number, or `auto` = 3/4 of the CPUs, min 2 so a crash never takes the whole instance down). 1 = single process, no supervisor. DB_POOL_MAX is per process. |
| `PROCESS_SLOT` | unset | Set by the cluster supervisor (0-based); the outbox relay only runs in slot 0. Do not set by hand. |
| `LOG_LEVEL` | `info` | Log verbosity. |
| `WEB_APP_URL` | `http://localhost:5173` | Where the web app is served: links in mails, OAuth redirects, WebAuthn defaults. |
| `CORS_ORIGINS` | `(empty)` | Origins allowed to call the API from a browser, comma separated. |
<!-- config:end -->

## Tables and migrations

None.

## Wiring

```ts
import { defineSlice, loadConfig, posInt } from '@kit/config'
import { z } from 'zod'

const jobs = defineSlice({
  title: 'Jobs',
  schema: z.object({ JOBS_INTERVAL_SECONDS: posInt(30).describe('How often the jobs look for work.') }),
})

const config = loadConfig({ jobs }, process.env) // throws once, listing every invalid variable of every slice
config.jobs.JOBS_INTERVAL_SECONDS
```

## Guarantees

Every variable of a slice is described with `.describe(...)`; `renderEnvExample` writes the sample file from them, so it cannot drift (the app has a test that compares).

## Limits

Slices are plain zod objects: one `superRefine` per slice for cross-field rules (`allOrNone` for features that switch on together). A transform on the whole slice would hide its shape from the example generator.

## Related

[Enforced architecture boundaries](../../docs/patterns/enforced-architecture-boundaries.md)

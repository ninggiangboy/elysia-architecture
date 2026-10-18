# @kit/auth

## Purpose

The consumer side of authentication: verify a JWT, expose `auth` / `authOptional` macros on Elysia routes, check that a sensitive action follows a recent login (`StepUpPolicy`), and the HMAC helpers. Issuing tokens stays in `@mod/identity`.

## Install

```bash
bun add @kit/auth
```

Inside this repository it is a workspace package; outside, a build in `dist/` is what you get (`bun run build`).

## Ports

Defines `TokenVerifier`. Implemented by identity's `JwtTokenService`; a service that only verifies needs nothing else.

## Configuration

<!-- config:start -->
None: this package reads no environment variables.
<!-- config:end -->

## Tables and migrations

None.

## Wiring

```ts
import { authPlugin } from '@kit/auth'

new Elysia({ prefix: '/things' })
  .use(authPlugin(verifier))
  .get('/', ({ auth }) => list(auth.userId), { auth: true })
```

## Guarantees

`StepUpPolicy.assertFresh(authTime)` answers `403 step_up_required` when the login is older than the window.

## Limits

Bearer tokens only.

## Related

[Step-up authentication](../../docs/patterns/step-up-authentication.md)

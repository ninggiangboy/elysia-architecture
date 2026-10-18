# @mod/identity

## Purpose

Passwordless sign-in (magic link, passkeys, Google and GitHub), rotating refresh tokens with reuse detection, sessions, step-up confirmation, email change and the JWKS.

## Install

```bash
bun add @mod/identity
bun run kit:add identity        # wires it into the app: catalog, container, routes and the integrations of what is installed
bun run db:migrate
```

Requires: nothing but the kit.

## Ports

The factory takes the host's building blocks (`ModuleHost`: database, clock, ids, storage, mailer, config) and the modules it depends on; `install(host)` is the one entry the app calls. Cross-module calls go through `@mod/identity/contracts` only.

## Configuration

<!-- config:start -->
_Generated from the config slice by `bun scripts/package-docs.ts`; the reference app's `.env.example` lists the same variables._

| Variable | Default | Description |
| --- | --- | --- |
| `WEB_APP_URL` | `http://localhost:5173` | Where the web app is served (same value as the core section): the OAuth redirect is `<WEB_APP_URL>/auth/oauth/callback`, and WebAuthn defaults follow it. |
| `JWT_PRIVATE_KEY` | **required** | ES256 private key (PKCS8 PEM, newlines as \n). |
| `JWT_PUBLIC_KEY` | **required** | ES256 public key (SPKI PEM, newlines as \n). |
| `JWT_KID` | `dev-1` | Key id published in the JWKS. |
| `JWT_ISSUER` | `elysia-architecture` | `iss` of the access tokens. |
| `JWT_AUDIENCE` | `elysia-architecture-web` | `aud` of the access tokens. |
| `ACCESS_TOKEN_TTL` | `15m` | Lifetime of an access token. |
| `REFRESH_TOKEN_TTL` | `30d` | Lifetime of a refresh token (a session). |
| `STEP_UP_TTL` | `5m` | How long after signing in (or confirming again) sensitive actions — change email, add/remove a sign-in method — are allowed; after that the API answers 403 step_up_required. |
| `STEP_UP_CODE_SECRET` | **required** | Key for hashing the emailed step-up codes (HMAC, 32+ chars). Changing it invalidates the codes in flight (they live 10 minutes). |
| `WEBAUTHN_RP_ID` | unset | WebAuthn relying party id; defaults to the host of WEB_APP_URL. Changing it makes every registered passkey unusable. |
| `WEBAUTHN_RP_NAME` | `Elysia Architecture` | Relying party name shown by the browser. |
| `WEBAUTHN_ORIGINS` | unset | Origins the browser may report during a passkey ceremony; defaults to the origin of WEB_APP_URL. |
| `GOOGLE_CLIENT_ID` | unset | Sign in with Google: a provider is on only when both its id and secret are set. Register `<WEB_APP_URL>/auth/oauth/callback` as the redirect URI. |
| `GOOGLE_CLIENT_SECRET` | unset | Google client secret. |
| `GITHUB_CLIENT_ID` | unset | Sign in with GitHub (same rule as Google). |
| `GITHUB_CLIENT_SECRET` | unset | GitHub client secret. |
| `MAGIC_LINK_MAX_PER_EMAIL` | `3` | Magic links one address can ask for within the throttle window. |
| `MAGIC_LINK_MAX_PER_IP` | `10` | Magic links one IP can ask for within the throttle window. |
<!-- config:end -->

## Tables and migrations

Schema `identity`: users, magic links, refresh tokens, passkeys, OAuth accounts and states, step-up codes, WebAuthn challenges, email-change requests, magic-link throttle, plus the outbox and inbox.

Migrations ship in `migrations/` and are applied by `bun run db:migrate` from the module's manifest (`@mod/identity/manifest`).

## Events

`identity.user_registered.v1`, `session_started`, `session_revoked`, `email_changed`, `email_change_requested`, `magic_link_requested`, `step_up_code_requested`, `passkey_added`/`removed`, `oauth_account_linked`/`unlinked`, and the privacy answers.

## Wiring

```ts
const identity = use(await installIdentity(host))
// identity.api (IdentityApi), identity.verifier (TokenVerifier), identity.stepUp
```

## Extension points

Adapters (`overrides: { webauthn, oauth }`), the config slice (token lifetimes, keys, providers), the integrations it ships for notification (mails and in-app messages) and realtime (`session.revoked`), and app handlers on its events.

Anything else (hooks inside a use case, changing a domain rule, changing a table) changes the module's invariants: eject it. Copy the package into `modules/identity`, rename it `@app/identity`, point the app's imports at it and keep the schema name and the `migrations/` folder, so the database is untouched. From then on the copy is yours and upstream CHANGELOG entries are merged by hand.

## Guarantees

Refresh tokens rotate on use and reuse revokes the session; sensitive actions need a recent confirmation; the token issuer is the only place that signs.

## Limits

ES256 keys only; one issuer.

## Related

[Modules and boundaries](../../docs/architecture/01-modules-and-boundaries.md) · [Adopt in a new project](../../docs/guides/adopt-in-new-project.md)

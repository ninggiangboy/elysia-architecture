# @mod/identity

## Purpose

Sign-in and sign-up (emailed link or code, password, passkeys, Google, GitHub, Microsoft, Discord and any OpenID Connect provider), who may register (open, by invitation, closed, domains, terms), two-factor with an authenticator app, rotating refresh tokens with reuse detection, sessions, step-up confirmation, email change and the JWKS.

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
| `MICROSOFT_CLIENT_ID` | unset | Sign in with Microsoft (Entra ID, same rule as Google). Only personal accounts, and work accounts whose tenant sends the `xms_edov` claim, have an email Microsoft vouches for. |
| `MICROSOFT_CLIENT_SECRET` | unset | Microsoft client secret. |
| `MICROSOFT_TENANT` | `common` | `common` (any account), `consumers`, `organizations` or one tenant id. |
| `DISCORD_CLIENT_ID` | unset | Sign in with Discord (same rule as Google). |
| `DISCORD_CLIENT_SECRET` | unset | Discord client secret. |
| `OIDC_PROVIDERS` | unset | Any OpenID Connect provider (Keycloak, Auth0, Okta…), as a JSON array of `{"id","name","issuer","clientId","clientSecret","scopes"?}`. Endpoints come from the issuer's discovery document; the provider must send `email_verified`. |
| `SIGN_IN_METHODS` | `email,password,passkey` | Ways to sign in, comma-separated: `email` (a link and a code by mail), `password`, `passkey`. OAuth providers are on when their credentials are set. |
| `REGISTRATION_MODE` | `open` | `open`: anyone can create an account; `invite`: only addresses a member invited; `closed`: no new accounts. |
| `REGISTRATION_EMAIL_DOMAINS` | unset | Only addresses at these domains may create an account (comma-separated); unset = any domain. |
| `REGISTRATION_ALLOWED_EMAILS` | unset | Addresses that may always create an account, also when the mode is `invite` or `closed` (the owner who seeds the app). |
| `TERMS_VERSION` | unset | When set, creating an account requires accepting these terms; the version is recorded on the account. |
| `TERMS_URL` | unset | Where the terms are published, linked from the sign-up page. |
| `PASSWORD_MIN_LENGTH` | `8` | Shortest password accepted (at most 128). |
| `TOTP_ENCRYPTION_KEY` | unset | Two-factor authentication with an authenticator app is on when set: the key (32+ chars) that encrypts the stored TOTP secrets. Changing it locks every enrolled account out of password and email sign-in until the old key is back; unset, two-factor is off. |
| `TOTP_ISSUER` | unset | Name the authenticator app shows next to the code; defaults to WEBAUTHN_RP_NAME. |
| `MAGIC_LINK_MAX_PER_EMAIL` | `3` | Magic links one address can ask for within the throttle window. |
| `MAGIC_LINK_MAX_PER_IP` | `10` | Magic links one IP can ask for within the throttle window. |
<!-- config:end -->

## Tables and migrations

Schema `identity`: users (with an optional password hash and the accepted terms), magic links (with their code), refresh tokens, passkeys, OAuth accounts and states, the authenticator app (`totp_credentials`, secret encrypted) and recovery codes, invitations, step-up codes, WebAuthn challenges, email-change requests, and the short-lived `signups`, `password_resets`, `mfa_challenges` and `sign_in_failures`, plus the outbox and inbox.

Migrations ship in `migrations/` and are applied by `bun run db:migrate` from the module's manifest (`@mod/identity/manifest`).

## Events

`identity.user_registered.v1` (with the chosen `displayName` and the `method`), `session_started` (with `method` and `secondFactor`), `session_revoked`, `email_changed`, `email_change_requested`, `magic_link_requested` (with the `code`), `signup_verification_requested`, `signup_existing_account`, `password_reset_requested`, `password_changed`, `two_factor_enabled`/`disabled`, `invitation_sent`, `step_up_code_requested`, `passkey_added`/`removed`, `oauth_account_linked`/`unlinked`, and the privacy answers.

## Wiring

```ts
const identity = use(await installIdentity(host))
// identity.api (IdentityApi), identity.verifier (TokenVerifier), identity.stepUp
```

## Extension points

Adapters (`overrides: { webauthn, oauth, hasher }`), the config slice (token lifetimes, keys, providers), the integrations it ships for notification (mails and in-app messages) and realtime (`session.revoked`), and app handlers on its events.

Anything else (hooks inside a use case, changing a domain rule, changing a table) changes the module's invariants: eject it. Copy the package into `modules/identity`, rename it `@app/identity`, point the app's imports at it and keep the schema name and the `migrations/` folder, so the database is untouched. From then on the copy is yours and upstream CHANGELOG entries are merged by hand.

## Guarantees

Refresh tokens rotate on use and reuse revokes the session; sensitive actions need a recent confirmation; the token issuer is the only place that signs; accounts are created in one place (`AccountRegistrar`) and only for an email the person has proven; no change can remove the last way to sign in; a one-time code or token is consumed by a single statement.

## Limits

ES256 keys only; one issuer. Passwords are checked for length, not against breaches. TOTP is SHA-1/6 digits/30 s with one encryption key and no rotation; there is no SMS, SAML or WebAuthn-as-second-factor. See [trade-offs and known gaps](../../docs/architecture/13-trade-offs-and-known-gaps.md).

## Related

[Modules and boundaries](../../docs/architecture/01-modules-and-boundaries.md) · [Adopt in a new project](../../docs/guides/adopt-in-new-project.md)

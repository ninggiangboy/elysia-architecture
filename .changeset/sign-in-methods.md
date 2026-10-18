---
'@mod/identity': minor
'@kit/auth': minor
'@mod/profile': patch
---

Identity: more ways to sign up and sign in, and rules for who may.

- Password sign-in and sign-up (argon2id, email verification, forgotten password, set/remove from settings).
- A 6-digit code in the magic-link mail, so the link can be finished on another device.
- Two-factor with an authenticator app (TOTP) and recovery codes; the app, the password and the code are also step-up methods.
- OAuth providers are a registry: Google, GitHub, Microsoft, Discord, and any OpenID Connect provider from `OIDC_PROVIDERS`.
- Registration policy: `REGISTRATION_MODE` (open, invite, closed), an email-domain allow-list, terms to accept, invitations.
- `@kit/auth` gains the TOTP primitives (`newTotpSecret`, `verifyTotp`, `totpUri`).
- New migration `0004_identity_sign_in_methods` (new tables, new columns on `users` and `magic_links`), new config (see the module README), new events (additive). `GET /auth/oauth/providers` now answers `{ providers, names }`, and the sign-in endpoints answer `status: 'authenticated' | 'mfa_required' | 'signup_required'`.
- `@mod/profile` uses the display name chosen at sign-up.

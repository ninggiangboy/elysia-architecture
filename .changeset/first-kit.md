---
'@kit/auth': minor
'@kit/config': minor
'@kit/context': minor
'@kit/core': minor
'@kit/db': minor
'@kit/http': minor
'@kit/i18n': minor
'@kit/mail': minor
'@kit/messaging': minor
'@kit/privacy-participant': minor
'@kit/runtime': minor
'@kit/storage': minor
'@kit/telemetry': minor
'@kit/testing': minor
'@kit/ui': minor
'@kit/web-core': minor
'@mod/billing': minor
'@mod/identity': minor
'@mod/notification': minor
'@mod/privacy': minor
'@mod/profile': minor
'@mod/realtime': minor
---

First cut of the kit: the reference app split into infrastructure packages (`@kit/*`) and business modules (`@mod/*`), each
with an exports map, its own tests, and (for modules) a manifest, an `install(host)` and a `kit.json` for `bun run kit:add`.

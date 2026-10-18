# @kit/privacy-participant

## Purpose

The protocol a module speaks to take part in a data export or an account erasure, so participants depend on this and not on the `privacy` module: the two request events, the answer convention and `privacyParticipation()`.

## Install

```bash
bun add @kit/privacy-participant
```

Inside this repository it is a workspace package; outside, a build in `dist/` is what you get (`bun run build`).

## Ports

Defines `DataExporter` and `DataEraser`; builds the `<module>.export-user-data` / `<module>.erase-user-data` handlers.

## Configuration

<!-- config:start -->
None: this package reads no environment variables.
<!-- config:end -->

## Tables and migrations

None.

## Wiring

```ts
import { privacyParticipation } from '@kit/privacy-participant'

const participation = privacyParticipation({
  module: 'orders', storage, outbox, inbox, clock,
  export: { exporter: new OrdersExporter(), answerType: 'orders.data_exported.v1' },
  erase: { eraser: new OrdersEraser(), answerType: 'orders.user_data_erased.v1' },
})
// handlers: [...participation.handlers], privacy: participation.privacy
```

## Guarantees

Event type strings are written to outbox rows and inbox keys: they never change in place (add a `.v2`). Erasing and confirming commit together.

## Limits

The coordinator (`@mod/privacy`) is one implementation of this protocol; another could orchestrate it differently.

## Related

[Choreographed saga](../../docs/patterns/choreographed-saga-with-ledger.md)

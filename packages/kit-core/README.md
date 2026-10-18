# @kit/core

## Purpose

The vocabulary every other package shares: domain events, the aggregate root, domain and application errors, the small ports use cases are written against (`Clock`, `IdGenerator`, `UnitOfWork`, `Log`) and their system implementations.

## Install

```bash
bun add @kit/core
```

Inside this repository it is a workspace package; outside, a build in `dist/` is what you get (`bun run build`).

## Ports

Defines `Clock`, `IdGenerator`, `UnitOfWork`, `Log`. Implements `Clock` and `IdGenerator` as `SystemClock` and `UuidV7Generator`.

## Configuration

<!-- config:start -->
None: this package reads no environment variables.
<!-- config:end -->

## Tables and migrations

None.

## Wiring

```ts
import { SystemClock, UuidV7Generator } from '@kit/core'

const clock = new SystemClock()
const ids = new UuidV7Generator()
ids.next() // a UUIDv7: ids sort by creation time
```

## Guarantees

`DomainError` carries a stable `code` and a `kind` (`validation`, `not_found`, `conflict`…) that the HTTP error handler maps to a status, so a use case never knows about HTTP.

## Limits

No I/O and no dependencies, on purpose: anything that needs a framework belongs in another package.

## Related

[Ambient transaction](../../docs/patterns/ambient-transaction-async-local-storage.md)

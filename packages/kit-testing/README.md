# @kit/testing

## Purpose

Fakes for the kit's ports (clock, ids, outbox, inbox with a crash window, storage, mailer, rate limiter, advisory lock) and the contract suites that keep the fakes and the real adapters honest (`@kit/testing/contracts`).

## Install

```bash
bun add @kit/testing
```

Inside this repository it is a workspace package; outside, a build in `dist/` is what you get (`bun run build`).

## Ports

Implements the ports of `core`, `messaging`, `mail` and `storage` in memory. Add it as a `devDependency`.

## Configuration

<!-- config:start -->
None: this package reads no environment variables.
<!-- config:end -->

## Tables and migrations

None.

## Wiring

```ts
import { describeObjectStorage } from '@kit/testing/contracts'

// the same suite, on any adapter you write
describeObjectStorage('MyStorage', () => ({ storage: new MyStorage() }))
```

## Guarantees

A fake that behaves differently from the real adapter turns one side of the contract red: the suites run on the fakes here and on S3, Postgres and SMTP in `apps/api/tests/integration`.

## Limits

Test-only: never import it from production code.

## Related

[Idempotent consumer](../../docs/patterns/idempotent-consumer-inbox.md)

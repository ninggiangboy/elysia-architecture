# 0003. A producer describes itself to optional consumers

**Status:** accepted · 2026-10-18

## Context

`notification` and `realtime` deliver for every module, yet they imported the contracts of every module that emits events, because "event X → this mail / this live push" lived inside them. Removing billing meant editing notification and realtime too, and neither could be installed without all the others.

## Decision

The mapping lives in the **producer**, under an isolated subpath: `modules/<producer>/src/integrations/{notification,realtime}.ts`, exported as `@mod/<producer>/integrations/notification` and `…/realtime`. These files import only the producer's own contracts and the **definition types** from the consumer's contracts (`import type`); the wording ships next to them in every language. The consumer is an optional peer dependency of the producer. A module's core never imports its own `integrations/`; the composition root lists the integrations it installs and passes them to the consumer.

`notification` and `realtime` therefore import no other module (the `generic-modules-are-leaves` rule).

## Consequences

- The wording and mapping of a billing notification are billing knowledge: they ship and are versioned with billing, and a project installing billing and notification gets them for free.
- Billing runs without notification, because nothing loads that subpath unless the app imports it.
- At start-up the consumer merges the catalogs (a duplicate key is an error, `messageOverrides` is the one layer allowed to replace a key) and checks every template has its messages in every language.
- The handler names (`notification.in-app-topup-succeeded`, …) are inbox keys and did not change; a test pins the whole list.

## Rejected

- *Glue in the app's composition root.* Every adopting project would rewrite the mapping and the wording.
- *The producer declares it inside its core.* Billing could not run without notification.

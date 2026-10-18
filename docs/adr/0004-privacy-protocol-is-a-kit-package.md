# 0004. The privacy participation protocol is a kit package

**Status:** accepted · 2026-10-18

## Context

identity, profile and billing imported `privacy/contracts` for exactly two events, `DataExportRequested` and `AccountErasureRequested`, and each repeated about 25 lines to build the two handlers. That made `privacy` a hard dependency of every module that holds personal data, so it could not be left out of an app.

## Decision

`@kit/privacy-participant` owns the two request events, their payloads, the answer convention (`<module>.data_exported.v1`, `<module>.user_data_erased.v1`) and `privacyParticipation()`, which builds the two handlers from a `DataExporter` and a `DataEraser`. The `privacy` module is one orchestrator implementing that protocol and re-exports the events. Event type strings did not change. Modules declare `privacy: { exports, erases }` and the container derives the participant lists from it.

## Consequences

- A participant depends on a stable protocol, not on a business module (rule `participants-do-not-know-privacy`); privacy is optional.
- Handler names (`<module>.export-user-data`, `<module>.erase-user-data`) are inbox keys and are pinned by a test.
- The coordinator is installed last so it sees who takes part.

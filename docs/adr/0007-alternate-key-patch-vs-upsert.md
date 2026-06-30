# ADR 0007: OData PATCH by alternate key over POST + check

- **Status:** Accepted
- **Date:** 2026-06-22

## Context

To keep the same Salesforce record and the same Dataverse row in sync, the
Azure Function needs an idempotent write. Two patterns in the Dataverse Web
API:

1. **POST + check** — `GET accounts?$filter=crfe6_salesforceid eq '...'` to
   detect existence, then either `POST accounts` or `PATCH accounts(<guid>)`
   to update. Two round trips; non-atomic under concurrent invocations; risks
   double-insert on race.
2. **PATCH by alternate key** — `PATCH accounts(crfe6_salesforceid='<id>')`
   with `Prefer: return=representation`. Dataverse resolves the alternate-key
   index internally; if no row matches it inserts, otherwise it updates in
   place. One round trip; atomic.

The integration must be safe to retry (the `@future` callout, Event Grid, and
`axios-retry` all re-deliver on transient failure).

## Decision

Use **PATCH by alternate key**. The Account table has a published alternate key
`crfe6_salesforceintegrationkey` on `crfe6_salesforceid`. The Function issues
`PATCH {envUrl}/api/data/v9.2/accounts(crfe6_salesforceid='<encoded>')` with
the URL-encoded Salesforce ID. Replays converge to the same Dataverse state.

## Consequences

- **Pros:** Idempotent by construction. Concurrent Function invocations for the
  same Salesforce ID converge to one row. One network round trip. No
  client-side GUID bookkeeping.
- **Cons:** Requires the alternate key to be **Active** in the target
  environment before any PATCH will succeed — Dataverse builds the index via a
  system job, and OData returns `400 The provided key does not match an
  existing key` until the job completes. This is documented in
  `docs/infrastructure/dataverse_schema_mapping.md` and the Power Platform
  README.
- **Operational note:** The Salesforce ID is percent-encoded
  (`encodeURIComponent` + single-quote replacement) before going into the URL
  to prevent OData injection. A unit test asserts this.

# ADR 0002: Use `@future(callout=true)` over Salesforce Platform Events

- **Status:** Accepted
- **Date:** 2026-06-22

## Context

Salesforce offers two mainstream ways to push a record change to an external
system asynchronously:

1. **`@future(callout=true)`** — a one-shot Apex method queued on the async
   platform; runs after the transaction commits, makes one HTTP call, and is
   done.
2. **Platform Events** (CDC or `e.__e` custom events) — a pub/sub bus. The
   publisher does no I/O; a subscriber (CometD, an Apex trigger, or an external
   client) consumes the event and makes the callout.

The integration needs to fan an Account change out to Azure Event Grid, which
is itself a pub/sub bus. Adding Salesforce's pub/sub in front of Azure's feels
redundant for a PoC, but Platform Events have stronger replay semantics and are
the documented enterprise pattern.

## Decision

Use `@future(callout=true)` (`VendorTriggerHandler.sendVendorsToAzure`) for the
PoC. The function does one synchronous HTTP POST to a Named Credential and
exits. Recursion is guarded by a `static Set<Id>`; field-change filtering in
the trigger keeps no-op edits off the callout budget.

## Consequences

- **Pros:** ~40 lines of Apex total; no Event Relay add-on (~USD 250/month per
  channel); no CometD subscriber to host; the trigger already controls exactly
  which records and which fields are interesting.
- **Cons:** No replay beyond the per-transaction guard; if the Azure Function
  is down, the `@future` call fails and `Sync_Status__c` lands on `Error`. No
  durable retry queue.
- **When to flip:** If we ever need multi-consumer fan-out (e.g. a second
  integration that also wants Account changes) or ordered, durable replay
  beyond a single transaction, switch to Platform Events + Event Relay. The
  field-change filter and recursion guard in the trigger are reusable.

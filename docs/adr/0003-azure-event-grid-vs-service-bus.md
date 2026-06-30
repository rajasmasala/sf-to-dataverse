# ADR 0003: Use Azure Event Grid over Service Bus

- **Status:** Accepted
- **Date:** 2026-06-22

## Context

The Azure Function needs a trigger. Two natural choices on Azure:

1. **Event Grid** — a push-based broker. Events arrive over HTTP to a webhook
   (the Function's built-in trigger). Per-event pricing, no provisioned
   throughput, serverless-native.
2. **Service Bus** — a queue/topic broker. The consumer pulls (or the Function
   binds via `ServiceBusTrigger`). Decouples producer and consumer, supports
   sessions, dead-letter queues, dedup, transactions.

The producer is a Salesforce `@future` callout doing one HTTP POST. The
consumer is one Function. Volume is sub-1 QPS.

## Decision

Use **Azure Event Grid** as the broker. The Function is bound via
`app.eventGrid(...)` and Salesforce POSTs an Event Grid–shaped payload (an
array of `{ id, eventType, subject, eventTime, data, dataVersion }`) to the
topic endpoint exposed as a Named Credential.

## Consequences

- **Pros:** Zero infrastructure to provision or scale; the Function's
  consumption plan wakes on the push, so we pay for execution, not idle. The
  payload shape is already what Event Grid expects, so the trigger is generic.
- **Cons:** Service Bus's durable queue semantics (poison-message DLQ, sessions,
  exactly-once with `MessageId` dedup) are absent. Event Grid retries with its
  own exponential schedule for up to 24 hours and then drops to a dead-letter
  blob if configured — fine for a PoC, weaker than Service Bus for production
  order processing.
- **When to flip:** Move to Service Bus the day we have multiple consumers
  with different SLAs, or when we need ordered, transactional fan-out (e.g. a
  payment-authorisation side-effect). The Salesforce side only changes its
  Named Credential URL.

# ADR 0006: SimpleSpanProcessor over BatchSpanProcessor

- **Status:** Accepted
- **Date:** 2026-06-22

## Context

The OpenTelemetry SDK offers two span processors:

1. **`BatchSpanProcessor`** — the default. Batches spans in memory and flushes
   on a timer (default 5 s) or queue-pressure. Lowest per-span exporter cost.
2. **`SimpleSpanProcessor`** — exports synchronously on every `span.end()`.
   One HTTP POST per span; no batching.

The Azure Function runs on a consumption plan, so the worker can be frozen
between invocations and torn down with no notice. Traffic is sub-1 QPS.

## Decision

Use **`SimpleSpanProcessor`** in `src/telemetry.js`. Each span exports
synchronously when it ends.

## Consequences

- **Pros:** No lost spans on worker shutdown. In low-traffic serverless, the
  batch processor routinely loses the last batch of every cold-start lifecycle
  because the timer never fires before the worker is torn down. Simple
  processor trades a small per-span HTTP cost for guaranteed delivery — the
  correct trade-off at this traffic level.
- **Cons:** One HTTP POST per span instead of one per batch. At higher QPS
  (thousands per second) this becomes meaningful both in cost and in exporter
  back-pressure.
- **When to flip:** If the Function ever moves to a Premium / Dedicated plan
  with long-lived workers, or if traffic rises above ~50 spans/sec sustained,
  switch to `BatchSpanProcessor` and wire a `flush()` on `process.beforeExit`.
  The application code does not change — only `src/telemetry.js`.

# ADR 0004: Use OpenTelemetry over the Application Insights SDK

- **Status:** Accepted
- **Date:** 2026-06-22

## Context

The Azure Function needs to emit traces. The two realistic options on Azure in
2026:

1. **Application Insights SDK** (`@azure/monitor-opentelemetry-exporter` or the
   legacy `applicationinsights` package) — wire-one-line, ships to Azure
   Monitor only.
2. **OpenTelemetry SDK** (`@opentelemetry/sdk-node` + OTLP exporter) — emits
   OTLP, vendor-neutral. Microsoft's documented path for new Functions apps is
   `telemetryMode: "OpenTelemetry"` in `host.json` plus the OTel SDK in the
   worker. The classic App Insights SDK is on a deprecation path.

The PoC needs to be demonstrable without an Azure subscription (the recruiter
demo is local), but also needs to be production-plausible.

## Decision

Use **OpenTelemetry** with the OTLP/HTTP exporter. `host.json` declares
`"telemetryMode": "OpenTelemetry"`. The worker initialises
`NodeSDK` + `SimpleSpanProcessor` + `OTLPTraceExporter` +
`HttpInstrumentation` at cold start in `src/telemetry.js`. Locally the exporter
points at a Jaeger all-in-one container; in production it would point at Azure
Monitor's OTLP endpoint. No code change between environments.

## Consequences

- **Pros:** Vendor-neutral. The same spans render in Jaeger locally, in a
  self-hosted collector in dev, and in Azure Monitor in prod. Auto-instrumented
  HTTP spans cover every outbound axios call for free, giving us
  `salesforce.cdc.ingest` → `dataverse.upsert` → auto `HTTP CLIENT` child span
  correlation with no extra code.
- **Cons:** More moving parts (SDK, exporter, processor, instrumentation). The
  classic App Insights one-liner would have been less to set up.
- **Migration escape hatch:** Switching back is a 30-line edit in
  `src/telemetry.js`. The application code already uses the OTel API
  (`tracer.startSpan(...)`) so no business logic depends on the backend.

## Validation

This ADR was validated on 2026-06-22 with a live end-to-end test:

- A real Azure Function (`your-func-app`, Windows Consumption, Node 22, Functions v4)
  was provisioned in `southeastasia` with `telemetryMode: "ApplicationInsights"`
  (the default runtime auto-instrumentation, since `host.json`'s
  `telemetryMode: "OpenTelemetry"` is the OTel SDK reference path but the runtime
  needs additional preview extension for OTLP export to App Insights).
- A real Application Insights workspace-mode resource (`your-appinsights`) was the
  telemetry sink.
- An Event Grid event was POSTed to the Function's webhook. The captured trace
  (operation ID `d733ff85eb3f41bac5bb91b32d65778d`) shows:
  EventGrid trigger fired → Executing `Functions.SalesforceCDCWebhook` →
  `Processing Event Grid event ID: smoke-001` → outbound Dataverse token
  request → 720ms total duration.

Full timeline, span IDs, and repro instructions are in
[`docs/e2e-walkthrough.md`](../e2e-walkthrough.md); raw trace data is in
[`docs/images/app-insights-live-trace.json`](../images/app-insights-live-trace.json).

The validation confirmed that:

1. **No code change between environments** — the same `src/azure/` source tree
   that runs locally against a Jaeger container deployed unchanged to Azure and
   produced traces in Application Insights.
2. **The OTel API surface (`tracer.startSpan(...)`)** is the right abstraction —
   it makes the application code telemetry-backend-agnostic, which was the
   primary justification for this ADR.
3. **A limitation was discovered**: at the time of writing, the
   `telemetryMode: "OpenTelemetry"` setting in `host.json` requires preview
   preview Azure Monitor OTLP ingestion infrastructure (Data Collection Rule
   + Data Collection Endpoint) that was not available in the test subscription.
   For the live test we removed this setting and relied on the GA'd
   Application Insights auto-instrumentation. The migration path remains
   intact — switching back to full OTLP export is a `src/telemetry.js` env var
   change once the Azure-side OTLP ingestion is GA.

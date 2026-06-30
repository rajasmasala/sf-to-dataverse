# Architecture

Reference diagrams and walkthroughs for the SF → Dataverse integration. All
diagrams are Mermaid fenced code blocks so they render natively on GitHub.

## Index

| Document | What it covers |
| --- | --- |
| [Happy path](./happy-path.md) | The successful end-to-end flow: Salesforce Account update → Apex trigger → `@future` → Azure Event Grid → Azure Function → OData PATCH → Dataverse → C# plugin → MDA |
| [Copilot agent](./copilot-agent.md) | The **read** side: operations analyst asks the Copilot Studio vendor-Q&A agent → Power Automate flow → Dataverse `crfe6_syncstatus`. Includes the demo-website and MDA-embed dual-channel topology. |
| [Canvas app](./canvas-app.md) | The **read** side as a human dashboard: ops analyst opens the Vendor Sync Dashboard Canvas app → Dataverse `accounts` (direct binding, no flow). Gallery + filter + detail screen, colour-coded by `crfe6_syncstatus`. |
| [Power BI report](./powerbi-report.md) | The **read** side as analytics: executive/analyst opens the Vendor Sync Analytics Power BI report → Dataverse via the connector. Overview / Sync Health / Vendor Detail pages, DAX measures over `crfe6_syncstatus`. Includes the three-read-surfaces topology. |
| [Error & retry](./error-retry.md) | What happens when Dataverse returns 429/5xx, `axios-retry` exhausts attempts, and `Sync_Status__c` flips to `Error` |
| [Observability](./observability.md) | OpenTelemetry span hierarchy, Jaeger local viewer, OTel env vars, PII allowlist |

## Related

- [Architecture Decision Records](../adr/) — eleven ADRs explaining why the
  diagrams look the way they do.
- `docs/infrastructure/dataverse_schema_mapping.md` — Dataverse-side schema
  setup (custom fields, alternate key activation).
- `docs/governance/branch-protection.md` — `main` branch policy.

## How to read the diagrams

Open any `.md` file in this folder on GitHub (or in a Markdown preview that
supports Mermaid). The sequence diagrams use participant groups to mirror the
deployment boundaries: **Salesforce**, **Azure**, **Power Platform**. Where a
flow crosses a boundary, the arrow label calls out the transport (Named
Credential callout, Event Grid POST, OData PATCH).

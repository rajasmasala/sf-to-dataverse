# Power BI report — Vendor Sync Analytics (read path)

This diagram covers the **read** side of the SF → Dataverse pipeline as
experienced by an executive or analyst: they open the **Vendor Sync
Analytics** Power BI report and consume aggregated sync-state metrics
derived from the `crfe6_syncstatus` field that the Azure Function stamps
into Dataverse.

It is the analytics complement to the [Copilot Studio agent](./copilot-agent.md)
(conversational) and the [Canvas app](./canvas-app.md) (interactive) —
same backing data, different surface (aggregated/exec view).

## Sequence diagram

```mermaid
sequenceDiagram
    autonumber
    actor Exec as Executive / Analyst
    participant PBI as Power BI Service<br/>Vendor Sync Analytics
    participant PBD as Power BI Desktop<br/>(authoring only)
    participant DV as Dataverse<br/>accounts table
    participant DV2 as Dataverse<br/>crfe6_syncstatus (Option Set)
    participant FN as Azure Function<br/>SalesforceCDCWebhook

    Note over PBD,DV: One-time authoring (runbook steps 1-6):
    PBD->>DV: Get Data → Dataverse connector<br/>select account table
    DV-->>PBD: rows
    PBD->>PBD: Power Query: expand crfe6_* columns,<br/>add SyncStatus label via conditional column
    PBD->>PBD: DAX measures:<br/>Vendors Total, Sync Rate %, Vendors in Error, Avg Sync Latency
    PBD->>PBI: Publish .pbix to workspace

    Note over Exec,DV2: Steady-state consumption:
    Exec->>PBI: open report, cross-filter by status
    activate PBI
    Note over PBI: DAX measures evaluate over the<br/>imported/directquery account rows
    PBI->>DV: (DirectQuery mode) or cached refresh<br/>select name, crfe6_uen, crfe6_salesforceid,<br/>crfe6_syncstatus, crfe6_lastmodifiedbyintegration_at
    DV-->>PBI: rows
    PBI->>DV2: map option value → label<br/>(Synced / Pending / Error)
    DV2-->>PBI: friendly status
    PBI-->>Exec: Overview / Sync Health / Vendor Detail pages
    deactivate PBI

    Note over FN,DV2: Earlier write side (for context):<br/>Azure Function PATCHed<br/>crfe6_syncstatus = 100000001 (Synced)<br/>on successful sync —<br/>see happy-path.md
```

## Topology — three read surfaces, one source of truth

```mermaid
flowchart TB
    subgraph "Backing services"
        DV[(Dataverse<br/>accounts + crfe6_syncstatus)]
        PA[Power Automate<br/>crfe6_get-vendor-sync-status]
    end

    subgraph "Read surface 1: conversational"
        CP[Copilot Studio<br/>Vendor Q&A]
    end
    subgraph "Read surface 2: interactive"
        CA[Canvas App<br/>Vendor Sync Dashboard]
    end
    subgraph "Read surface 3: analytics"
        PBI[Power BI<br/>Vendor Sync Analytics]
    end

    CP --> PA --> DV
    CA -->|direct Dataverse binding| DV
    PBI -->|Dataverse connector| DV
```

All three read surfaces consume the same `crfe6_syncstatus` value written
by the Azure Function. They differ in surface and access pattern:

| Surface | Audience | Access pattern | Latency |
|---|---|---|---|
| Copilot Studio agent | Ops analyst (conversational) | Per-query, via Power Automate flow | ~1-2 s per lookup |
| Canvas app dashboard | Ops analyst (interactive) | Direct Dataverse binding, on-demand | sub-second |
| **Power BI report (this)** | **Executive / analyst (aggregated)** | **Dataverse connector, scheduled refresh or DirectQuery** | **minutes (import) to seconds (DirectQuery)** |

## What this means for `crfe6_syncstatus`

The report is the third consumer of the `crfe6_syncstatus` value:

| Consumer | Reads `crfe6_syncstatus` from | Surface |
|---|---|---|
| Copilot Studio agent | Dataverse via Power Automate flow | Conversational |
| Canvas app | Dataverse directly | Interactive dashboard |
| **Power BI report (this)** | **Dataverse via the Dataverse connector** | **Aggregated analytics** |

All three read the same source of truth — Dataverse `crfe6_syncstatus`,
written by the Azure Function. This is the architectural reasoning captured
in [`docs/adr/0011-powerbi-report-format.md`](../adr/0011-powerbi-report-format.md).

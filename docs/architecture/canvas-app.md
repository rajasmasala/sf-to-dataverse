# Canvas app — Vendor Sync Dashboard (read path)

This diagram covers the **read** side of the SF → Dataverse pipeline as
experienced by a human operator: an ops analyst opens the **Vendor Sync
Dashboard** Canvas app and browses the sync state that the Azure Function
stamps into Dataverse (`crfe6_syncstatus`).

It is the human-GUI complement to the [Copilot Studio agent](./copilot-agent.md)
read path — same backing data, different surface (interactive dashboard vs
conversational).

## Sequence diagram

```mermaid
sequenceDiagram
    autonumber
    actor User as Ops Analyst
    participant CA as Canvas App<br/>Vendor Sync Dashboard
    participant DV as Dataverse<br/>accounts table
    participant DV2 as Dataverse<br/>crfe6_syncstatus (Option Set)
    participant FN as Azure Function<br/>SalesforceCDCWebhook

    User->>CA: open app, type in search box
    activate CA
    Note over CA: galVendors.Items evaluates:<br/>Search(If(filter=All, Accounts, Filter(...)),<br/>txtSearch.Text, "name", "crfe6_salesforceid")
    CA->>DV: list accounts<br/>$select=name,crfe6_uen,crfe6_salesforceid,<br/>crfe6_syncstatus<br/>$top=500
    DV-->>CA: rows
    CA->>DV2: read formatted label per row<br/>crfe6_syncstatus@OData.Community.Display.V1.FormattedValue
    DV2-->>CA: "Synced" / "Pending" / "Error" / null
    CA-->>User: gallery with colour-coded badges<br/>(green / amber / red / grey)
    deactivate CA

    User->>CA: tap row
    activate CA
    Note over CA: DetailForm1.Item = galVendors.Selected
    CA->>DV: get single account<br/>$select=all sync fields + createdon/modifiedon
    DV-->>CA: row
    CA-->>User: detail screen with all fields
    User->>CA: tap 🔄 Refresh
    CA->>DV: Refresh(Accounts)
    DV-->>CA: refreshed rows
    deactivate CA

    Note over FN,DV2: Earlier write side (for context):<br/>Azure Function PATCHed<br/>crfe6_syncstatus = 100000001 (Synced)<br/>on successful sync —<br/>see happy-path.md
```

## Topology

```mermaid
flowchart LR
    subgraph "Human surface"
        CA[Canvas App<br/>Vendor Sync Dashboard]
    end
    subgraph "Conversational surface"
        CP[Copilot Studio<br/>Vendor Q&A]
    end
    subgraph "Backing services"
        DV[(Dataverse<br/>accounts + crfe6_syncstatus)]
        PA[Power Automate<br/>crfe6_get-vendor-sync-status]
    end

    CA -->|direct Dataverse binding| DV
    CP --> PA
    PA --> DV
```

The Canvas app reads Dataverse **directly** (no flow in between), unlike the
Copilot Studio agent which routes through Power Automate. This is intentional:
the dashboard is a trusted internal tool where the connection runs in the
signed-in user's context, so the extra indirection of a flow would add
latency without adding capability.

## What this means for `crfe6_syncstatus`

The dashboard is the third consumer (after the Copilot Studio agent and the
Salesforce read-back field) of the `crfe6_syncstatus` value that the Azure
Function stamps:

| Consumer | Reads `crfe6_syncstatus` from | Surface |
|---|---|---|
| Copilot Studio agent | Dataverse via Power Automate flow | Conversational |
| **Canvas app (this)** | **Dataverse directly** | **Interactive dashboard** |
| Salesforce `Sync_Status__c` | Apex-side stamp after Azure Function 2xx | Salesforce UI |

All three read the same source of truth — Dataverse `crfe6_syncstatus`,
written by the Azure Function. This is the architectural reasoning captured
in [`docs/adr/0010-canvas-app-source-format.md`](../adr/0010-canvas-app-source-format.md).

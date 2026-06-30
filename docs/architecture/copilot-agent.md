# Copilot Studio agent — read path

This diagram covers the **read** side of the SF → Dataverse pipeline: an
operations analyst or a reviewer asks the Copilot Studio agent for the
sync state of a vendor, and the agent answers by calling the
`crfe6_get-vendor-sync-status` Power Automate flow against Dataverse.

This is the complement to the [write path](happy-path.md) (Salesforce →
Azure Function → Dataverse). Together they form the full bidirectional
picture.

## Sequence diagram

```mermaid
sequenceDiagram
    autonumber
    actor User as Ops Analyst /<br/>Portfolio Reviewer
    participant CP as Copilot Studio<br/>Vendor Q&A Agent
    participant PA as Power Automate<br/>crfe6_get-vendor-sync-status
    participant DV as Dataverse<br/>accounts table
    participant DV2 as Dataverse<br/>crfe6_syncstatus (Option Set)
    participant FN as Azure Function<br/>SalesforceCDCWebhook

    User->>CP: "what's the sync status of<br/>vendor with SF ID 001apexlive?"
    activate CP
    Note over CP: Generative orchestration parses intent,<br/>extracts salesforceId parameter,<br/>selects GetVendorSyncStatus action
    CP->>PA: invoke flow { salesforceId: "001apexlive" }
    activate PA
    PA->>DV: GetItem accounts(...)<br/>$select=name,crfe6_uen,crfe6_salesforceid,<br/>crfe6_syncstatus,crfe6_lastmodifiedbyintegration_at
    DV-->>PA: row (or 404 → NotSyncedResponse)
    PA->>DV2: read formatted label<br/>crfe6_syncstatus@OData.Community.Display.V1.FormattedValue
    DV2-->>PA: "Synced" / "Pending" / "Error"
    PA-->>CP: { found:true, vendorName, syncStatus:"Synced",<br/>lastSyncAttempt, uen }
    deactivate PA
    Note over CP: Generative layer humanises:<br/>"Acme Pte Ltd synced 2 hours ago (UTC+8)"
    CP-->>User: friendly response
    deactivate CP

    Note over FN,DV2: Earlier write side (for context):<br/>Azure Function PATCHed<br/>crfe6_syncstatus = 100000001 (Synced)<br/>on successful sync —<br/>see happy-path.md
```

## Two channels

The agent is published to two channels simultaneously:

1. **Demo website** — public URL for portfolio reviewers. One click, no
   provisioning required. Used for the screenshots in `docs/images/`.
2. **Microsoft Dynamics 365 channel** — embedded in the
   `crfe6_vendoronboardinghub` model-driven app. This is the production
   architecture: the agent inherits the signed-in user's Dataverse
   row-level security context and can act on the currently-selected
   Account record.

```mermaid
flowchart LR
    subgraph "Public surface"
        WEB[Demo website<br/>for portfolio reviewers]
    end
    subgraph "Production surface"
        MDA[Vendor Onboarding Hub<br/>model-driven app]
    end
    subgraph "Agent"
        CP[Copilot Studio<br/>Vendor Q&A]
    end
    subgraph "Backing services"
        PA[Power Automate<br/>crfe6_get-vendor-sync-status]
        DV[(Dataverse<br/>crfe6_syncstatus)]
    end
    WEB --> CP
    MDA --> CP
    CP --> PA
    PA --> DV
```

## What this means for `crfe6_syncstatus`

Before the agent was added, `crfe6_syncstatus` existed only conceptually
— the Salesforce-side `Sync_Status__c` was the source of truth. Adding
the agent flips that:

| Question | Before | After |
|---|---|---|
| Where does the agent read sync status? | N/A (no agent) | `crfe6_syncstatus` in Dataverse |
| Where does `crfe6_syncstatus` come from? | N/A | Azure Function stamps it on every successful PATCH (option value `100000001` = Synced) |
| Where does Salesforce's `Sync_Status__c` come from? | `VendorTriggerHandler` stamps it after a 2xx from the Azure Function | Unchanged — still stamped the same way |

Dataverse is now the **read** source of truth; Salesforce remains the
**write** source of truth. This is the architectural reasoning captured in
[`docs/adr/0009-copilot-studio-split.md`](../adr/0009-copilot-studio-split.md).

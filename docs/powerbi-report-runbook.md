# Power BI Report — Vendor Sync Analytics (Authoring Runbook)

This runbook walks through building the **Vendor Sync Analytics** Power BI
report against Dataverse. The report gives an executive / analyst view of
the vendor sync state that the Azure Function stamps into Dataverse
(`crfe6_syncstatus`), complementing the conversational
[Copilot Studio agent](./copilot-studio-runbook.md) and the interactive
[Canvas app dashboard](./canvas-app-runbook.md).

The supporting schema (`crfe6_syncstatus` field, option set) is already
committed in this repo. This document covers the **Power BI Desktop-only**
authoring steps.

---

## Status

| Aspect | State (as of 2026-06-24) |
|---|---|
| **Build** | **Not yet built.** The Dataverse schema and option-set values the report reads are in solution version `1.1.0.0` (the `crfe6_syncstatus` field stamped by the Azure Function). The `.pbix` itself has not been authored in Power BI Desktop yet. |
| **Runbook** | Complete. Steps 1–8 below are the ~60 min recipe to build the report from a blank Power BI Desktop file, including the exact DAX measures, Power Query M transforms, and visual layouts. |
| **Source-first** | **Not viable.** A `.pbix` file is an opaque binary (proprietary compressed format). It cannot be authored, diff-reviewed, or regenerated headlessly. See [`docs/adr/0011-powerbi-report-format.md`](./adr/0011-powerbi-report-format.md). The decision follows the same split as ADR 0009 (Copilot Studio) and ADR 0010 (Canvas app): ship schema + runbook, document the reasoning, leave the artefact to the GUI tool. |
| **Solution.xml** | **Unchanged.** Power BI reports are not Dataverse solution components (they live in the Power BI Service), so nothing is registered in `Solution.xml` for this deliverable. |
| **Reproduction** | Follow steps **1–8** below (~60 min). |

---

## 0. Prerequisites (one-time setup)

| Requirement | Where |
|---|---|
| Power BI Desktop (free) | https://powerbi.microsoft.com/desktop/ |
| Power Apps Developer Plan (free) | https://powerapps.microsoft.com/en-us/developerplan/ |
| Dataverse environment provisioned | The environment recorded in your `.env` (`DATAVERSE_ENV_URL`) — `Vikram-Dev` / `orgXXXXXXXX.crm5.dynamics.com` |
| Solution `UniversalFabric` imported | See [`src/powerplatform/README.md`](../src/powerplatform/README.md) — version must be `1.1.0.0` or later so the `crfe6_syncstatus` field and option set exist. |
| Power BI Pro licence | Required only to **publish and share** the report. Authoring in Power BI Desktop and viewing in "My workspace" works on the free tier. |

> **Time budget:** ~60 minutes for steps 1–8.

---

## 1. Get data from Dataverse

1. Open **Power BI Desktop**.
2. **Home → Get data → Online Services → Dataverse** (formerly "Common Data
   Service"). *If you don't see it, search "Dataverse" in the Get Data
   search box.*
3. In the connection dialog, enter the Server URL:
   `https://orgXXXXXXXX.crm5.dynamics.com` (no trailing slash). *Do not use
   the legacy "Dynamics 365" connector unless the Dataverse connector is
   unavailable in your version — the Dataverse connector is the current
   recommended one.*
4. Sign in with the same Entra ID account you use for Power Apps
   (Organizational account).
5. In the **Navigator** pane, expand **Tables** and tick **`account`**.
6. Click **Transform Data** (not Load — we have transforms to do).

## 2. Transform in Power Query

In the Power Query Editor, on the `account` query:

1. **Expand `crfe6_*` columns**: the custom fields come in nested. Select
   the columns, right-click → **Expand**. Keep at minimum:
   `crfe6_salesforceid`, `crfe6_uen`, `crfe6_syncstatus`,
   `crfe6_sync_notes`, `crfe6_lastmodifiedbyintegration_at`. Also keep
   `name`, `createdon`, `modifiedon`, `accountid`.
2. **Rename** for readability:
   - `crfe6_salesforceid` → `SalesforceId`
   - `crfe6_uen` → `UEN`
   - `crfe6_syncstatus` → `SyncStatusCode`
   - `crfe6_sync_notes` → `SyncNotes`
   - `crfe6_lastmodifiedbyintegration_at` → `LastSyncAttemptAt`
   - `name` → `AccountName`
3. **Add a friendly SyncStatus label** via **Add Column → Conditional
   Column** named `SyncStatus`:

   | If `SyncStatusCode` | equals | Output |
   |---|---|---|
   | `100000001` | | `Synced` |
   | `100000000` | | `Pending` |
   | `100000002` | | `Error` |

   *(blank rows will get `null` — handle in DAX or leave as blank.)*

   > If the connector returns `SyncStatusCode` as text instead of the
   > numeric option value, switch the comparison to the string label
   > (`"100000001"` etc.) or use the formatted-value column if exposed.

4. **Type the date columns**: set `LastSyncAttemptAt`, `createdon`,
   `modifiedon` to **Date/Time**.
5. **Close & Apply**.

### Optional: Power Query M snippet

If you prefer M, the conditional column equivalent is:

```m
= Table.AddColumn(PreviousStep, "SyncStatus", each
    if [SyncStatusCode] = 100000001 then "Synced"
    else if [SyncStatusCode] = 100000000 then "Pending"
    else if [SyncStatusCode] = 100000002 then "Error"
    else null, type text)
```

> Replace `PreviousStep` with the name of your previous Power Query step
> (visible in the right-hand **Applied Steps** pane — typically `#"Expanded
> crfe6 columns"` or similar after step 1 above). Pasting the snippet
> verbatim with `PreviousStep` left in will raise an `Expression.Error`
> (undefined identifier).

## 3. DAX measures

In the report view, **Home → New Measure** for each. Create them under a
folder-like convention (or a dedicated display folder in the Fields pane).

```dax
Vendors Total = COUNTROWS('account')

Vendors Synced =
    CALCULATE(
        COUNTROWS('account'),
        'account'[SyncStatus] = "Synced"
    )

Vendors Pending =
    CALCULATE(
        COUNTROWS('account'),
        'account'[SyncStatus] = "Pending"
    )

Vendors in Error =
    CALCULATE(
        COUNTROWS('account'),
        'account'[SyncStatus] = "Error"
    )

Sync Rate % =
    DIVIDE([Vendors Synced], [Vendors Total], 0)

-- Optional: average sync latency in hours, if both timestamps are present.
-- The LastSyncAttemptAt >= createdon guard avoids negative-hour results in
-- the rare case the integration stamps a sync-attempt timestamp earlier
-- than the row's createdon (clock skew / replay).
Avg Sync Latency (hrs) =
    AVERAGEX(
        FILTER('account',
            NOT(ISBLANK('account'[createdon])) &&
            NOT(ISBLANK('account'[LastSyncAttemptAt])) &&
            'account'[LastSyncAttemptAt] >= 'account'[createdon]
        ),
        DATEDIFF('account'[createdon], 'account'[LastSyncAttemptAt], HOUR)
    )
```

## 4. Report page 1 — Overview

Create a new page named **Overview**.

| Visual | Type | Fields / Measure |
|---|---|---|
| KPI card 1 | **Card** | `[Vendors Total]` — title "Total Vendors" |
| KPI card 2 | **Card** | `[Sync Rate %]` (format as %) — title "Sync Rate" |
| KPI card 3 | **Card** | `[Vendors in Error]` — title "Vendors in Error" — set colour to red `#D13438` |
| Vendor mix | **Donut chart** | Legend: `SyncStatus`; Values: `Vendors Total` (implicit count). Colour the slices: Synced=`#107C10`, Pending=`#F2C811`, Error=`#D13438`, blank=`#605E5C`. |
| Vendors created over time | **Clustered bar chart** | Axis: `createdon` (binned by Day); Values: `Vendors Total`. |

## 5. Report page 2 — Sync Health

Create a page named **Sync Health**.

| Visual | Type | Fields / Measure |
|---|---|---|
| Status × day matrix | **Matrix** | Rows: `SyncStatus`; Columns: `LastSyncAttemptAt` (binned Day); Values: `Vendors Total`. |
| Sync latency trend | **Line chart** | Axis: `LastSyncAttemptAt` (Day); Values: `[Avg Sync Latency (hrs)]`. |
| Erroring vendors table | **Table** | Columns: `AccountName`, `UEN`, `SalesforceId`, `SyncStatus`, `LastSyncAttemptAt`, `SyncNotes`. Apply a page-level or visual-level filter: `SyncStatus = Error`. Set `SyncNotes` tooltip so full error text is hoverable. |

## 6. Report page 3 — Vendor Detail

Create a page named **Vendor Detail**.

| Visual | Type | Fields |
|---|---|---|
| Vendor table | **Table** | `AccountName`, `UEN`, `SalesforceId`, `SyncStatus`, `LastSyncAttemptAt`, `SyncNotes` |
| Status slicer | **Slicer** | `SyncStatus` |
| Search box (optional) | **Text filter** (custom visual) or **Slicer** on `SalesforceId` | free-text filter |

## 7. Publish

1. **File → Save** as `Vendor Sync Analytics.pbix`.
2. **Home → Publish** → pick workspace (default **My workspace** is fine
   for the portfolio; a dedicated workspace like `SF-to-Dataverse` is
   cleaner if you intend to share).
3. Sign in with the same Entra ID account.
4. Once published, click the link in the success dialog to open the report
   in the Power BI Service.
5. In the Service, **File → Embed report → Publish to web (public)** for
   a read-only public link — **only do this if the data has no PII**.
   For the vendor dataset, prefer the **Share** dialog (requires Pro for
   recipients) and note the licence constraint honestly in the README.

## 8. Smoke test (mandatory before screenshots)

1. Open the report in the Service (or in Desktop after refresh).
2. Confirm the donut shows real vendor counts (not zero).
3. Confirm `Sync Rate %` is between 0 and 1 (not blank/error).
4. Click a slice on the donut → other visuals should cross-filter.
5. On **Sync Health**, confirm the Erroring vendors table shows the
   `SyncNotes` text on hover.
6. On **Vendor Detail**, use the status slicer to narrow to Pending —
   confirm the table updates.
7. Refresh the dataset once (`... → Refresh`) to confirm no credential
   errors.

Take **two** screenshots:

- `docs/images/powerbi-overview.png` — the Overview page (donut + KPIs)
- `docs/images/powerbi-sync-health.png` — the Sync Health page (matrix + error table)

After capture, update [`README.md`](../README.md) to embed them under the
"Power BI report" subsection.

---

## What is checked into the repo vs. what is not

| In the repo (code/declarative) | NOT in the repo (Power BI Desktop/Service only) |
|---|---|
| `crfe6_syncstatus` schema + option set | The `.pbix` report file |
| Azure Function stamping logic | The published dataset / workspace in the Service |
| This runbook + ADR 0011 | DAX measures and Power Query transforms (until re-derived) |
| Architecture diagram | The public embed / share link |

This is the **same split** as the Copilot Studio agent (ADR 0009) and the
Canvas app (ADR 0010): the schema the report reads is in git; the report
artefact is documented here because Power BI's `.pbix` format is opaque
binary and cannot be authored headlessly.

---

## Optional: version-control the dataset model (hardening)

Once the report is built and stable, you can version-control the **dataset
model** (not the report layout) via Power BI's XMLA endpoint + Tabular
Object Model (TOM) tooling (`pytabular`, `Tabular Editor`). This exports
the model as TMDL/JSON text that *is* diff-reviewable. The steps:

1. Enable **XMLA endpoint** on the workspace (Power BI Service → workspace
   settings → Premium/Fabric → XMLA Endpoint = Read/Write).
2. Open the dataset in **Tabular Editor** (free) via the XMLA endpoint.
3. Save the model as a folder of `.tmdl` or `.bim` files under
   `src/powerplatform/powerbi/model/`.
4. Diff-review model changes in git going forward.

This is **not** required for the portfolio — the runbook is sufficient —
but it is the path to making the dataset model diff-reviewable like the
rest of the repo. It does not help with the report *layout* (visuals,
formatting), which remains a `.pbix` artefact either way.

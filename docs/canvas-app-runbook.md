# Canvas App — Vendor Sync Dashboard (Authoring Runbook)

This runbook walks through authoring the **Vendor Sync Dashboard** Canvas app
in Power Apps Studio. The dashboard gives operations analysts a human-readable
view of the vendor sync state that the Azure Function stamps into Dataverse
(`crfe6_syncstatus`), complementing the conversational
[Copilot Studio agent](./copilot-studio-runbook.md).

The supporting schema (`crfe6_syncstatus` field, option set) is already
committed in this repo. This document covers the **browser-only** authoring
steps.

---

## Status

| Aspect | State (as of 2026-06-24) |
|---|---|
| **Build** | **Not yet authored.** The Dataverse schema and option-set values the app reads are in solution version `1.1.0.0` (the `crfe6_syncstatus` field stamped by the Azure Function). The app itself has not been created in Power Apps Studio yet. |
| **Runbook** | Complete. Steps 1–9 below are the ~45 min recipe to author the app from a blank Canvas. |
| **Source-first** | **Not viable** with `pac canvas` 2.8.1 — see [`docs/adr/0010-canvas-app-source-format.md`](./adr/0010-canvas-app-source-format.md). `pac canvas create` only generates an app from a *custom connector* (flag `--connector-id`), not from a Dataverse table; `pac canvas unpack`/`pack`/`validate` operate on an existing `.msapp` file. There is no headless path to author a Dataverse-bound Canvas app without first creating the `.msapp` in Studio. |
| **Solution.xml** | Bumped to `1.2.0.0` with a placeholder comment marking where the `crfe6_vendorsyncdashboard` CanvasApp root component will be registered once the app exists. |
| **Reproduction** | Follow steps **1–9** below (~45 min). |

---

## 0. Prerequisites (one-time setup)

| Requirement | Where |
|---|---|
| Power Apps Developer Plan (free) | https://powerapps.microsoft.com/en-us/developerplan/ |
| Dataverse environment provisioned | The environment recorded in your `.env` (`DATAVERSE_ENV_URL`) — `Vikram-Dev` / `orgXXXXXXXX` |
| Solution `UniversalFabric` imported | See [`src/powerplatform/README.md`](../src/powerplatform/README.md) — version must be `1.1.0.0` or later so the `crfe6_syncstatus` field and option set exist. |
| License to author Canvas apps | The Power Apps Developer Plan includes Canvas app authoring. |

> **Time budget:** ~45 minutes for steps 1–9. Each screen is independent; you
> can stop and resume between them.

---

## 1. Create the blank app

1. Navigate to https://make.powerapps.com
2. Pick the **same Dataverse environment** you imported the `UniversalFabric`
   solution into (top-right environment picker — `Vikram-Dev`).
3. Click **+ Create** → **Blank app** → **Blank canvas app** (under the
   *Power Apps* card, not *Power Pages*).
4. Name it: `Vendor Sync Dashboard`
5. Format: **Tablet** (the dashboard is data-dense; phone layout works too
   but the gallery columns get cramped).
6. Click **Create**. Studio opens on `Screen1`.

## 2. Rename the first screen and connect Dataverse

1. In the tree view (left), right-click `Screen1` → **Rename** →
   `HomeScreen`.
2. Top ribbon → **Add data** (or the database icon in the left pane).
3. Search **Dataverse** → select your environment.
4. Pick the **Accounts** table → **Connect**.
5. The `Accounts` data source now appears in the tree view under
   **Data sources**.

> The custom fields `crfe6_Sync Status` (`crfe6_syncstatus`),
> `crfe6_Salesforce ID` (`crfe6_salesforceid`), and `crfe6_UEN` (`crfe6_uen`)
> are now available as columns on `Accounts`.

## 3. Add the search box and filter dropdown

1. **Insert** → **Text label** → set `Text` to `"Filter by status:"` —
   place it top-left. Rename it `lblFilterCaption`.
2. **Insert** → **Drop down** → place next to the caption. Rename it
   `ddFilter`. Set its `Items` to:

   ```
   ["All", "Pending", "Synced", "Error"]
   ```

   Set `Default` to `"All"`.
3. **Insert** → **Text input** → place top-right. Rename it `txtSearch`.
   Set `Default` to `""` and `HintText` to `"Search name or Salesforce ID…"`.
4. **Insert** → **Text label** → set `Text` to `"Search:"` —
   place it just left of `txtSearch`. Rename it `lblSearchCaption`.

## 4. Add the summary header (status counts)

Insert three labels across the top, one per status. Each counts matching
accounts:

| Label name | `Text` formula | `Color` |
|---|---|---|
| `lblCountPending` | `"Pending: " & CountIf(Accounts, 'Sync Status' = 'Sync Status (Accounts)'.Pending)` | `ColorValue("#F2C811")` (amber) |
| `lblCountSynced` | `"Synced: " & CountIf(Accounts, 'Sync Status' = 'Sync Status (Accounts)'.Synced)` | `ColorValue("#107C10")` (green) |
| `lblCountError` | `"Error: " & CountIf(Accounts, 'Sync Status' = 'Sync Status (Accounts)'.Error)` | `ColorValue("#D13438")` (red) |

> If the option-set enum name in your tenant differs (the display name in
> Studio is `Sync Status`), pick the value from the formula-bar dropdown
> instead of typing it — Studio will insert the correct reference.

## 5. Add the vendor gallery

1. **Insert** → **Blank vertical gallery** (under *Layout*). Rename it
   `galVendors`.
2. Bind it: select the gallery, set `Items` to:

   ```
   Search(
       If(
           ddFilter.Selected.Value = "All",
           Accounts,
           Filter(
               Accounts,
               'Sync Status' = Switch(
                   ddFilter.Selected.Value,
                   "Pending", 'Sync Status (Accounts)'.Pending,
                   "Synced",   'Sync Status (Accounts)'.Synced,
                   "Error",    'Sync Status (Accounts)'.Error
               )
           )
       ),
       txtSearch.Text,
       "name",
       "crfe6_salesforceid"
   )
   ```

   This reads: *all accounts if filter = All, else only the matching status;
   then narrow by free-text search over name or Salesforce ID.*

   > **Delegation note:** `Search` here runs on the *result* of `If(...Filter(...))`
   > (a derived table), so Power Apps will emit a **delegation warning** and only
   > search the first 500 rows by default (App settings → General → Data row
   > limit; raisable to 2000). At portfolio row counts this is a non-issue; on a
   > real tenant with >2000 vendors, pre-filter via `Filter` first or split the
   > gallery onto a per-status screen.

3. Set the gallery's `TemplateSize` to ~`90` and `TemplateFill` to
   `If(ThisItem.'Sync Status' = 'Sync Status (Accounts)'.Synced, ColorValue("#E7F3E7"), ThisItem.'Sync Status' = 'Sync Status (Accounts)'.Pending, ColorValue("#FFF8E1"), ThisItem.'Sync Status' = 'Sync Status (Accounts)'.Error, ColorValue("#FDE7E9"), White)`
   for a faint row tint by status.

4. In the gallery template, add four labels laid out left-to-right:

   | Label | `Text` |
   |---|---|
   | `lblName` | `ThisItem.'Account Name'` (or `ThisItem.name`) |
   | `lblUEN` | `"UEN: " & ThisItem.'UEN'` |
   | `lblSFID` | `"SF: " & ThisItem.'crfe6_salesforceid'` |
   | `lblStatusBadge` | `ThisItem.'Sync Status'.Value` (or `Text(ThisItem.'Sync Status')`) |

5. Set `lblStatusBadge.Color` to the matching status colour:

   ```
   Switch(
       ThisItem.'Sync Status'.Value,
       "Synced",  ColorValue("#107C10"),
       "Pending", ColorValue("#F2C811"),
       "Error",   ColorValue("#D13438"),
                   ColorValue("#605E5C")
   )
   ```

### Status colour reference

| Status | Option value | Hex |
|---|---|---|
| Synced | `100000001` | `#107C10` (green) |
| Pending | `100000000` | `#F2C811` (amber) |
| Error | `100000002` | `#D13438` (red) |
| *blank* | — | `#605E5C` (grey) |

## 6. Add the detail screen

1. Top ribbon → **New screen** → **Blank**. Rename it `DetailScreen`.
2. **Insert** → **Edit form** (we'll use it read-only). Rename it
   `DetailForm1`.
3. Set `DetailForm1.DataSource` to `Accounts`.
4. Set `DetailForm1.Item` to `galVendors.Selected`.
5. Set `DetailForm1.DefaultMode` to `FormMode.View`.
6. In the form's **Fields** pane, add these data cards (in order):
   - `Account Name`
   - `crfe6_Salesforce ID`
   - `crfe6_UEN`
   - `crfe6_Sync Status`
   - `crfe6_Sync Notes`
   - `crfe6_Last Modified By Integration At`
   - `Created On`
   - `Modified On`
7. **Insert** → **Button** → place at the bottom. Rename it `btnRefresh`.
   Set `Text` to `"🔄 Refresh"` and `OnSelect` to:

   ```
   Refresh(Accounts)
   ```

8. **Insert** → **Icon** (left arrow) → top-left of `DetailScreen`.
   Rename `icnBack`. Set `OnSelect` to `Back()`.

9. Wire navigation from the gallery: select `galVendors`, set
   `OnSelect` to:

   ```
   Navigate(DetailScreen, ScreenTransition.Fade)
   ```

   *(put this in the gallery's `OnSelect`, after any selection logic.)*

## 7. Save and publish

1. **File → Save** → confirm *the cloud* (not local).
2. **File → Publish** → **Publish this version**.
3. Once published, click **Share** and grant yourself (and any test users)
   access.

## 8. Add the app to the `UniversalFabric` solution

So the app travels with the rest of the solution artefacts:

1. Return to https://make.powerapps.com → **Solutions**.
2. Open the **UniversalFabric** solution.
3. **+ Add existing** → **Apps** → **Canvas app**.
4. Pick **Vendor Sync Dashboard** → **Add**.
5. The app is now part of the solution. Take note of the app's
   **unique name** in the solution (it will look like
   `crfe6_vendorsyncdashboard` or a generated GUID-like name — record it
   for the `Solution.xml` follow-up below).

### Follow-up: register the app in `Solution.xml`

Once the app exists in Dataverse and has a stable unique name, add a
`RootComponent` of type `300` (CanvasApp) to
[`src/powerplatform/sf-to-dataverse/Other/Solution.xml`](../src/powerplatform/sf-to-dataverse/Other/Solution.xml):

```xml
<RootComponent type="300" schemaName="crfe6_vendorsyncdashboard" behavior="0" />
```

The repo currently has a `<!-- TODO -->` placeholder marking the spot. Bump
the solution `Version` again if you do this in a separate change.

## 9. Smoke test (mandatory before screenshots)

1. Open the published app in Play mode (▶).
2. Confirm the gallery loads with real Accounts and the **Synced** rows
   show green badges.
3. Change `ddFilter` to **Pending** — gallery should narrow; summary count
   should match.
4. Change `ddFilter` to **Error** — gallery should narrow (likely empty
   in a healthy environment).
5. Type a partial vendor name into `txtSearch` — gallery should narrow
   further.
6. Tap a row → `DetailScreen` should open showing all eight fields.
7. Tap **🔄 Refresh** — the form should reload from Dataverse.
8. Tap the back arrow → return to `HomeScreen`.

Take **two** screenshots:

- `docs/images/canvas-home-gallery.png` — the dashboard with gallery + filter
- `docs/images/canvas-detail.png` — the detail screen for a single vendor

After capture, update [`README.md`](../README.md) to embed them under the
"Canvas app" subsection.

---

## What is checked into the repo vs. what is not

| In the repo (code/declarative) | NOT in the repo (browser-only) |
|---|---|
| `crfe6_syncstatus` schema + option set | The Canvas app definition (screens, controls, formulas) |
| Azure Function stamping logic | The published app record in Dataverse |
| `Solution.xml` placeholder + version bump | The app's connection bindings |
| This runbook + ADR 0010 | Screenshots (until captured) |

This is the **same split** as the Copilot Studio agent (see
[`docs/adr/0009-copilot-studio-split.md`](./adr/0009-copilot-studio-split.md)):
solution-aware schema lives in git; the app definition lives in Dataverse as a
`canvasapp` row and is documented here. The Canvas-app-specific reasoning is
in [`docs/adr/0010-canvas-app-source-format.md`](./adr/0010-canvas-app-source-format.md).

---

## Optional: extract to source as a hardening step

Once the app is authored and stable in Studio, you can export it and check
the unpacked source back into the repo so future changes are reviewable:

```bash
# From repo root, with pac 2.8.1+ installed and authed to Vikram-Dev
pac canvas download --msapp ./tmp/vendor-sync-dashboard.msapp \
  --environment <env-id-or-url> \
  --canvas-app-id <app-id>

pac canvas unpack \
  --msapp ./tmp/vendor-sync-dashboard.msapp \
  --sources ./src/powerplatform/canvas-apps/vendor-sync-dashboard \
  --layout SourceCode \
  --overwrite

pac canvas validate --directory ./src/powerplatform/canvas-apps/vendor-sync-dashboard
```

If the unpacked source validates cleanly, add it under
`src/powerplatform/canvas-apps/vendor-sync-dashboard/` and update ADR 0010's
status from "Accepted (runbook-only)" to "Superseded by source extraction".
This is **not** required for the portfolio — the runbook is sufficient — but
it is the path to making the app diff-reviewable like the rest of the repo.

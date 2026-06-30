# Copilot Studio — Vendor Q&A Agent (Authoring Runbook)

This runbook walks through authoring the **SF → Dataverse Vendor Q&A** agent in
Microsoft Copilot Studio. The agent answers two questions:

1. **"What is the sync status of vendor X?"** — calls the
   `crfe6_get-vendor-sync-status` Power Automate flow, which looks up the
   vendor in Dataverse by `crfe6_salesforceid` alternate key and returns the
   `crfe6_syncstatus` field stamped by the Azure Function.
2. **"Which vendors failed to sync / are pending?"** — uses the same action's
   `FindVendorsByStatus` operation against the Dataverse Web API.

The supporting code (the flow, the OpenAPI action spec, the new
`crfe6_syncstatus` field) is already committed in this repo. This document
covers the **browser-only** authoring steps.

---

## Status

| Aspect | State (as of 2026-06-24) |
|---|---|
| **Build** | Complete in **Preview**. The agent "Vendor Sync Q&A Salesforce-Dataverse" was authored in the Vikram-Dev Dataverse environment, the `GetVendorSyncStatus` flow was wired in as a Tool with generative orchestration, and a live vendor lookup returned real Dataverse data (`SF Apex Live Vendor` / UEN `APEXLIVE001`). |
| **Publish** | **Blocked.** The tenant has no Copilot Studio user licence and no trial licence was available, so step 6 (**Channels → Demo website**) below could not be completed. There is **no public demo URL** for the agent yet. Re-run steps 6–7 once a licence is assigned. |
| **Evidence** | [`docs/images/copilot-preview-vendor-lookup.png`](../images/copilot-preview-vendor-lookup.png) (Preview conversation) and [`docs/images/copilot-tools-panel.png`](../images/copilot-tools-panel.png) (Tools panel showing the wired flow). |
| **Reproduction** | Follow steps **1–8** below (~30 min). Steps 6 and 7 are licence-gated and can be skipped until the licence is provisioned. |

---

## 0. Prerequisites (one-time setup)

| Requirement | Where |
|---|---|
| Power Apps Developer Plan (free) | https://powerapps.microsoft.com/en-us/developerplan/ |
| Dataverse environment provisioned | The environment recorded in your `.env` (`DATAVERSE_ENV_URL`) |
| Solution `UniversalFabric` imported | See [`src/powerplatform/README.md`](../../src/powerplatform/README.md) — version must be `1.1.0.0` or later so the `crfe6_syncstatus` field and the new flow exist. |
| License to use Copilot Studio | The Developer Plan trial includes Copilot Studio. Confirm in the M365 admin center if unsure. |

> **Time budget:** ~30 minutes for steps 1–9 below. Each step is independent
> enough that you can stop and resume between them.

---

## 1. Open Copilot Studio

1. Navigate to https://copilotstudio.microsoft.com
2. Pick the **same Dataverse environment** that you imported the
   `UniversalFabric` solution into (top-right environment picker).
3. Click **+ Create** → **New agent**.
4. Name it: `SF to Dataverse Vendor Q&A`
5. Description: `Answers vendor onboarding and sync status questions by querying the Dataverse vendor solution.`
6. Click **Create**.

## 2. Set the system instructions

In the agent's **Settings → Generative AI → Instructions** panel, paste:

```
You are the SF → Dataverse Vendor Q&A agent.

Your role is to help operations analysts at a Singapore-based logistics
company understand the current state of vendor onboarding. The vendor data
lives in Dataverse as Accounts, mirrored from Salesforce by the
SF → Dataverse Azure Function integration.

When a user asks about a specific vendor:
  - If they give a Salesforce ID, call GetVendorSyncStatus with that ID.
  - If they give a vendor name or UEN, ask them for the Salesforce ID or
    offer to look up matching vendors by name via FindVendorsByStatus.
  - Always report the sync status as the human-readable label
    ('Pending', 'Synced', or 'Error'), never as the numeric option set code.
  - When reporting timestamps, convert to Singapore time (UTC+8) and include
    a friendly relative phrase like "2 hours ago".

When the user asks broad questions like "which vendors failed to sync?":
  - Call FindVendorsByStatus with crfe6_syncstatus eq 100000002.
  - Always cap the response at 20 vendors; if more match, say so and offer
    to show the next page.

Never invent vendor data. If the flow returns found=false, say plainly that
the vendor has not been synced to Dataverse yet and suggest checking the
Salesforce record exists and the integration has run.
```

Click **Save**.

## 3. Add the GetVendorSyncStatus action (flow-backed)

1. In the agent, go to **Actions** (left nav).
2. Click **+ Add action**.
3. Choose **Flow**.
4. Pick **`Get Vendor Sync Status`** (the flow we deployed in
   `crfe6_get-vendor-sync-status`).
5. In the action's **Inputs** tab, confirm:
   - Input: `Salesforce ID` (string, required)
6. In the **Outputs** tab, confirm the response mapping picks up
   `found`, `vendorName`, `uen`, `salesforceId`, `syncStatus`,
   `syncStatusCode`, `lastSyncAttempt`.
7. Save.

## 4. Add the FindVendorsByStatus action (connector-backed, optional)

> This step requires a custom connector built from
> [`get-vendor-sync-status.openapi.json`](../../src/powerplatform/copilot-studio/actions/get-vendor-sync-status.openapi.json).
> If you don't have one deployed yet, **skip this step** — the agent still
> answers single-vendor lookups fully.

1. In your Dataverse environment, go to Power Apps → **Custom Connectors**.
2. **+ New custom connector** → **Import an OpenAPI file**.
3. Upload
   [`src/powerplatform/copilot-studio/actions/get-vendor-sync-status.openapi.json`](../../src/powerplatform/copilot-studio/actions/get-vendor-sync-status.openapi.json).
4. Name it `SF to Dataverse Vendor Status`.
5. In the **Security** tab, confirm OAuth 2.0 with scope `user_impersonation`
   and the redirect URL Copilot Studio shows you.
6. **Test** the connector with a known `salesforceId` (e.g. `001apexlive`
   from the E2E walkthrough) to confirm a `200 OK`.
7. Back in Copilot Studio, **Actions → + Add action → Connector**, pick the
   new connector, and select **both** operations (`GetVendorSyncStatus`,
   `FindVendorsByStatus`).

## 5. Enable generative answers fallback

1. Go to **Knowledge** (left nav).
2. Toggle **Generative answers (preview)** **on** for queries the actions
   can't fulfill.
3. (Optional) Add a knowledge source pointing to the
   [`docs/e2e-walkthrough.md`](../e2e-walkthrough.md) so the agent can
   answer "how does the integration work?" questions from the repo.

## 6. Publish to the demo website channel

1. Go to **Channels → Demo website**.
2. Toggle **Enable demo website**.
3. Copy the URL — this is what you'll put in the README for portfolio
   reviewers to click.
4. Click **Save**.

## 7. Publish to the model-driven app channel (production story)

1. Go to **Channels → Microsoft Dynamics 365**.
2. Toggle the channel **on**.
3. Select the **`crfe6_vendoronboardinghub`** model-driven app.
4. This exposes the agent as the in-app Copilot for users with row-level
   security context on the Account entity.
5. Save.
6. Screenshot the MDA showing the Copilot pane in the top-right — this goes
   in `docs/images/copilot-in-mda.png`.

## 8. Smoke test (mandatory before screenshots)

In the **Test agent** pane (right side):

1. Type: `What is the sync status of vendor with Salesforce ID 001apexlive?`
   - Expected: agent calls GetVendorSyncStatus, responds with
     `"Synced"` status, the UEN `APEXLIVE001`, and a humanized timestamp.
2. Type: `Which vendors failed to sync?` (only if step 4 was done)
   - Expected: agent calls FindVendorsByStatus with `100000002`, returns
     either a list of failed vendors or a "no failed vendors" message.
3. Type: `What's the sync status of vendor with Salesforce ID 999DOESNTEXIST?`
   - Expected: agent reports "this vendor has not been synced to Dataverse
     yet" — proving the NotSynced fallback path works.
4. Type: `How does the integration work?`
   - Expected: generative fallback answers from the knowledge source.

Take **three** screenshots covering each path:

- `docs/images/copilot-single-vendor.png` — single-vendor lookup
- `docs/images/copilot-not-synced.png` — NotSynced fallback
- `docs/images/copilot-in-mda.png` — agent embedded in the model-driven app

## 9. Add to the README

After screenshots are captured, update
[`README.md`](../../README.md) to point to the demo URL and embed the
screenshots. There is a placeholder section in the README that this runbook
is the basis for.

---

## What is checked into the repo vs. what is not

| In the repo (code/declarative) | NOT in the repo (browser-only, lives in Dataverse) |
|---|---|
| OpenAPI action spec | The agent itself (instructions, topics) |
| Power Automate flow JSON | The custom connector deployment |
| `crfe6_syncstatus` schema | The Copilot Studio agent record |
| Solution XML referencing the flow | The published channels |

This is the **same split** as for Canvas apps and model-driven apps: the
solution-aware artefacts (flows, connectors, schema) live in git; the
agent definition lives in Dataverse as a `bot` / `botcomponent` row and is
documented here. See
[`docs/adr/0009-copilot-studio-split.md`](../adr/0009-copilot-studio-split.md)
for the rationale.

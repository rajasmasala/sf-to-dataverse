# Seed demo data — Singapore vendor dataset

Realistic dummy vendor data for the **SF → Dataverse Loom demo**. Seeds ~22
fictional Singapore companies into **Salesforce** and **Dataverse** so all three
read surfaces look populated and varied for the demo video:

- the **Copilot Studio** vendor-Q&A agent (queries `crfe6_syncstatus`)
- the **Canvas app** "Vendor Sync Dashboard" (badges Pending / Synced / Error)
- the **Power BI** "Vendor Sync Analytics" report (aggregates over sync status)

> **Honest status:** the data is **NOT yet seeded** into any live org as of this
> commit. The scripts below are the deliverable; the user must run two commands
> (Salesforce then Dataverse) against authed orgs. See [How to run](#how-to-run).

## Dataset

[`vendors.seed.json`](vendors.seed.json) — 22 invented Singapore vendors.

- **Industries varied:** logistics/freight, catering/F&B, construction, IT/managed
  services, facilities/maintenance, packaging, transport, security, printing,
  uniforms/PPE, waste management, professional services.
- **Realistic SG naming:** `<Name> Pte Ltd` / `<Name> Singapore Pte Ltd` /
  `<Name> Asia Pacific Pte Ltd`. No trademark-y names.
- **Realistic UEN format:** `20YYNNNNN<letter>` (or `19YY…` for older firms).
  Format-correct, unique, **invented** — not real Singapore UENs.
- **Varied currencies:** mostly `SGD`; a couple `USD`, `MYR`, `EUR`, `INR` to
  exercise the Azure Function's currency `$filter` lookup (the dev Dataverse
  env only has SGD configured, so non-SGD vendors realistically land in Error
  on a real sync — a relatable Loom narrative).
- **Target sync-status mix:** **15 Synced, 3 Pending, 4 Error**. Synced is the
  happy-path default; the 3 Pending + 4 Error are injected post-hoc by
  `seed-dataverse.js` Phase 2 so the demo isn't a wall of identical "Synced".
- **Error notes** are specific and realistic, e.g.:
  - *"Currency code INR not found in Dataverse currency lookup — integration could not map"*
  - *"Timeout (504) from Dataverse Web API during PATCH — 3 retries exhausted"*
  - *"Duplicate Salesforce ID detected — alternate key collision with another Account"*
  - *"Validation failed: UEN field is null in source record"*
- **Varied timestamps:** `crfe6_lastmodifiedbyintegration_at` spans the last
  ~14 days (some "2 hours ago", some "5 days ago", some "12 days ago") so the
  Power BI **Sync Health** page has a real trend. The scripts compute the ISO
  timestamps relative to `now`, so the trend is fresh whenever you re-seed.
- **Two Loom-narrative anchors:**
  - **Changi Airfreight Services Pte Ltd** — Synced (the success story to open with)
  - **Sentosa Fresh Catering Pte Ltd** — Error (INR currency mapping gap; relatable)

Coexists with (does not clobber) the existing e2e test vendor
`SF Apex Live Vendor` / UEN `APEXLIVE001` / Salesforce ID `001apexlive`.

## Files

| File | What |
|---|---|
| [`vendors.seed.json`](vendors.seed.json) | The 22-vendor dataset (single source of truth). |
| [`seed-salesforce.apex`](seed-salesforce.apex) | Anonymous Apex. Idempotent (`Database.insert(accList, false)` + UEN pre-query). Prints inserted IDs + any SaveResult errors. |
| [`seed-salesforce.sh`](seed-salesforce.sh) | Bash wrapper: `sf apex run -f seed-salesforce.apex` against the configured target-org. |
| [`seed-dataverse.js`](seed-dataverse.js) | Node script. Phase 1: upserts all 22 as Synced. Phase 2: injects the 3 Pending + 4 Error. Verifies the final status distribution. |
| [`vary-status.js`](vary-status.js) | Thin dispatcher: runs only Phase 2 (handy after a live Azure Function sync). |

## How to run

### Prereqs (auth + deploy)

```bash
# Salesforce: a writable org + UEN__c deployed
sf org login web --set-default-dev-hub
sf org create scratch -f config/project-scratch-def.json -a dev -y 30
sf project deploy start --target-org dev   # deploys UEN__c + trigger + handler
sf config set target-org dev

# Dataverse: .env at the repo root must contain the four DATAVERSE_* vars the
# Azure Function uses (DATAVERSE_ENV_URL, DATAVERSE_TENANT_ID, DATAVERSE_APP_ID,
# DATAVERSE_CLIENT_SECRET). The same .env works for this seed script — it reads
# DATAVERSE_APP_ID as a fallback for DATAVERSE_CLIENT_ID.
```

Check your auth state first:

```bash
sf org list              # is there a writable target-org (not just the DevHub)?
pac auth list            # is Vikram-Dev authed for pac? (not required for this script — it uses the Web API directly)
```

### Step 1 — seed Salesforce

From the repo root:

```bash
# Option A — via the wrapper (validates target-org is set, then runs Apex)
bash test/seed-data/seed-salesforce.sh

# Option B — direct (equivalent)
sf apex run -f test/seed-data/seed-salesforce.apex
```

Look for `Seed: done. inserted=22 failed=0 skipped=0` in the debug log.
Re-running is safe — idempotent by `UEN__c`.

### Step 2 — seed Dataverse

From the repo root:

```bash
# The Node script needs axios + @azure/identity. They're already dependencies
# of the Azure Function package, so install there and node will resolve them:
cd src/azure && npm install && cd ../..

# Default: resolve the REAL Salesforce Account.Id for each vendor (via
# `sf data query` by UEN) so Dataverse's crfe6_salesforceid holds the actual
# SF Id. Requires `sf` CLI installed + a target-org holding the seeded Accounts.
node test/seed-data/seed-dataverse.js

# Override the target-org explicitly (if `sf` has multiple):
node test/seed-data/seed-dataverse.js --sf-target-org=dev

# Escape hatch for dry-runs WITHOUT SF auth: use the synthetic 001SEEDxx IDs
# from the JSON instead of resolving real ones. Useful when iterating on the
# Dataverse side before Salesforce is seeded, or to test the synthetic path.
node test/seed-data/seed-dataverse.js --use-synthetic-ids

# Dry run (combines with either mode above) — preview PATCHes, write nothing:
node test/seed-data/seed-dataverse.js --dry-run --use-synthetic-ids
```

**Run order matters:** by default the Dataverse seed calls `sf` to look up the
real Account.Ids, so the Salesforce seed (Step 1) must complete first. If you
re-run Step 1 between Step 2 runs, the SF Ids are stable (idempotent-by-UEN
means the same rows), so re-running Step 2 is safe.

Expected tail output (default real-Id mode, after a successful SF seed):

```
Resolving real SF Account.Ids via `sf data query`...
SF Id resolution: 22 resolved, 0 synthetic fallback.
...
=== Verifying status distribution ===
Dataverse Account rows with crfe6_salesforceid != null: 23   # 22 seed + 1 e2e vendor
  Pending: 3
  Synced:  16
  Error:   4
All 22 seed vendors present by crfe6_salesforceid.
```

### Alternative: let the live Azure Function do Phase 1

If the Azure Function is deployed and the Salesforce seed fires the
`VendorTrigger` → Event Grid → Function path, Dataverse gets the 22 Synced rows
naturally (the most authentic Loom story — "watch the sync happen"). In that
case skip Phase 1 and only inject the variety:

```bash
node test/seed-data/vary-status.js        # == seed-dataverse.js --phase=2
```

> **B2 note:** `vary-status.js` inherits the SF-Id resolution from
> `seed-dataverse.js`, so when the live Function has created rows keyed by the
> real SF Ids, Phase 2 PATCHes those same rows (instead of spawning
> synthetic-Id duplicates alongside them). This is why the resolution step runs
> even under `--phase=2`.

## How the linkage works (B1)

For the Loom demo's side-by-side shots to look credible, `crfe6_salesforceid`
in Dataverse must hold the **real** Salesforce `Account.Id` — not a synthetic
value. The mechanism:

1. **UEN is the stable business key.** Both the Salesforce Apex seed and the
   Dataverse Node seed carry `uen` consistently. Salesforce assigns its own
   `Account.Id` on insert; the JSON's `salesforceId` (`001SEED01`…) is a
   synthetic fallback.
2. **SF seed (Step 1) inserts the Accounts.** Real `Account.Id`s (e.g.
   `001Dh00000AbCdEFGH`) come back from Salesforce.
3. **Dataverse seed (Step 2, default mode) resolves the real Ids.** Before
   PATCHing, it shells `sf data query -q "SELECT Id, UEN__c FROM Account WHERE
   UEN__c IN (...)" --json`, builds a `uen → realId` map, and uses the real
   Id as the alt-key value when PATCHing `accounts(crfe6_salesforceid='<real
   Id>')`.
4. **Fallbacks are explicit and warned.** If `sf` isn't authed, or a UEN has
   no SF row, the script falls back to the synthetic `001SEEDxx` and prints a
   loud warning. Use `--use-synthetic-ids` to skip resolution entirely (e.g.
   for Dataverse-only dry-runs before SF is seeded).

Result: a viewer comparing the Salesforce Account list and the Dataverse
gallery sees matching Ids, names, and UENs across both sides.

## Notes & constraints

- **No CI integration.** These are manual dev tools; they are intentionally NOT
  wired into `.github/workflows/`. They touch live orgs and must be run by hand.
- **No PII / no real UENs.** Every company name and UEN is invented. The
  synthetic `salesforceId` values (`001SEED01`…`001SEED22`) are **fallbacks
  only** — by default the Dataverse seed resolves the real Salesforce
  `Account.Id` by UEN (see [How the linkage works](#how-the-linkage-works-b1)).
- **Reproducible.** Re-running the Dataverse script is safe — it upserts by
  alternate key `crfe6_salesforceid`, so replays converge to the same rows.
- **Status variety is post-hoc.** The Azure Function stamps `Synced`
  (`100000001`) on every successful sync, so a pure end-to-end run produces all
  Synced rows. The demo-critical Pending/Error mix is injected directly into
  Dataverse afterwards (Phase 2) — this is by design, not a bug.
- **Currency is cosmetic, not an Error cause.** The Azure Function does NOT
  error on unmapped currency (`dataverseSync.js` logs "Skipping currency bind"
  and proceeds to stamp Synced). So currency mismatches cannot be a Phase-2
  Error narrative; the seed's Error notes use non-currency causes (412
  precondition, 504 timeout, duplicate-key collision, null UEN validation).
- **SF-side `Sync_Status__c` won't match the 15/3/4 mix.** The Apex insert
  fires `VendorTrigger`, whose `@future` stamps `Sync_Status__c` on all 22 rows
  uniformly (all Synced if the Function is reachable, all Error if not) —
  independently of the curated Dataverse 15/3/4 mix. For the side-by-side, show
  only Name/UEN/Id columns in the SF view, or deactivate the trigger during
  seeding, or narrate it as "SF shows the trigger's view; Dataverse shows the
  integration's curated state."

# Loom Demo Script — SF → Dataverse Vendor Sync

**Target length:** ~4–5 minutes
**Audience:** Singapore tech recruiters / hiring managers watching a portfolio video
**Goal:** Show a working event-driven Salesforce → Azure → Dataverse integration with three read surfaces (Copilot agent, Canvas app, Power BI), seeded with realistic Singapore vendor data.

**📹 Recorded walkthrough:** [Watch on Loom](https://www.loom.com/share/aa95ded437de471fb94c87eff6f2bd07)

---

## Pre-recording checklist (do these off-camera)

- [ ] Salesforce scratch org `seed-dev2` still alive (run `sf org list` — if expired, recreate per `test/seed-data/README.md`)
- [ ] Dataverse seeded (run the verify probe from `test/seed-data/README.md` — expect 22 vendors: 15 Synced, 3 Pending, 4 Error)
- [ ] Copilot Studio agent tab open to the `Vendor Sync Status` agent in **Test panel** mode (publishing is blocked by license — Test panel is the demo path, documented in `docs/copilot-studio-runbook.md`)
- [ ] Canvas app `Vendor Sync Dashboard` open in maker studio → Play (run) mode
- [ ] Power BI Desktop open with `Vendor Sync Analytics.pbix` (built per `docs/powerbi-report-runbook.md`)
- [ ] Browser tabs ready: Salesforce **Demo Vendors** list view (`sf org open -o seed-dev2 --path "/lightning/o/Account/list?filterName=Demo_Vendors"` — shows **Name + UEN only**; Phone/Type/Industry/Billing are all blank in seed data, so they're deliberately excluded), Dataverse maker portal Accounts grid
- [ ] Loom recording set to **screen + cam**, 1080p, browser zoom at 110%

---

## Script

### 0. Hook (0:00 – 0:20)

> "I'm Vikram. This is an end-to-end integration I built that pushes vendor master-data changes from Salesforce into Microsoft Dataverse in near real-time, with three different read surfaces on top — a Copilot agent, a Canvas app, and a Power BI report. Let me walk you through it."

**On screen:** this README / the architecture diagram from `README.md`, scrolled to the data-flow diagram. Don't read it — just establish the shape.

### 1. The source: Salesforce (0:20 – 0:50)

**Switch to:** Salesforce Accounts list view in `seed-dev2`.

> "Here in Salesforce, I've got a set of Singapore vendor accounts. Each one carries a UEN — that's the Singapore business identifier from ACRA. The integration watches for inserts and updates on this table."

- Scroll the list slowly so names are readable (Changi Airfreight, Sentosa Fresh Catering, etc.).
- Click into **Changi Airfreight Services** → point at the **UEN** field. Don't mention `Sync_Status__c` (it's not curated for the demo — see `test/seed-data/README.md` Notes).

> "When any of these are created or edited, a trigger fires an event to an Azure Function."

### 2. The pipeline: GitHub + Azure (0:50 – 1:30)

**Switch to:** GitHub repo → `.github/workflows/sf-to-dataverse-ci.yml`.

> "The whole thing is in CI. Every PR runs Salesforce scratch-org Apex tests, Azure Function Jest unit tests, and Dataverse solution pack validation. Nothing merges unless all three are green."

Quick scroll showing the three jobs. Then switch to `src/azure/src/functions/SalesforceCDCWebhook.js`.

> "The Azure Function receives the Salesforce change-data-capture event, maps the fields, and PATCHes Dataverse via the Web API using service-principal auth. OpenTelemetry traces every call."

Keep this short — 20 seconds max. Recruiters care about the working result, not the code.

### 3. The destination: Dataverse (1:30 – 2:15)

**Switch to:** Power Apps maker portal → `Vikram-Dev` env → Accounts grid (with the synced-vendor view).

> "This is the same vendor — Changi Airfreight — now in Dataverse. Notice the `Salesforce ID` field here matches the Salesforce Account ID exactly. That's the linkage the Azure Function maintains."

- Point cursor at the **Salesforce ID** cell, then at **Sync Status = Synced**.
- Scroll to **Sentosa Fresh Catering** → point at **Sync Status = Error**.

> "Some vendors land in Error — for example, this one hit a 412 Precondition Failed mid-sync. The status is tracked per-row, not just at a job level."

### 4. Read surface 1: Copilot Studio agent (2:15 – 3:00)

**Switch to:** Copilot Studio → Test panel.

> "Now, on top of that data, I built a Copilot agent that lets an ops person ask natural-language questions about sync state."

Type in the Test panel:

> *What's the sync status of Sentosa Fresh Catering?*

Wait for response. The agent should return the Error status + the note.

> "The agent calls a Power Automate flow that queries Dataverse by vendor name and returns the structured status. It's generative orchestration over a real backend — not a canned response."

**Important:** if the agent returns a wrong/slow answer, don't apologize on camera — just rephrase the question. The Test panel can be flaky; one clean run is all you need.

### 5. Read surface 2: Canvas app (3:00 – 3:40)

**Switch to:** Canvas app in Play mode.

> "For users who need a structured view, there's a Canvas app — a vendor sync dashboard. It shows the same Dataverse data in a gallery with status badges, search, and a detail screen."

- Click **Search**, type `changi` → show the filter working.
- Click a **Pending** row → show the detail screen.
- Point at the summary counts at the top (3 Pending, 15 Synced, 4 Error — whatever matches at record time).

### 6. Read surface 3: Power BI report (3:40 – 4:20)

**Switch to:** Power BI Desktop report.

> "And for leadership, there's a Power BI report aggregating the same data — sync health trends over the last two weeks, vendor detail drill-down, and error breakdowns."

- Click through: Overview → Sync Health (show the trend line) → Vendor Detail (click an Error row to drill).

### 7. Close (4:20 – 4:45)

**Switch back to:** README architecture diagram.

> "Three different surfaces — chat, app, report — all reading the same curated sync state in Dataverse, populated by an event-driven Salesforce integration with full CI. The repo's linked in the description. Thanks for watching."

---

## Recovery: if something breaks mid-demo

- **Copilot agent errors:** rephrase, or skip to the Canvas app and say "the agent does the same query in natural language."
- **Power BI is slow:** skip to close — the Canvas app already shows the same data.
- **Salesforce org expired:** pivot to "the Salesforce side mirrors into Dataverse" and just demo the three Dataverse surfaces. The story still holds.

## Recording tips

- Speak 10–15% slower than feels natural.
- Pause 1 full second after each screen switch before talking — viewers need a beat to re-orient.
- Mouse to where you're talking about, then talk. Don't talk-then-move.
- One take is fine. Loom lets you trim the front/back, but not the middle. If you flub in the middle, pause 2 seconds, restart that section, and note the trim point for editing.


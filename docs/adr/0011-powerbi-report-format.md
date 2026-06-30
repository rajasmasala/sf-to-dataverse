# ADR 0011: Power BI report authored in Desktop; only schema + runbook shipped in git

- **Status:** Accepted (runbook-only; XMLA/TOM hardening deferred)
- **Date:** 2026-06-24

## Context

The Singapore 2026 Power Platform / BI job market lists **Power BI** as a
near-universal expectation — it appears in the majority of BI Analyst,
Power Platform Developer, and Data Engineer listings. To round out the
portfolio's read side (already covering conversational via Copilot Studio
and interactive via Canvas app), we add an executive/analytics read
surface: a Power BI report on vendor sync health.

Power BI offers these authoring modes:

1. **Power BI Desktop** (the canonical authoring tool). Reports are saved
   as `.pbix` files — an **opaque, proprietary, compressed binary** format
   that wraps an Analysis Services Tabular model plus a report layout
   stream. It cannot be read as text, diffed line-by-line, or regenerated
   headlessly from source.
2. **Power BI Service (web authoring)** — same `.pbix` artefact under the
   hood; suffers from the same binary problem.
3. **Web authoring + paginated reports (RDL)** — RDL *is* XML and diffable,
   but paginated reports are a different visual paradigm (print-oriented)
   than the interactive dashboards the portfolio wants to demonstrate.
4. **XMLA endpoint + Tabular Object Model (TOM)** — exposes the **dataset
   model** (tables, measures, relationships) as TMDL/JSON text that *is*
   diff-reviewable. But it does not cover the report **layout** (visuals,
   formatting, page composition), which remains a `.pbix` artefact. It
   also requires Premium/Fabric capacity to enable Read/Write XMLA.

The dependencies the report needs (the `crfe6_syncstatus` field and option
set, the Azure Function that stamps it) are already git-tracked. The report
itself cannot be headlessly authored.

## Decision

Ship the solution-aware schema; document the Desktop-only report
authoring as a runbook. Do not block the portfolio on source-first.

- **In the repo:**
  - Dataverse schema for `crfe6_syncstatus` (already in `Entity.xml`)
  - This ADR + the runbook (`docs/powerbi-report-runbook.md`) including
    exact DAX measures, Power Query M transforms, and visual layouts
  - Architecture diagram (`docs/architecture/powerbi-report.md`)
- **NOT in the repo** (documented in the runbook):
  - The `.pbix` report file itself
  - The published dataset / workspace in the Power BI Service
  - The share / embed link

This mirrors the Copilot Studio split (ADR 0009) and the Canvas app split
(ADR 0010) for the same underlying reason: the first-class authoring
surface is a GUI tool, and the code-trackable artefacts are the schema the
report depends on.

## Consequences

- **Pros:** A reviewer can clone the repo, deploy the solution, follow the
  runbook, and reproduce a working report end-to-end. The DAX and M
  snippets in the runbook double as interview evidence ("here is the
  measure logic I wrote"). No portfolio time is lost waiting for a headless
  authoring path that doesn't exist.
- **Cons:** The `.pbix` is not diff-reviewable in git. Changes made in
  Desktop have to be re-documented in the runbook if they diverge. The
  report's exact formatting is only reproducible by following the runbook.
- **When to flip (dataset model only):** Once the report is built and
  Premium/Fabric capacity is available, enable the XMLA endpoint and export
  the dataset model as TMDL via Tabular Editor. Check the model into
  `src/powerplatform/powerbi/model/`. This covers measures, tables, and
  relationships but **not** report layout. The runbook's final section has
  the steps. Update this ADR's status to "Superseded by TOM model
  extraction" for the model portion.
- **When to flip (full source-first):** If Microsoft ships a first-class
  Power BI report source format (the way Power Apps now has `.pa/yaml`),
  migrate the full report definition into code and delete the runbook.

## Alternatives considered

- **Commit the `.pbix` directly.** Rejected: it is opaque binary, not
  diff-reviewable, and reviewers running `git clone` gain nothing from
  downloading a binary they cannot open without Power BI Desktop
  installed. Worse, LFS-hosted binaries bloat the repo and merge conflicts
  are unresolvable.
- **Author a paginated report (RDL) instead, since RDL is XML.** Rejected
  on signal grounds: the SG market expectation is interactive Power BI
  dashboards, not paginated reports. An RDL would demonstrate a different
  (and less sought-after) skill.
- **Use Power BI Embedded REST API to author headlessly.** Rejected: the
  API supports dataset/row management, not report-layout authoring. There
  is no supported REST endpoint to compose visuals on a canvas.
- **Skip the Power BI deliverable entirely.** Rejected on market-fit
  grounds: Power BI is too consistent an expectation in SG listings to
  omit, and the runbook cost (~60 min of browser/Desktop work, documented
  here) is low relative to the signal value.

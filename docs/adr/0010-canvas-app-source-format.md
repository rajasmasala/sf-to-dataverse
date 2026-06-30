# ADR 0010: Canvas app authored in Studio; only schema + runbook shipped in git

- **Status:** Accepted (runbook-only; source extraction deferred)
- **Date:** 2026-06-24

## Context

The Singapore 2026 Power Platform job market consistently lists **Canvas
apps** alongside model-driven apps as expected senior-level deliverables —
a dashboard-style Canvas app rounds out the portfolio beyond the existing
model-driven `crfe6_vendoronboardinghub` and the Copilot Studio agent.

Canvas apps offer several authoring modes:

1. **Browser-only authoring** in Power Apps Studio (`make.powerapps.com`).
   The app definition (screens, controls, formulas) lives in Dataverse as
   a `canvasapp` row. Microsoft does **not** provide a CLI to author a
   Canvas app bound to a Dataverse table headlessly.
2. **`pac canvas create --connector-id <id>`** — generates a starter app,
   but only from a **custom connector**, not from a Dataverse table. It
   cannot produce the vendor dashboard we need (gallery + filter + detail
   bound to `Accounts`).
3. **`pac canvas unpack`/`pack`/`validate`** — these operate on an
   **existing `.msapp` file**: unpack extracts to `.pa/yaml` source,
   pack reverses it, validate checks `.pa/yaml` correctness. None of them
   author a new app from scratch.
4. **Power Fx YAML source (`.pa/yaml`)** — Studio can save to this format
   and `pac canvas validate` can check it, but authoring it by hand
   requires the surrounding `.msapp` metadata (controls, resources,
   connections) to already exist. There is no "blank YAML app" template
   that `pack` will accept without a Studio origin.

The dependencies the app needs (the `crfe6_syncstatus` field and option
set, the Azure Function that stamps it) are already git-tracked. The app
itself cannot be headlessly authored.

## Decision

Ship the solution-aware schema; document the browser-only app authoring as
a runbook. Do not block the portfolio on source-first.

- **In the repo:**
  - Dataverse schema for `crfe6_syncstatus` (already in `Entity.xml` since
    solution `1.1.0.0`)
  - `Solution.xml` version bump to `1.2.0.0` with a placeholder comment
    marking where the future CanvasApp `RootComponent` (type `300`) will go
  - This ADR + the runbook
  - Architecture diagram (`docs/architecture/canvas-app.md`)
- **NOT in the repo** (documented in
  [`docs/canvas-app-runbook.md`](../canvas-app-runbook.md)):
  - The Canvas app definition itself (screens, controls, formulas)
  - The connection binding to Dataverse
  - The published app record in the target environment

This mirrors the Copilot Studio split (ADR 0009) for the same underlying
reason: Microsoft's first-class authoring surface is the browser, and the
code-trackable artefacts are the schema the app depends on.

## Consequences

- **Pros:** A reviewer can clone the repo, deploy the solution, follow the
  runbook, and reproduce a working dashboard end-to-end. The runbook is
  also strong interview evidence ("here is the recipe, here is what I
  built"). No portfolio time is lost waiting for a headless authoring
  path that doesn't exist.
- **Cons:** The app definition is not diff-reviewable in git. Changes made
  in Studio have to be re-documented in the runbook if they diverge. The
  `Solution.xml` carries a `<!-- TODO -->` placeholder until the app is
  actually authored and its unique name is known.
- **When to flip (source extraction):** Once the app is authored and
  stable in Studio, run `pac canvas download` + `pac canvas unpack
  --layout SourceCode` to extract `.pa/yaml` source, check it into
  `src/powerplatform/canvas-apps/vendor-sync-dashboard/`, register the
  CanvasApp `RootComponent` in `Solution.xml`, and update this ADR's
  status to "Superseded by source extraction". The runbook's final
  section has the exact commands. This is a hardening step, not a
  prerequisite for the portfolio.
- **When to flip (headless authoring):** If Microsoft ships a first-class
  Canvas app CLI or `pac canvas create` gains the ability to scaffold
  from a Dataverse table (not just a connector), migrate the app
  definition into code and delete the runbook.

## Alternatives considered

- **Hand-author `.pa/yaml` and `pack` it.** Rejected: the format is
  tightly coupled to an `.msapp` origin and Studio-generated metadata
  (resources, themes, connection references). A hand-written tree will
  not `pack` cleanly without that surrounding metadata, and even if it
  did, the resulting app would have no Dataverse connection binding
  until opened in Studio — defeating the point.
- **`pac canvas create` from a custom connector wrapping Dataverse.**
  Rejected: would require building and deploying a Dataverse custom
  connector purely to bootstrap the app, adding complexity the rest of
  the solution doesn't need. The app should bind directly to the
  `Accounts` table, not via a connector indirection.
- **Skip the Canvas app entirely.** Rejected on market-fit grounds: the
  portfolio already has a model-driven app and a Copilot Studio agent,
  but Canvas apps appear as a distinct expectation in enough SG listings
  to be worth the runbook.

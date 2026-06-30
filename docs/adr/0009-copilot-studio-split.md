# ADR 0009: Author Copilot Studio agent in browser; ship only solution-aware artefacts in git

- **Status:** Accepted
- **Date:** 2026-06-23

## Context

The Singapore 2026 Power Platform job market treats Copilot Studio as a
near-mandatory senior-level signal — it appears in roughly 80% of senior
Power Platform Developer / Consultant listings ([research
report](../SG-MARKET-ASSESSMENT.md)). To close that gap we need a Copilot
Studio agent in the portfolio.

Copilot Studio offers two ways to build:

1. **Browser-only authoring** in `copilotstudio.microsoft.com`. The agent
   itself (instructions, topics, generative-answers settings) lives in
   Dataverse `bot` / `botcomponent` tables. Microsoft does not provide a
   supported CLI/API to author it programmatically; the only sanctioned
   export path is solution packaging, which produces opaque
   `clientdata.json` blobs that are not human-editable.
2. **Code-first via the Microsoft 365 Agents SDK** (formerly Bot Framework
   SDK). Fully code, but it's a different runtime — it's a "custom bot",
   not a Copilot Studio agent. The skills/integrations don't translate 1:1
   back to Copilot Studio, so the resume signal is weaker ("Bot Framework"
   instead of "Copilot Studio").

The dependencies the agent needs (the `crfe6_syncstatus` field, the
`crfe6_get-vendor-sync-status` Power Automate flow, the OpenAPI action spec)
**are** solution-aware and git-trackable today.

## Decision

Split the artefacts: ship everything solution-aware in git; document the
browser-only agent authoring as a runbook.

- **In the repo:**
  - Dataverse schema (`Entities/account/Entity.xml`) for `crfe6_syncstatus`
  - Power Automate flow JSON (`flows/crfe6_get-vendor-sync-status.json`)
  - Solution-aware `Workflows/<name>-<guid>.clientdata.json`
  - OpenAPI 2.0 action spec for the connector-backed variant
  - Solution.xml registration + version bump (`1.1.0.0`)
  - Azure Function change to stamp `crfe6_syncstatus = Synced`
- **NOT in the repo** (documented in
  [`docs/copilot-studio-runbook.md`](../copilot-studio-runbook.md)):
  - The agent definition itself
  - Topic authoring
  - Channel publishing configuration
  - Generative-answers knowledge bindings

## Consequences

- **Pros:** A reviewer can clone the repo, deploy the solution, and follow
  the runbook to reproduce a working Copilot Studio agent end-to-end.
  Everything code-trackable is code-tracked. The runbook doubles as
  interview evidence ("I built this agent and here is the recipe").
- **Cons:** A reviewer cannot `git clone` the agent itself; the agent
  definition is only reproducible by following the runbook. If we later
  change the agent significantly, the runbook has to be kept in sync.
- **When to flip:** If Microsoft ships a first-class Copilot Studio CLI or
  the Microsoft 365 Agents SDK gains full feature parity with Copilot
  Studio (generative orchestration, the `bot`/`botcomponent` topic model),
  migrate the agent definition into code and delete the runbook.

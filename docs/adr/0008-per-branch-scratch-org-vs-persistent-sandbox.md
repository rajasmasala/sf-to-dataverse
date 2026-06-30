# ADR 0008: Per-branch scratch orgs in CI over a persistent sandbox

- **Status:** Accepted
- **Date:** 2026-06-22

## Context

Salesforce CI needs an environment to deploy to. Two realistic options:

1. **Per-branch scratch org** — `sf org create scratch` on each CI run, deploy,
   run `RunLocalTests`, then `sf org delete scratch`. Clean slate every time.
2. **Persistent sandbox / Developer Edition** — one shared org, redeploy on
   every run. No quota; full org history; but accumulates drift.

The Dev Hub has a daily scratch-org quota (typically 6 active for a Dev Hub
edition). The repository is solo-developed.

## Decision

Use **per-branch scratch orgs** in CI. The workflow creates a 1-day scratch org
from `config/project-scratch-def.json` on every run, deploys source, runs
`RunLocalTests`, and unconditionally deletes the scratch org in an `if: always()`
step. To avoid quota exhaustion from cancelled runs, the workflow also cleans
up any stale active scratch orgs on the Dev Hub before creating a new one.

## Consequences

- **Pros:** Every CI run is a clean-room deployment — schema drift is
  impossible, an "it works on my sandbox" failure mode disappears. Test
  isolation is total. The 1-day TTL means even a leaked org is gone tomorrow.
- **Cons:** Daily scratch-org quota is a hard ceiling; a busy week of PRs can
  exhaust it. The cleanup step mitigates but does not eliminate this.
  Scratch orgs cannot host real data integrations, so end-to-end testing
  against a live Dataverse still needs a sandbox somewhere.
- **When to flip:** Move to a persistent sandbox (or a pair of them for
  blue/green) when the integration needs long-lived data for UAT, or when the
  team grows beyond solo development and quota contention becomes a CI
  blocker. The scratch-org workflow file is structured so it can be replaced
  with a `sf org login sfdx-url` step without touching anything downstream.

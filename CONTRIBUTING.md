# Contributing to SF → Dataverse

Thanks for considering a contribution. SF → Dataverse is a multi-platform
integration PoC (Salesforce, Azure Functions, Power Platform), so this guide
covers conventions for each platform plus the cross-cutting rules for branches,
commits, and secrets.

## Branch strategy

- `main` is the only long-lived branch. It is protected; see
  [`docs/governance/branch-protection.md`](./docs/governance/branch-protection.md)
  for the intended policy.
- Cut feature branches off `main`:
  - `feat/<area>-<short-desc>` — new functionality
  - `fix/<area>-<short-desc>` — bug fix
  - `chore/<area>-<short-desc>` — tooling, refactors, deps
  - `docs/<area>-<short-desc>` — documentation only
- `<area>` is one of `salesforce`, `azure`, `powerplatform`, `ci`, `docs`.
- Squash-merge PRs into `main`. Linear history is enforced.

## Commit messages

Follow [Conventional Commits 1.0](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>(<scope>): <subject>

<body — wrap at 72 chars>

<footer — e.g. Closes #123>
```

- **type** — `feat`, `fix`, `refactor`, `ci`, `docs`, `test`, `chore`, `perf`
- **scope** — `salesforce`, `azure`, `powerplatform`, `ci`, `docs`
- **subject** — imperative mood, lowercase, no period, ≤ 72 chars
- **body** — explain *why* (the *what* is in the diff). Wrap at 72 chars.
- Reference issues in the footer (`Closes #123`, `Stacked on #456`).

Examples from this repo's history:

```
feat(azure): instrument SalesforceCDCWebhook with OTel spans
fix(powerplatform): silence PAC Entity RootComponent warning
chore(salesforce): scope root LWC jest runner to src/salesforce
```

## Pull requests

Every PR fills in [`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md)
— change type, scope, test plan, and the secrets/PII checklist. CI runs only
on the platform areas you touched (thanks to `dorny/paths-filter`), so an
Azure-only PR will not burn Salesforce scratch-org quota.

## How to add a new LWC component

LWC components live under
`src/salesforce/force-app/main/default/lwc/<componentName>/`.

- **Folder name and file prefix** must match and be `lowerCamelCase`:
  `vendorSyncDashboard/`, `vendorSyncDashboard.js`, `vendorSyncDashboard.html`,
  `vendorSyncDashboard.js-meta.xml`.
- **HTML / JS / meta files** share the same prefix.
- **Jest test** lives in `__tests__/<componentName>.test.js`. Use
  `@lwc/jest-transformer` (already wired in `package.json`).
- **Root `npm run test:unit`** is scoped to `src/salesforce/` so it only picks
  up LWC tests, not Azure Function Jest tests. Run it from the repo root:

  ```bash
  npm ci
  npm run test:unit
  ```

- **Deployment** is via `sf project deploy start --target-org <org>`. The
  scratch-org CI workflow (`Salesforce DX Dry-Run & Tests`) deploys your
  component to a fresh scratch org and runs `RunLocalTests` before merge.

## How to add a new field to the Dataverse solution

Dataverse solution source lives at
`src/powerplatform/sf-to-dataverse/`. The layout is PAC's **source-folder**
format — `<Entities />` is childless in `customizations.xml` and all entity
metadata lives in per-entity `Entity.xml` files. See
[ADR 0005](./docs/adr/0005-pac-source-folder-vs-extracted-zip-layout.md) for
why.

To add a custom field to Account:

1. **Edit** `src/powerplatform/sf-to-dataverse/Entities/account/Entity.xml`.
   Add a new `<attribute>` element inside `<entity Name="Account"><attributes>…</attributes>`
   with the same shape as the existing `crfe6_salesforceid` / `crfe6_uen`
   attributes.
2. **Naming.** The publisher prefix is `crfe6_`. The schema name is
   `crfe6_<lowercaselogicalname>`. `PhysicalName` is `crfe6_<PascalCase>`.
   `LogicalName` is all-lowercase. Do not reuse the prefix outside this
   solution.
3. **Length limits.** Single-line text fields need both `MaxLength` and
   `Length` set to the same value. For an alternate-key column keep it short
   (Salesforce IDs are 18 chars — we use 100 to leave room).
4. **Alternate keys** go under `<keys>` inside the same `<entity>`. The key
   name is `crfe6_<lowercaselogicalname>`. Confirm in the maker portal that
   the key is **Active** after import — OData PATCH by that key returns 400
   until the system job finishes building the index.
5. **Form / view exposure.** If the field should appear in the MDA form or
   the *Pending Salesforce Sync* view, also edit the `<formxml>` and
   `<savedquery>` blocks inside the same `Entity.xml`.
6. **Pack and validate locally**:

   ```powershell
   pac solution pack `
     --folder src/powerplatform/sf-to-dataverse `
     --zipfile out/UniversalFabric.zip `
     --packagetype Unmanaged
   ```

   The CI workflow runs the same pack step — if it succeeds locally it will
   succeed in CI.

## How to add a new Azure Function

- Folder convention: `src/azure/src/functions/<functionName>.js`.
- **Always require telemetry at the top of the module** so the SDK
  initialises at cold start, before the trigger handler runs:

  ```js
  const { app } = require('@azure/functions');
  const { tracer, SpanStatusCode } = require('../telemetry');
  // … handler
  ```

- Put non-I/O logic in a sibling pure module under `src/azure/src/sync/` (or
  similar) so it is unit-testable with a mocked axios. See
  `src/azure/src/sync/dataverseSync.js` for the pattern.
- Tests live in `src/azure/test/<name>.test.js`, using Jest. The repo's
  coverage gate is 80% on branches/functions/lines/statements globally.
- For any new outbound HTTP, the global `axios` instance already has
  `axios-retry` wired (3 attempts, exponential backoff, 429/408/5xx). Do not
  create a fresh axios instance per call — you lose the retry interceptor.
- Keep the PII allowlist: only Salesforce system IDs go into span attributes.
  Business fields (Account name, UEN, currency) stay in the request body. The
  telemetry test suite asserts this statically.

## Cert-based secret rotation

Secrets in this PoC are split across three trust boundaries:

| Secret | Lives in | Rotated how |
| --- | --- | --- |
| `SFDX_AUTH_URL` | GitHub Actions secret + local `sfdx_auth.txt` (gitignored) | `sf org login web --set-default-dev-hub`, then `sf org auth show-sfdx-auth-url` |
| `DATAVERSE_CLIENT_SECRET` | GitHub Actions secret + local `local.settings.json` (gitignored) | Azure Portal → App registrations → Certificates & secrets → New client secret |
| `DATAVERSE_TENANT_ID` / `DATAVERSE_APP_ID` / `DATAVERSE_ENV_URL` | GitHub Actions secret + local `local.settings.json` | Not secret per se, but kept out of source for environment hygiene. Rotate by updating the secret + redploying the Function App setting. |

The step-by-step rotation SOP lives in
[`docs/security/incident-reports/2026-06-20-credential-leak.md`](./docs/security/incident-reports/2026-06-20-credential-leak.md).
The TL;DR is: never rewrite Git history. Assume the secret is compromised and
rotate it at the source.

## Local dev setup

### Azure Function

```bash
cd src/azure
npm install
# Start Azurite (storage emulator) — required for local Event Grid trigger
azurite --silent --location ./.azurite --debug ./.azurite/debug.log
# Optional: local Jaeger for trace viewing
docker compose -f docker-compose.otlp.yml up -d
# Copy local.settings.example.json to local.settings.json and fill in secrets
npm start
```

Run unit tests: `npm test` (Jest with `--ci --coverage`, 80% gate).

### Salesforce

Requires the Salesforce CLI (`npm install -g @salesforce/cli`):

```bash
sf org login web --set-default-dev-hub --alias devhub
sf org create scratch -f config/project-scratch-def.json -a dev -y 30
sf project deploy start --target-org dev
npm run test:unit   # from repo root — LWC jest tests
```

### Power Platform

Requires the .NET 8 SDK and PAC CLI
(`dotnet tool install --global Microsoft.PowerApps.CLI.Tool`):

```powershell
# Pack the solution
pac solution pack `
  --folder src/powerplatform/sf-to-dataverse `
  --zipfile out/UniversalFabric.zip `
  --packagetype Unmanaged

# Build & test the C# plugin
dotnet test src/powerplatform/plugins/UniversalFabric.Plugins.sln -c Release
```

### Telemetry, local

Optional but recommended if you are touching the Azure Function:

```bash
cd src/azure
docker compose -f docker-compose.otlp.yml up -d
# In local.settings.json set:
#   OTEL_EXPORTER_OTLP_ENDPOINT = http://localhost:4318/v1/traces
#   OTEL_SERVICE_ENV = local
# Open http://localhost:16686
```

## Need help?

- Architecture: start at [`docs/architecture/`](./docs/architecture/README.md).
- "Why this and not the obvious alternative?": [`docs/adr/`](./docs/adr/0001-adr-template.md).
- Security disclosures: [`SECURITY.md`](./SECURITY.md).

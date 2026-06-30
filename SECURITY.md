# Security Policy

## What this project is

SF → Dataverse is a **portfolio proof-of-concept**. It demonstrates a
multi-platform integration (Salesforce → Azure Functions → Power Platform
Dataverse) at the architectural level — schemas, triggers, idempotency,
observability, CI/CD. The code is shared publicly so that a technical reviewer
can read it.

## What this project is NOT

This project is **not production software**.

- Do **not** deploy the Salesforce metadata to a production Salesforce org.
  The trigger and handler are written to be safe (recursion guard,
  field-change filter), but they have not been load-tested, security-reviewed,
  or signed off for production traffic.
- Do **not** reuse the secrets, app registrations, or tenant IDs from this
  repo in any real environment. Treat every secret that has ever been near
  this working tree as potentially exposed — see [Secret hygiene](#secret-hygiene).
- Do **not** wire the included Power Automate flow into a real approver
  distro list. The flow's `To` address is a placeholder.
- The included `local.settings.json` template values, Named Credential
  references, and `pac auth` snippets are **placeholders** — substitute your
  own.

## Reporting a vulnerability

This is a portfolio project — there is no bug bounty and no SLA. If you find
something genuinely concerning (committed secret, injected dependency, etc.),
please email the author directly rather than opening a public issue. The
author will acknowledge within a reasonable window and rotate the affected
material. See [Secret hygiene](#secret-hygiene) for what "rotation" means
in this repo.

## Secret hygiene policy

The hard rules:

1. **`local.settings.json`, `.env`, and `sfdx_auth.txt` are gitignored** and
   must never be committed. The `.gitignore` covers them; CI fails loudly if
   the Salesforce secret (`SFDX_AUTH_URL`) is missing.
2. **All secrets flow through GitHub Actions secrets → environment variables
   → in-memory only.** No secret is written to disk by the pipeline. No
   secret is logged. The Azure Function's `context.error` only ever prints
   HTTP status codes — Dataverse response bodies (which can contain PII) are
   never logged.
3. **Any secret that has ever been in the working tree should be considered
   potentially exposed and rotated at the source.** We do not rewrite Git
   history; the assumption is "if it touched a file, it leaked."
4. **PII never enters telemetry.** The OTel PII allowlist (system ID only) is
   asserted statically by the test suite at `src/azure/test/telemetry.test.js`.

The rotation SOP lives in
[`docs/security/incident-reports/2026-06-20-credential-leak.md`](./docs/security/incident-reports/2026-06-20-credential-leak.md).

## Known close calls

We track these honestly because they are the most reusable learnings in the
repo. Future reviewers (and the author, six months from now) get more value
from a candid post-mortem than from a clean record.

### `DATAVERSE_CLIENT_SECRET` in the working tree (2026-06-20)

**Outcome:** Secret was scrubbed before commit. Good outcome.

**What happened.** While wiring up the Power Platform CI workflow, the author
briefly had a working-tree copy of `local.settings.json` containing a live
`DATAVERSE_CLIENT_SECRET`. The file was already in `.gitignore`, but it sat in
the working tree next to files that were about to be staged.

**What we caught it with.** The `.github/PULL_REQUEST_TEMPLATE.md` checklist
includes "No secrets, keys, or PII in the diff." A pre-commit `git status`
scan caught the file before `git add` ran. The secret was rotated anyway as a
defensive measure (see [secret hygiene rule 3](#secret-hygiene)).

**Why we are telling you this.** Two reasons: (1) it documents that the
`.gitignore` is not a substitute for vigilance — a working-tree file is one
mis-typed `git add .` away from being committed; (2) it shows that the
checklist and the rotation SOP actually work, and that the author treats
security as a habit rather than a feature flag.

### `.env` committed to history (2026-06-20, prior)

**Outcome:** Secrets rotated. History left intact.

**What happened.** Earlier in the project, a `.env` file containing
`DATAVERSE_CLIENT_SECRET` and `SFDX_AUTH_URL` was accidentally committed in
commit `ee6ca2e`. The file was deleted from the working tree shortly
afterward, but the plaintext secrets remained in Git history.

**Resolution.** We followed the "Zero Trust" protocol: did **not** rewrite
history (which is error-prone and leaves references in forks / clones / CI
caches anyway). Instead, both secrets were rotated at the source — Azure
Portal for the Dataverse client secret, Salesforce Connected Apps OAuth
revocation for the SFDX auth URL — and the new values were placed only in
GitHub Actions secrets. The full SOP is recorded in
[`docs/security/incident-reports/2026-06-20-credential-leak.md`](./docs/security/incident-reports/2026-06-20-credential-leak.md).

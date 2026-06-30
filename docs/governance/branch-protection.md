# Branch Protection: `main`

The `main` branch is protected by GitHub rules. The intended configuration
mirrors the policy below — apply via `gh api` or the GitHub UI.

## Required rules

1. **Require pull request before merging**
   - Required approving reviews: **1** (from a CODEOWNER for the affected path)
   - Dismiss stale pull request approvals when new commits are pushed
   - Require review from Code Owners

2. **Require status checks to pass**
   - Required checks (per path filter):
     - `Detect Changed Platforms` (always)
     - `Salesforce DX Dry-Run & Tests` (when `src/salesforce/**` changes)
     - `Power Platform PAC CLI Validation` (when `src/powerplatform/**` changes)
     - `Azure Function Unit Tests` (when `src/azure/**` changes)
     - `Scan Dependency Changes` (when `src/azure/package*.json` changes)
   - Require branches to be up to date before merging

3. **Require conversation resolution** before merging

4. **Require linear history** (use squash / rebase merges only)

5. **Do not allow force pushes**

6. **Restrict deletions**

## Recommended (defer to org policy)

- Required deployments: none (this repo is the source of truth — deployments
  go to Salesforce / Azure / Power Platform via separate pipelines)
- Signed commits: recommended but not required

## Apply via gh CLI

```bash
gh api repos/rajasmasala/sf-to-dataverse/branches/main/protection \
  -X PUT \
  -f required_pull_request_reviews.required_approving_review_count=1 \
  -f required_pull_request_reviews.dismiss_stale_reviews=true \
  -f required_pull_request_reviews.require_code_owner_reviews=true \
  -f enforce_admins=false \
  -f required_status_checks.strict=true \
  -f required_status_checks.contexts[]="Detect Changed Platforms" \
  -f restrictions= \
  -f required_linear_history=true \
  -f allow_force_pushes=false \
  -f allow_deletions=false
```
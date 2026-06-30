## Summary
<!-- 1-3 sentences. What changed and why? -->

## Change type
<!-- Check one -->
- [ ] feat (new feature)
- [ ] fix (bug fix)
- [ ] refactor (no behaviour change)
- [ ] ci (pipeline only)
- [ ] docs (documentation only)
- [ ] test (test-only)

## Scope
<!-- Tick all that apply -->
- [ ] Salesforce (Apex / metadata)
- [ ] Azure Functions (Node.js middleware)
- [ ] Power Platform (Dataverse solution)
- [ ] CI/CD pipeline
- [ ] Documentation

## Test plan
<!-- How did you verify this works? -->
- [ ] Unit tests pass locally (`npm test` in `src/azure/`)
- [ ] Manual smoke test
- [ ] CI runs green on this PR
- [ ] No regression in existing flows

## Checklist
- [ ] No secrets, keys, or PII in the diff
- [ ] New dependencies are pinned and audited (`npm audit` clean)
- [ ] Public-facing behaviour change documented in README / docs
- [ ] Solution Checker / Apex tests pass (when applicable)

## Related issues / PRs
<!-- "Closes #123", "Stacked on #456", etc. -->
# ADR 0005: PAC source-folder layout (childless `<Entities>`)

- **Status:** Accepted
- **Date:** 2026-06-22

## Context

Power Platform solutions under source control have two layouts:

1. **Extracted-zip layout** — `customizations.xml` carries a full
   `<Entities><Entity><Name>Account</Name><EntityInfo>...</EntityInfo></Entity></Entities>`
   tree; the entity metadata is duplicated in the customizations blob.
2. **Source-folder layout** — `<Entities>` is **childless**
   (`<Entities />`); each entity's metadata lives in its own
   `Entities/<schemaName>/Entity.xml`, which PAC reads at pack time.

The repo originally hand-authored `customizations.xml` in the extracted-zip
layout. PAC CLI printed this on every build:

```
Component: Entities is a supported component type but has unexpected
children in Customizations.xml; this component's specific processing
will be skipped. Make it a childless element if action=Pack should
process any of the component's files or metadata xml.

Following root components are not defined in customizations:
  Type='Entity', Id (or schema name)='Entity-account'.
```

PAC was skipping `Entities` processing entirely, so the Account root component
declared in `Solution.xml` had no matching metadata and the custom fields and
alternate key never made it into the packed zip.

## Decision

Adopt the **source-folder layout**:

- `Other/customizations.xml` keeps `<Entities />` childless.
- Entity metadata lives in `Entities/account/Entity.xml` (folder name = logical
  name, lowercase).
- The `<entity Name="Account">` SchemaName attribute (capital A) inside
  `Entity.xml` is preserved — SchemaName and logical name are different
  concepts and case matters for each.

## Consequences

- **Pros:** PAC packs cleanly. The Account entity, its custom fields
  (`crfe6_salesforceid`, `crfe6_uen`, `crfe6_lastmodifiedbyintegration_at`,
  `crfe6_sync_notes`), and the alternate key `crfe6_salesforceintegrationkey`
  all flow into the zip on import.
- **Cons:** Reviewers used to the extracted-zip layout will look for fields in
  `customizations.xml` and not find them — they live in `Entity.xml`. The
  Power Platform README in this repo documents the layout to avoid that
  confusion.
- **Lesson learned:** Always trust PAC warnings even when the zip still
  "builds". A non-zero exit is not the only failure mode; an empty component
  inside a 200 KB zip is invisible until import.

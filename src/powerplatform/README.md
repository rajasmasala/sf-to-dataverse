# SF → Dataverse — Power Platform Solution

Dataverse side of the SF-to-Dataverse PoC. The unpacked solution (folder
`sf-to-dataverse/`) augments the out-of-box `account` entity with two custom fields and an
alternate key used by the Azure Function for idempotent upserts, then layers on
top a **model-driven app**, an **embedded canvas custom page**, and a
**Power Automate approval flow** so a reviewer can follow the end-to-end
"Salesforce change → Dataverse vendor row → ops validation → approval" story
without leaving the Power Platform.

> **Naming note.** The repository was renamed to `sf-to-dataverse`, but the
> **Dataverse solution identity** is unchanged: solution UniqueName
> `UniversalFabric`, publisher `universalfabric`, customization prefix `crfe6_`.
> Those names are baked into the live Vikram-Dev deployment and changing them
> would require a fresh solution import. Only the on-disk folder name
> (`sf-to-dataverse/`) and the project brand in docs were renamed.

End-to-end pipeline:

```
 ┌────────────┐  CDC    ┌────────────────────┐  PATCH  ┌───────────┐  Trigger ┌────────────────┐
 │ Salesforce │ ──────▶ │ Azure Function     │ ──────▶ │ Dataverse │ ───────▶ │ Power Automate │
 │  Account   │  Event  │ (Event Grid trigger)│  OData  │  Account  │  Flow    │ approval email │
 └────────────┘  Grid   └────────────────────┘  v9.2   └───────────┘          └────────────────┘
        ▲                                                                            │
        │                                                                            │
        │                  ┌──────────────────────────────────┐                    │
        └──────────────────│  Vendor Onboarding Hub (MDA)     │◀───────────────────┘
                           │  ├── Pending Salesforce Sync     │   ops analyst reviews
                           │  │   view (sorted by createdon)  │   in MDA, validates UEN
                           │  └── Account form w/ embedded    │   in embedded canvas page,
                           │      Vendor Validation canvas    │   and approves
                           └──────────────────────────────────┘
```

## Who uses what

| Persona               | Component they touch                                                | What they do there                                                             |
| --------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Admin** (IT ops)    | `crfe6_vendoronboardinghub` model-driven app                        | Skims the **Pending Salesforce Sync** view to see what synced in the last hour. |
| **Ops analyst**       | Account form → embedded **Vendor Validation** canvas custom page    | Reviews the UEN against the (mocked) ACRA Bizfile API, sets a validation status. |
| **Approver** (distro) | Inbox — receives the **Vendor Onboarding Approval** flow email       | Clicks through to the MDA record to approve or reject the vendor.              |

The point of pairing the MDA with a canvas custom page (rather than building
the entire experience as a standalone canvas app) is **role-specific UI inside
a system-of-record form**: the admin's column view stays clean, while the
ops analyst gets a focused, low-code Power Fx surface for the validation task.

## Solution contents

| Component                              | Schema name                       | Type (RootComponent `type`) | Purpose                                                                  |
| -------------------------------------- | --------------------------------- | --------------------------- | ------------------------------------------------------------------------ |
| Publisher                              | `universalfabric`                 | —                           | Owns the `crfe6` customization prefix                                    |
| Account entity reference               | `account`                         | `1` (Entity)                | Root component — vendors live here                                       |
| Salesforce ID (single line text)       | `crfe6_salesforceid` (100)        | — (attribute of Account)    | Alternate-key column for OData upsert PATCH URLs                         |
| UEN (single line text)                 | `crfe6_uen` (50)                  | — (attribute of Account)    | Singapore UEN mirrored from Salesforce `UEN__c`                          |
| Alternate key on Account               | `crfe6_salesforceintegrationkey`  | — (key on Account)          | Backs OData `accounts(crfe6_salesforceid='...')`                         |
| **Vendor Onboarding Hub** model-driven app | `crfe6_vendoronboardinghub`    | `80` (AppModule)            | Admin-facing MDA, hosts the vendor pipeline UI                           |
| **Vendor Validation** canvas custom page | `crfe6_vendorvalidation`        | `80` (AppModule, ClientType=8) | Embedded canvas page inside the Account form                             |
| **Pending Salesforce Sync** view       | (saved query on Account)          | — (savedquery inside Entity)| Sorted by `createdon` DESC, columns: Name, UEN, Salesforce ID, Created On |
| **Vendor Onboarding Approval** flow    | `crfe6_vendor-onboarding-approval` | `29` (Workflow)            | Triggers on Account create; emails the approver distro list              |

The publisher prefix `crfe6` and option-value prefix `10000` are fixed for this
PoC and must not be reused by another publisher in the target environment.

## Folder layout

```
src/powerplatform/
├── README.md                                              # this file
├── flows/
│   └── crfe6_vendor-onboarding-approval.json              # canonical flow definition (reviewer-facing)
└── sf-to-dataverse/                                       # PAC solution root
    ├── [Content_Types].xml                                # OPC packaging descriptor
    ├── AppModules/
    │   ├── crfe6_vendoronboardinghub/AppModule.xml        # MDA registration
    │   └── crfe6_vendorvalidation/AppModule.xml           # canvas custom page registration
    ├── AppModuleSiteMaps/
    │   └── crfe6_vendoronboardinghub.xml                  # MDA sitemap (Vendors area)
    ├── Entities/
    │   └── account/
    │       └── Entity.xml                                 # Account entity (fields, key, form, view)
    ├── Workflows/
    │   └── crfe6_vendor-onboarding-approval-*.clientdata.json   # flow clientdata for PAC
    └── Other/
        ├── Solution.xml                                   # solution manifest + RootComponents
        └── customizations.xml                             # customizations blob consumed on import
```

All files are **UTF-8 without BOM**. Earlier history saw the same files saved
as UTF-16 LE, which made PAC CLI throw `invalid character 0x00` errors. Keep
editors on UTF-8 (no BOM) when modifying these files.

## Model-driven app: Vendor Onboarding Hub

`crfe6_vendoronboardinghub` is a classic MDA (`ClientType=4` for Web,
`ClientType=5` for Desktop). Its sitemap (`AppModuleSiteMaps/crfe6_vendoronboardinghub.xml`)
declares a single area, **Vendors**, containing one group, **Vendors**, with
the **Account** subarea. Importing the solution adds "Vendor Onboarding Hub"
to the maker-portal apps list.

The Pending Salesforce Sync view lives inside `Entities/account/Entity.xml`
as a `<savedquery>` and surfaces automatically in the MDA's view picker on
Account. Its fetch is:

```xml
<fetch version="1.0" output-format="xml-platform" mapping="logical">
  <entity name="account">
    <attribute name="name" />
    <attribute name="crfe6_uen" />
    <attribute name="crfe6_salesforceid" />
    <attribute name="createdon" />
    <order attribute="createdon" descending="true" />
    <filter type="and">
      <condition attribute="crfe6_salesforceid" operator="not-null" />
    </filter>
  </entity>
</fetch>
```

…so only Accounts that came through the Salesforce pipeline show up, newest
first — exactly what the admin needs for a "what just landed?" queue.

## Embedded canvas custom page: Vendor Validation

The Account form (`FormXml` inside `Entities/account/Entity.xml`) includes a
cell hosting a Power Apps custom page control that points at the
`crfe6_vendorvalidation` AppModule. The custom page is a low-code Power Fx
surface the ops analyst uses to validate the UEN against ACRA Bizfile before
the vendor is approved.

Because a live Dataverse environment is not part of this PoC, the canvas
implementation is documented here as the **reference Power Fx** rather than
encoded as a `.pa` source file. Drop the snippets below into a new custom
page in the maker portal and wire `ModelDrivenFormIntegration.ItemForm` as
the data source.

```powerapps
// Vendor Validation custom page — Power Fx

// 1) Pull the parent Account context from the host MDA form.
Set(
    vendorContext,
    ModelDrivenFormIntegration.ItemForm.Item
);

// 2) Mock the ACRA Bizfile API response shape. Replace with a real connector
//    when available; for the PoC this is a typed local variable so the UI is
//    demonstrable without an external dependency.
Set(
    mockBizfileResponse,
    {
        uen: "202612345G",
        entityName: vendorContext.name,
        status: "REGISTERED",
        registrationDate: "2026-01-15",
        entityType: "PRIVATE LIMITED COMPANY"
    }
);

// 3) Validate the UEN format (Singapore UEN checksum is well-defined; here we
//    use a simplified regex pattern — a real implementation calls the Bizfile
//    API connector with the UEN and inspects the response).
Set(
    uenIsValid,
    IsMatch(
        vendorContext.crfe6_uen,
        "^[0-9]{9}[A-Z]$|" &        // businesses registered with ACRA
        "^[0-9]{10}T$|" &            // businesses registered with ACRA on or after 1 Jan 2026
        "^[0-9]{9}[A-Z][0-9]$"      // miscellaneous UENs (e.g. for societies, LLPs)
    )
);

// 4) Update the validation-status visual on the form based on the result.
Set(
    validationStatus,
    If(
        IsBlank(vendorContext.crfe6_uen),
        { label: "UEN missing", color: Color.Orange },
        uenIsValid,
        { label: "UEN format valid — matched ACRA Bizfile", color: Color.Green },
        !uenIsValid,
        { label: "UEN format invalid", color: Color.Red }
    )
);

// 5) On-select handler for the "Mark as validated" button. Patches the UEN
//    back to the Account with a validation timestamp so the approval flow
//    can short-circuit future runs.
Patch(
    Accounts,
    vendorContext,
    {
        crfe6_sync_notes: "Validated by " & User().FullName & " on " & Text(Now())
    }
);
Notify("Validation status written back to the Account.", NotificationType.Success);
```

The matching `crfe6_sync_notes` field is intentionally **not** created in this
PoC (it would require adding a new attribute to the Account entity). When the
approver clicks through from the Power Automate email and opens the form, the
canvas page picks up the Account context via `ModelDrivenFormIntegration`, so
no extra wiring is needed on the maker side.

## Power Automate flow: Vendor Onboarding Approval

`crfe6_vendor-onboarding-approval` (RootComponent `type="29"`) is a Dataverse-aware
flow that fires when a new Account row is added with `crfe6_salesforceid`
populated but `crfe6_sync_notes` blank — i.e. the row was just synced from
Salesforce and has not yet been validated.

**Trigger**: When a row is added, modified or deleted → entity `accounts`,
change type `Create`, filter `crfe6_salesforceid ne null and crfe6_sync_notes eq null`.

**Actions**:
1. `Get_record` — fetch the new Account's `name`, `crfe6_uen`, `crfe6_salesforceid`.
2. `Send_approval_email` (Office 365) — emails the `ApproverEmail` parameter
   with the vendor's details and a deep link back to the MDA form.

The canonical flow definition lives at `flows/crfe6_vendor-onboarding-approval.json`
(reviewer-facing). A mirror `clientdata.json` lives in
`sf-to-dataverse/Workflows/` so that PAC can pack the flow into the solution
zip. The flow uses connection references `shared_commondataserviceforapps` and
`shared_office365`; on import, the maker portal will prompt the importer to
bind those references to real connections.

## Packing locally

The solution packs without any Dataverse credentials:

```powershell
# One-time: install PAC CLI
dotnet tool install --global Microsoft.PowerApps.CLI.Tool
# Ensure %USERPROFILE%\.dotnet\tools is on PATH

pac solution pack `
  --folder src/powerplatform/sf-to-dataverse `
  --zipfile out/UniversalFabric.zip `
  --packagetype Unmanaged
```

A non-zero exit means the XML is malformed or the folder structure is wrong —
fix the source rather than the zip.

## Importing to Dataverse

Portal: **Power Platform admin center** → environment → **Solutions** →
**Import** → upload `out/UniversalFabric.zip`. After import:

1. Open **Account** → **Keys** and confirm `crfe6_SalesforceIntegrationKey`
   is **Active** (Dataverse creates the backing index asynchronously; the
   alternate key is unusable for OData until it activates).
2. Open the **Vendor Onboarding Hub** app, confirm the **Pending Salesforce
   Sync** view is in the Account view picker.
3. Open an Account record, confirm the **Vendor Validation** canvas custom
   page cell renders.
4. In **Solutions** → **Universal Fabric** → **Cloud Flows**, open
   **Vendor Onboarding Approval**, bind the connection references, and turn
   the flow on.

CLI:

```bash
pac auth create --url https://<env>.crm.dynamics.com \
                --applicationId <app-id> --clientSecret <secret> --tenant <tenant-id>
pac solution import --path out/UniversalFabric.zip --publish-changes
```

## How the Azure Function uses the alternate key

`src/azure/src/sync/dataverseSync.js` issues:

```text
PATCH {envUrl}/api/data/v9.2/accounts(crfe6_salesforceid='<encoded-sf-id>')
```

This is an **upsert**: Dataverse creates the account when no row matches the
alternate key, otherwise it updates the existing row in place. The key value is
deterministic per Salesforce record, so replaying the same CDC event produces
the same Dataverse state — which is what makes the pipeline idempotent and safe
to retry. If the Azure Function gets `404` or
`400 The provided key does not match an existing key`, confirm the key status
in the maker portal.

## CI

The `Power Platform PAC CLI Validation` job in
`.github/workflows/sf-to-dataverse-ci.yml` runs on any change to
`src/powerplatform/**`. It always packs the solution (the authoritative gate —
fails on malformed XML) and uploads the zip as an artifact. When the repo has
`DATAVERSE_ENV_URL`, `DATAVERSE_APP_ID`, `DATAVERSE_CLIENT_SECRET`, and
`DATAVERSE_TENANT_ID` secrets configured, it additionally runs `who-am-i` and
Solution Checker; otherwise those steps are skipped with a clear `::notice::`
message rather than failing.

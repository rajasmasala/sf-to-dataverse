# SF → Dataverse — Dataverse Plugins

Server-side business logic that stamps audit fields on Account updates regardless
of who is calling (the Azure Function, a model-driven app user, an OData client,
another plugin). Complements the declarative `crfe6_salesforceid` / `crfe6_uen`
solution fields declared in `../sf-to-dataverse/Entities/account/Entity.xml`.

## What lives here

```
src/powerplatform/plugins/
├── UniversalFabric.Plugins.sln                 # Visual Studio / dotnet solution
├── Directory.Build.props                       # Shared TFM / nullable / warnings-as-errors
├── UniversalFabric.Plugins/                    # Class library — what gets registered
│   ├── UniversalFabric.Plugins.csproj          #   .NET 8, references Microsoft.PowerPlatform.Dataverse.Client
│   ├── AccountUpdateStampPlugin.cs             #   The plugin
│   └── SystemClock.cs                          #   ISystemClock for deterministic testing
└── UniversalFabric.Plugins.Tests/              # xUnit + Moq
    ├── UniversalFabric.Plugins.Tests.csproj
    ├── AccountUpdateStampPluginTests.cs        #   10 tests, full plugin path coverage
    └── Fakes/                                  #   ServiceProvider + test harness
```

## AccountUpdateStampPlugin

Classic pre-operation plugin scenario: when a vendor record is updated in
Dataverse and the change touches one of the synced fields, the plugin stamps
audit columns that the model-driven app and ops reports read.

| Aspect                | Value                                                |
| --------------------- | ---------------------------------------------------- |
| Message               | `Update`                                             |
| Primary entity        | `account`                                            |
| Pipeline stage        | `PreOperation` (20)                                  |
| Execution mode        | `Synchronous` (0)                                    |
| Filtering attributes  | `crfe6_salesforceid`, `crfe6_uen`                    |
| Stamped attributes    | `crfe6_lastmodifiedbyintegration_at`, `crfe6_sync_notes` |
| Deployment            | Sandbox (Dataverse-only; no OnPrem requirement)      |

Because the plugin runs in the **pre-operation** stage, it mutates the inbound
`Target` `Entity` directly — Dataverse persists those changes inside the same
`Update` SQL statement, with no separate `Update` call and therefore no risk of
plugin re-entry.

The filtering attributes keep the plugin dormant on no-op edits (e.g. ownership
changes, status changes, description-only updates), so it does not consume
sandbox worker CPU for unrelated traffic.

## Build & test

Requires the **.NET 8 SDK** (`net8.0`). The repo does not ship a global.json;
the latest SDK is fine.

```powershell
# From src/powerplatform/plugins
dotnet restore UniversalFabric.Plugins.sln
dotnet build UniversalFabric.Plugins.sln -c Release
dotnet test  UniversalFabric.Plugins.sln -c Release
```

If the .NET SDK is not installed on the build agent, the plugin folder is
skipped — the Power Platform CI workflow in
`.github/workflows/sf-to-dataverse-ci.yml` only runs `pac solution pack` against
`src/powerplatform/sf-to-dataverse/`, which is unrelated to this project.
Plugins ship as an assembly, not as part of the unpacked solution source.

The plugin assembly is **not** packed into `UniversalFabric.zip` by default.
PAC CLI packs plugins only when they are registered against the solution via
**Plugin Registration Tool** / `pac plugin register`. See
[Registering the plugin](#registering-the-plugin) below.

## Test design

- **xUnit** for the runner.
- **Moq** for `IPluginExecutionContext`, `IOrganizationService`, and
  `ITracingService`. Moq was chosen over hand-rolled fakes so the tests are
  resilient to additions to the `IPluginExecutionContext` surface — Moq returns
  defaults for any property the plugin does not touch.
- A deterministic `FixedClock` (injected via the internal `ISystemClock`
  constructor) keeps assertions on the stamped timestamp exact.
- `InternalsVisibleTo("UniversalFabric.Plugins.Tests")` in
  `UniversalFabric.Plugins.csproj` exposes the clock seam to the test project
  without making it part of the public API.

Coverage matrix:

| Behaviour                                                  | Test                                            |
| ---------------------------------------------------------- | ----------------------------------------------- |
| Stamps both fields when `crfe6_salesforceid` changes       | `Execute_StampsBothFields_WhenSalesforceIdChanges` |
| Stamps both fields when `crfe6_uen` changes                | `Execute_StampsBothFields_WhenUenChanges`       |
| Stamps when both trigger attributes change                 | `Execute_StampsBothFields_WhenBothTriggerAttributesChange` |
| Skips when neither trigger attribute changed               | `Execute_DoesNotStamp_WhenNeitherTriggerAttributeChanged` |
| Tolerates a missing Target                                 | `Execute_DoesNotStamp_WhenTargetMissing`        |
| Note format is round-trippable ISO 8601 Zulu               | `Execute_FormatsNoteAsIso8601Zulu_AndRoundTrips` |
| Throws on misregistration (wrong stage)                    | `Execute_ThrowsWhenRegisteredOnWrongStage`      |
| Throws on null ServiceProvider                             | `Execute_ThrowsWhenServiceProviderIsNull`       |
| `TriggerAttributes` is exactly the documented set          | `TriggerAttributes_AreExactlySalesforceIdAndUen` |
| Second stamp overwrites the first (replay-safe)            | `Execute_OverwritesPriorStamp_WhenFiredAgain`   |

## Registering the plugin

This is **out of scope** for the PoC build pipeline because it requires a live
Dataverse environment. The steps below are what an SI engineer would do to wire
the plugin up after building the assembly.

### 1. Build the assembly

```powershell
dotnet build src/powerplatform/plugins/UniversalFabric.Plugins/UniversalFabric.Plugins.csproj -c Release
```

The compiled assembly lands at
`src/powerplatform/plugins/UniversalFabric.Plugins/bin/Release/net8.0/UniversalFabric.Plugins.dll`.

### 2. Register via PAC CLI

```powershell
pac auth create --url https://<env>.crm.dynamics.com `
                --applicationId <app-id> `
                --clientSecret <secret> `
                --tenant <tenant-id>

pac plugin register `
  --pluginAssemblyPath "src/powerplatform/plugins/UniversalFabric.Plugins/bin/Release/net8.0/UniversalFabric.Plugins.dll" `
  --pluginAssemblyName UniversalFabric.Plugins `
  --solutionName UniversalFabric `
  --sourceType 0 `
  --isolationMode 2
```

(`--sourceType 0` = database, `--isolationMode 2` = sandbox.)

### 3. Add the step

In the Plugin Registration Tool (or `pac plugin register` with a step file),
add a step with these values:

| Field                  | Value                              |
| ---------------------- | ---------------------------------- |
| Message                | `Update`                           |
| Primary Entity         | `account`                          |
| Filtering Attributes   | `crfe6_salesforceid`, `crfe6_uen`  |
| Event Pipeline Stage   | `PreOperation`                     |
| Execution Mode         | `Synchronous`                      |
| Deployment             | `Server` (Dataverse-only)          |
| Unsecure Configuration | *(empty)*                          |
| Secure Configuration   | *(empty)*                          |

After registration, the step appears in the `UniversalFabric` solution under
**Plugin Assemblies → UniversalFabric.Plugins → AccountUpdateStampPlugin →
Update**.

### 4. Verify

Trigger an update from either the Azure Function (PATCH by `crfe6_salesforceid`)
or the model-driven app. The Account form should then show a non-empty
`Last Modified By Integration At` and a `Sync Notes` value like
`Updated via Plugin at 2026-06-22T01:30:45Z`. Edits that touch only `name` or
`description` should *not* stamp either field — confirming the filtering
attributes are correct.

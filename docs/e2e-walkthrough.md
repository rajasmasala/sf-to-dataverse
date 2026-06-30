# End-to-end live integration walkthrough

This page documents a real end-to-end execution of the SF→Dataverse pipeline:
**Salesforce `VendorTrigger` -> Azure Function -> Dataverse**, with a captured
**Application Insights** trace as evidence.

> **Status:** TRUE end-to-end live integration verified on 2026-06-22.
> A live Apex `Http.send` callout from a Salesforce scratch org reached the
> deployed Azure Function, which exchanged an OAuth token with Entra ID and
> PATCHed Dataverse via alternate-key upsert. The complete pipeline
> `Salesforce -> Azure Function -> Dataverse` is captured in Application
> Insights (operation `be917ed0-b70f-4378-8e5a-d1cdc1669f81`, 1009ms total,
> Dataverse returned `HTTP 201 Created`).
>
> See [`docs/images/appinsights-live-trace-v3.json`](images/appinsights-live-trace-v3.json)
> for the captured trace evidence with the full event timeline.
>
> **Note on the prior "scratch org proxy" diagnosis:** an earlier draft of this
> document claimed scratch orgs proxy outbound HTTP and 500 on
> `*.azurewebsites.net`. That diagnosis was incorrect. The actual cause of
> the earlier failures was (a) the deployed `package.json` had an invalid
> `main` glob that prevented the Functions runtime from registering any
> trigger, and (b) the callout tests were hitting the function cold, exceeding
> Apex's default 10s timeout. After fixing the source and warming the function,
> Apex callouts succeed in ~1.1s.

## Architecture under test

```
Salesforce scratch org  ->  Named Credential  ->  Azure Function (Event Grid trigger)  ->  Dataverse
                                                              |
                                                              v
                                                   Application Insights (trace sink)
```

| Resource | Name | Region | Notes |
|---|---|---|---|
| Resource group | `rg-universal-fabric-poc` | southeastasia | Single-RG deploy |
| Storage account | `yourfuncstg` | southeastasia | LRS, hosts deploy package |
| Log Analytics workspace | `your-log` | southeastasia | Workspace-mode App Insights backing store |
| Application Insights | `your-appinsights` | southeastasia | Workspace-mode, instrumentation key `00000000-…` |
| Function App | `your-func-app` | southeastasia | Windows Consumption (Y1), Node 22, Functions v4 |
| Salesforce scratch org | `test-scratch@example.com` | - | DevHub: `your-devhub@example.com` |

## Pipeline stages

### 1. Provision Azure resources

```powershell
az group create -n your-rg -l southeastasia
az storage account create -n yourfuncstg -g your-rg -l southeastasia --sku Standard_LRS
az monitor log-analytics workspace create -g your-rg -n your-log -l southeastasia
az monitor app-insights component create `
    --app your-appinsights --location southeastasia --resource-group your-rg `
    --workspace your-log --kind web
az functionapp create `
    -g your-rg -n your-func-app `
    --storage-account yourfuncstg `
    --consumption-plan-location southeastasia `
    --runtime node --runtime-version 22 --os-type Windows --functions-version 4
```

### 2. Deploy the Function App code

The `src/azure/` folder was zipped (excluding `node_modules` cache, `test/`, `coverage/`,
`local.settings.json`), uploaded to a public blob container, and the Function App was
configured to run from the blob URL via `WEBSITE_RUN_FROM_PACKAGE`:

```powershell
az storage blob upload ... --name azure-function-v3.zip
az storage container set-permission --name function-release --public-access blob
az functionapp config appsettings set -g your-rg -n your-func-app `
    --settings "WEBSITE_RUN_FROM_PACKAGE=https://yourfuncstg.blob.core.windows.net/function-release/azure-function-v3.zip"
az functionapp restart -g your-rg -n your-func-app
```

The deployed function (`Host.Functions.SalesforceCDCWebhook`) is confirmed via the
App Insights log stream:

```
Found the following functions:
Host.Functions.SalesforceCDCWebhook
Generating 1 job function(s)
1 functions loaded
registered EventGrid Endpoint = https://your-func-app.azurewebsites.net/runtime/webhooks/eventgrid
```

### 3. Smoke test the Function

Direct POST to the Event Grid webhook endpoint (using the `eventgrid_extension`
system key, not the function default host key — the Event Grid extension validates
the request signature):

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "aeg-event-type: Notification" \
  --data-binary "@test/salesforce-event.json" \
  "https://your-func-app.azurewebsites.net/runtime/webhooks/EventGrid?functionName=SalesforceCDCWebhook&code=$EVENTGRID_EXTENSION_KEY"
```

### 4. Capture the trace

The captured trace (full JSON in `docs/images/appinsights-live-trace-v2.json`):

**Smoke test 1** (cold start, Operation ID `62978d6237438d9f87d439a5c7825240`):

| Event | Timestamp (UTC) | Duration since start |
|---|---|---|
| EventGrid trigger fired | `2026-06-22T17:57:12.0238302Z` | 0ms |
| `Processing Event Grid event ID: smoke-001` | `17:57:12.2359703Z` | +212ms |
| `No Dataverse currency row found for ISO code 'USD'. Skipping currency bind.` | `17:57:15.4470253Z` | +3.4s (token cache miss) |
| `Executing idempotent patch for salesforceId 001smoke` | `17:57:15.4471139Z` | +3.4s |
| `Dataverse synchronization successful. Status Code: 201` | `17:57:21.7099570Z` | +9.7s |
| Function returned (Duration 9730.4ms, ResultCode 0) | end of invocation | total 9.7s |

**Smoke test 2** (warm, Operation ID `fe1bd482ac664eb952f798fd36041df7`):

| Event | Timestamp (UTC) | Duration since start |
|---|---|---|
| EventGrid trigger fired | `2026-06-22T18:06:16.7535573Z` | 0ms |
| `Processing Event Grid event ID: smoke-final-001` | `18:06:16.7636213Z` | +10ms |
| `No Dataverse currency row found for ISO code 'USD'...` | `18:06:16.9355500Z` | +182ms |
| `Executing idempotent patch for salesforceId 001finalsmoke` | `18:06:16.9355567Z` | +182ms |
| `Dataverse synchronization successful. Status Code: 201` | `18:06:17.4580689Z` | +704ms |
| Function returned (Duration 707.0ms, ResultCode 0) | end of invocation | total 707ms |

The second invocation runs **~14x faster** because the module-scope
`ClientSecretCredential` cache holds the Dataverse access token from the first
invocation, avoiding the Entra ID round trip.

**Dataverse side (verified directly via OData):**

```http
GET https://orgXXXXXXXX.crm5.dynamics.com/api/data/v9.2/accounts?$filter=crfe6_uen eq 'SMOKEUEN'
```
```json
{
  "name": "Smoke Test",
  "crfe6_uen": "SMOKEUEN",
  "crfe6_salesforceid": "001smoke",
  "createdon": "2026-06-22T17:57:16Z"
}
```

**What the trace proves:**

- The Function App's host initialised successfully and loaded the Event Grid extension.
- The trigger fired, the handler ran, the Entra ID token exchange succeeded.
- The outbound `axios.patch` against Dataverse succeeded with HTTP 201 (created).
- The alternate-key upsert (`crfe6_salesforceid=001smoke`) correctly resolved and persisted.
- Currency bind was skipped because the Dataverse env does not yet have USD configured — non-fatal; the record is still created with the environment's default currency.
- All events share an Operation ID, proving full distributed-trace correlation.

### 5. Salesforce side

A scratch org was created with `sf org create scratch`, the Salesforce source
(including two `RemoteSiteSetting` components for `httpbin_org` and
`ufp_func_sea`) was deployed, and an anonymous Apex script executed the
callout synchronously from `scripts/e2e-callout-diagnostic.apex`.

```apex
// scripts/e2e-callout-diagnostic.apex (Test 3 - the real end-to-end leg)
String EG_CODE = '<system-key from az functionapp keys list>';
String FUNC_HOST = 'your-func-app.azurewebsites.net';

HttpRequest r = new HttpRequest();
r.setEndpoint('https://' + FUNC_HOST
  + '/runtime/webhooks/EventGrid?functionName=SalesforceCDCWebhook&code=' + EG_CODE);
r.setMethod('POST');
r.setHeader('Content-Type', 'application/json');
r.setHeader('aeg-event-type', 'Notification');
r.setBody('[{"id":"sf-apex-live-1782157972204",'
  + '"eventType":"Salesforce.Vendor.Updated","subject":"VendorOnboarding/apex",'
  + '"eventTime":"2026-06-22T19:52:52Z",'
  + '"data":{"Id":"001apexlive","Name":"SF Apex Live Vendor",'
  + '"UEN__c":"APEXLIVE001","CurrencyIsoCode":"USD"},"dataVersion":"1.0"}]');
r.setTimeout(60000);  // Apex max; allow for cold start
HttpResponse res = new Http().send(r);
System.debug(LoggingLevel.INFO, 'TEST 3 EG webhook: status=' + res.getStatusCode());
// -> INFO|TEST 3 EG webhook: status=202 in 1106ms body=
```

**Result: HTTP 202 Accepted in 1106 ms.** The Azure Function executed in
1009 ms (visible in App Insights) and Dataverse returned `HTTP 201 Created`
for the alternate-key upsert of `crfe6_salesforceid=001apexlive`.

**Captured Application Insights trace** (operation id
`be917ed0-b70f-4378-8e5a-d1cdc1669f81`):

| Timestamp (UTC) | Event |
|---|---|
| `19:52:52.264` | EventGrid extension loaded (`webhookAuthorizationLevel=System`) |
| `19:52:52.265` | `Executing Functions.SalesforceCDCWebhook (Reason='EventGrid trigger fired')` |
| `19:52:52.273` | `Processing Event Grid event ID: sf-apex-live-1782157972204` |
| `19:52:52.727` | `No Dataverse currency row found for ISO code 'USD'. Skipping currency bind.` |
| `19:52:52.727` | `Executing idempotent patch for salesforceId 001apexlive` |
| `19:52:53.273` | `Dataverse synchronization successful. Status Code: 201` |
| `19:52:53.273` | `Executed Functions.SalesforceCDCWebhook (Succeeded, Duration=1008ms)` |

**Dataverse verification** (queried via OData right after the callout):

```http
GET https://orgXXXXXXXX.crm5.dynamics.com/api/data/v9.2/accounts
    ?$filter=crfe6_salesforceid eq '001apexlive'
```

```json
{
  "name": "SF Apex Live Vendor",
  "crfe6_uen": "APEXLIVE001",
  "crfe6_salesforceid": "001apexlive",
  "createdon": "2026-06-22T19:52:52Z"
}
```

> **Note on the trigger-driven path:** The `@future(callout=true)` async path
> (`VendorTrigger` -> `VendorTriggerHandler.sendVendorsToAzure`) is wired and
> exercised by the Apex test suite (`VendorTriggerHandlerTest`). The
> synchronous Apex callout above proves the network path
> `Salesforce -> Azure -> Dataverse` is healthy. The two paths share the
> same Named Credential / Remote Site configuration, so wiring the trigger
> to fire on real DML requires only pointing it at the same endpoint.

## How to reproduce

1. Provision the resources in `docs/e2e-walkthrough.md` §1.
2. Zip and deploy per §2.
3. Set real Dataverse env vars via `az functionapp config appsettings set`:
   `DATAVERSE_ENV_URL`, `DATAVERSE_CLIENT_ID`, `DATAVERSE_CLIENT_SECRET`,
   `DATAVERSE_TENANT_ID`.
4. Run the smoke test per §3.
5. Query Application Insights via Log Analytics to retrieve the trace:

   ```kusto
   AppRequests
   | where Name == "SalesforceCDCWebhook"
   | order by TimeGenerated desc
   ```

## Trigger-driven end-to-end (2026-06-23)

The previous section proves the synchronous Apex callout leg. This section
documents the **trigger-driven** leg: a real Account insert fires
`VendorTrigger`, which queues `VendorTriggerHandler.sendVendorsToAzure`
(`@future(callout=true)`), which makes the callout, which lands in Dataverse.

### Setup

1. **Bump handler timeout.** Apex's default `setTimeout(10000)` cannot survive
   a Windows Consumption cold start. `VendorTriggerHandler` was updated:

   ```apex
   req.setTimeout(60000);  // was 10000; bumped for cold-start tolerance
   ```

2. **Patch the Named Credential at runtime.** The `Azure_EventGrid_Endpoint`
   NC ships with a placeholder URL (the live function URL contains a secret
   EG extension key we don't want in source). At test time, `scripts/update-nc.apex`
   uses the Tooling API to patch the NC endpoint to
   `https://your-func-app.azurewebsites.net/runtime/webhooks/EventGrid?functionName=SalesforceCDCWebhook&code=<key>`.

3. **Use a deployed Apex class, not anonymous Apex.** Anonymous Apex uses a
   different (cached) schema view than compiled Apex; on fresh scratch orgs
   this caused `Field does not exist: UEN__c on Account` errors when run
   via `sf apex run`. The workaround is to deploy a small wrapper class
   (`scripts/FireTriggerE2E.cls`) that performs the insert inside compiled
   Apex, where `UEN__c` is visible.

### Execution

```apex
// scripts/call-fire.apex
FireTriggerE2E.fire();  // inserts Account with UEN__c='TRIGGERE2E001'
```

The insert fires `VendorTrigger`, which queues the `@future` job. Within
about a minute the `@future` runs and the Account's `Sync_Status__c` is
stamped to `Synced` (or `Error` if the callout failed).

### Result

**Account after `@future` flush:**

```
STATUS=Synced NAME=Trigger-Driven E2E Vendor 1782189248746 CREATED=2026-06-23 04:34:08
```

**App Insights request** (operation `46b72d1555d05616`):

| Field | Value |
|---|---|
| `Name` | `SalesforceCDCWebhook` |
| `Success` | `True` |
| `DurationMs` | `2186` |
| `TimeGenerated` | `2026-06-23T04:34:57.905Z` |

**Dataverse record** (queried via OData after the `@future` flush):

```json
{
  "name": "Trigger-Driven E2E Vendor 1782189248746",
  "crfe6_uen": "TRIGGERE2E001",
  "crfe6_salesforceid": "001C200000R2gEzIAJ",
  "createdon": "2026-06-23T04:34:59Z"
}
```

`crfe6_salesforceid` matches the Salesforce Account Id (`001C200000R2gEzIAJ`),
proving the round-trip identity propagation. Full structured trace in
[`docs/images/appinsights-live-trace-v4-trigger-driven.json`](images/appinsights-live-trace-v4-trigger-driven.json).

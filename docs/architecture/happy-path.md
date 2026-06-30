# Happy path

The successful end-to-end flow when a user (or an integration user) creates or
updates a vendor Account in Salesforce.

## Sequence diagram

```mermaid
sequenceDiagram
    autonumber
    actor User as Salesforce User
    participant SF as Salesforce (Apex)
    participant NC as Named Credential<br/>Azure_EventGrid_Endpoint
    participant EG as Azure Event Grid
    participant FN as Azure Function<br/>SalesforceCDCWebhook
    participant AAD as Entra ID
    participant DV as Dataverse<br/>accounts table
    participant PLG as C# Plugin<br/>AccountUpdateStampPlugin
    participant MDA as Vendor Onboarding Hub<br/>(model-driven app)

    User->>SF: Update Account.Name / UEN__c / CurrencyIsoCode
    activate SF
    Note over SF: VendorTrigger (after update)<br/>diffs old vs new on<br/>Name, UEN__c, CurrencyIsoCode<br/>No change? skip callout.
    SF->>SF: VendorTriggerHandler.sendVendorsToAzure()<br/>@future(callout=true)
    Note over SF: Per-transaction recursion guard<br/>static Set&lt;Id&gt; processedVendorIds
    SF->>NC: HTTP POST Event Grid payload
    deactivate SF
    NC->>EG: deliver event
    EG->>FN: trigger (push)
    activate FN
    Note over FN: tracer.startSpan("salesforce.cdc.ingest")<br/>attributes: event.id, event.type, event.subject
    FN->>AAD: ClientSecretCredential.getToken()<br/>(module-scope cached)
    AAD-->>FN: Bearer token
    FN->>DV: GET transactioncurrencies?$filter=isocurrencycode eq '...'
    DV-->>FN: transactioncurrencyid
    FN->>FN: tracer.startSpan("dataverse.upsert")
    FN->>DV: PATCH accounts(crfe6_salesforceid='...')<br/>{name, crfe6_uen, transactioncurrencyid@odata.bind}
    activate DV
    Note over DV: Alternate-key index resolves<br/>upsert in one round trip
    DV->>PLG: pre-operation Update on account<br/>(filtering attrs: crfe6_salesforceid, crfe6_uen)
    PLG->>DV: stamp Target<br/>crfe6_lastmodifiedbyintegration_at<br/>crfe6_sync_notes
    DV-->>FN: 200/204 (upserted row)
    deactivate DV
    FN-->>EG: ack
    deactivate FN
    Note over SF: @future resumes,<br/>HTTP 2xx → Sync_Status__c = 'Synced'
    User->>MDA: open Pending Salesforce Sync view
    MDA->>DV: fetch accounts where crfe6_salesforceid != null
    DV-->>MDA: rows with stamped audit fields
```

## Walkthrough

1. **Trigger source.** A user edits a vendor Account's `Name`, `UEN__c`, or
   `CurrencyIsoCode`. `VendorTrigger` fires `after update`.
2. **Field-change filter.** The trigger diffs `Trigger.new` against
   `Trigger.oldMap` on the three synced fields. If none changed — for example
   an ownership change — the trigger body skips the callout entirely. This
   protects the daily `@future` callout budget.
3. **Recursion guard.** `VendorTriggerHandler.sendVendorsToAzure` is annotated
   `@future(callout=true)`. A `private static Set<Id> processedVendorIds`
   guards against re-entry within the same transaction. The handler re-queries
   the records rather than trusting the trigger's in-memory `Trigger.new` —
   the async context loses that.
4. **Named Credential callout.** `HttpRequest.setEndpoint('callout:Azure_EventGrid_Endpoint')`
   resolves the URL and auth from the Named Credential, so no secret is in
   Apex source.
5. **Event Grid delivery.** Salesforce's POST arrives at the Event Grid topic
   endpoint. Event Grid pushes it to the Function's webhook trigger.
6. **Cold start.** Module load fires `src/telemetry.js`, which starts the OTel
   `NodeSDK` (only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set) and registers
   `HttpInstrumentation`. The Function handler opens the
   `salesforce.cdc.ingest` parent span.
7. **Token cache.** `getCredential()` returns a module-scoped
   `ClientSecretCredential`, so the in-memory token cache survives across
   invocations within the same worker lifetime.
8. **Currency lookup.** `transactioncurrencyid` has no alternate key, so the
   Function resolves the GUID via `$filter=isocurrencycode eq '<code>'` and
   builds a single-value `@odata.bind` reference.
9. **Idempotent upsert.** The Function PATCHes
   `accounts(crfe6_salesforceid='<encoded>')`. Dataverse resolves the
   alternate-key index, inserts or updates atomically, and returns 200/204.
10. **Plugin stamp.** The C# `AccountUpdateStampPlugin` runs in
    `PreOperation` on `Update` of `account` when `crfe6_salesforceid` or
    `crfe6_uen` is in the filtering attributes. It mutates the inbound `Target`
    `Entity` so the stamp lands in the same SQL `UPDATE`, no re-entry.
11. **Span children.** Auto-instrumented `HTTP CLIENT` spans hang off the
    `dataverse.upsert` span for the currency GET and the PATCH, correlated by
    OTel context propagation.
12. **`Sync_Status__c` flip.** Back in the `@future` context, an HTTP 2xx flips
    `Sync_Status__c` to `Synced`. A 4xx/5xx (or `CalloutException`) leaves it
    on `Error`. That `update` re-fires the trigger, but the after-update
    branch's field-change filter means `Sync_Status__c`-only changes are a
    no-op — no infinite loop.
13. **Reviewer view.** The admin opens the **Vendor Onboarding Hub** MDA,
    picks **Pending Salesforce Sync**, sees the new row with audit fields
    stamped by the plugin.

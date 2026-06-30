public with sharing class VendorTriggerHandler {
    // Per-transaction recursion guard. Idempotent across re-entry within the same transaction.
    private static Set<Id> processedVendorIds = new Set<Id>();

    @future(callout=true)
    public static void sendVendorsToAzure(Set<Id> vendorIds) {
        Set<Id> pending = new Set<Id>();
        for (Id id : vendorIds) {
            if (!processedVendorIds.contains(id)) {
                pending.add(id);
            }
        }
        if (pending.isEmpty()) return;
        processedVendorIds.addAll(pending);

        List<Account> vendors = [
            SELECT Id, Name, UEN__c, CurrencyIsoCode
            FROM Account
            WHERE Id IN :pending
        ];
        if (vendors.isEmpty()) return;

        List<Map<String, Object>> eventGridPayload = new List<Map<String, Object>>();
        for (Account v : vendors) {
            Map<String, Object> event = new Map<String, Object>();
            event.put('id', String.valueOf(UUID.randomUUID()));
            event.put('eventType', 'Salesforce.Vendor.Updated');
            event.put('subject', 'VendorOnboarding/' + v.Id);
            event.put('eventTime', DateTime.now().formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\''));
            event.put('dataVersion', '1.0');

            Map<String, Object> dataFields = new Map<String, Object>();
            dataFields.put('Id', v.Id);
            dataFields.put('Name', v.Name);
            dataFields.put('UEN__c', v.UEN__c);
            dataFields.put('CurrencyIsoCode', v.CurrencyIsoCode);
            event.put('data', dataFields);

            eventGridPayload.add(event);
        }

        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:Azure_EventGrid_Endpoint');
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setHeader('aeg-event-type', 'Notification');
        req.setBody(JSON.serialize(eventGridPayload));
        // Apex max is 60s. Cold-start on Consumption-tier Functions can be 10-30s,
        // so 60s is the right default for a single-callout future job.
        req.setTimeout(60000);

        // Start from the assumption the callout will fail; flip to 'Synced' only on a 2xx.
        // Doing this before the try block means both CalloutException and 4xx/5xx land on 'Error'.
        String resolvedStatus = 'Error';

        Http http = new Http();
        try {
            HttpResponse res = http.send(req);
            Integer code = res.getStatusCode();
            if (code >= 200 && code < 300) {
                resolvedStatus = 'Synced';
            } else {
                System.debug(LoggingLevel.ERROR,
                    'Azure Event Grid returned status ' + code + ': ' + res.getBody());
            }
        } catch (CalloutException e) {
            System.debug(LoggingLevel.ERROR, 'Callout failed: ' + e.getMessage());
        }

        stampSyncStatus(vendors, resolvedStatus);
    }

    @testVisible
    private static void stampSyncStatus(List<Account> vendors, String status) {
        List<Account> updates = new List<Account>();
        for (Account v : vendors) {
            updates.add(new Account(Id = v.Id, Sync_Status__c = status));
        }
        // update triggers VendorTrigger again — but the after-update branch filters on
        // Name/UEN__c/CurrencyIsoCode only, so a Sync_Status__c-only change is a no-op.
        try {
            update updates;
        } catch (DmlException e) {
            System.debug(LoggingLevel.ERROR,
                'Failed to persist Sync_Status__c=' + status + ': ' + e.getMessage());
        }
    }

    @testVisible
    private static void resetRecursionGuard() {
        processedVendorIds.clear();
    }
}

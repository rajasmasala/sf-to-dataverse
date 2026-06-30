trigger VendorTrigger on Account (after insert, after update) {
    Set<Id> validVendorIds = new Set<Id>();

    if (Trigger.isInsert) {
        // All inserts are new state — every vendor must sync.
        for (Account acc : Trigger.new) {
            validVendorIds.add(acc.Id);
        }
    } else if (Trigger.isUpdate) {
        // Only sync when at least one of the synced fields changed.
        // Avoids burning @future callout limits on no-op edits (e.g. owner, stage, description).
        for (Account acc : Trigger.new) {
            Account old = (Account) Trigger.oldMap.get(acc.Id);
            if (acc.Name != old.Name
                    || acc.UEN__c != old.UEN__c
                    || acc.CurrencyIsoCode != old.CurrencyIsoCode) {
                validVendorIds.add(acc.Id);
            }
        }
    }

    if (!validVendorIds.isEmpty()) {
        VendorTriggerHandler.sendVendorsToAzure(validVendorIds);
    }
}

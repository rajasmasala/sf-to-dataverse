public with sharing class VendorSyncStatusController {
    // Security posture: `with sharing` enforces record-level sharing on this
    // user-facing (@AuraEnabled) read path. Field-level security is intentionally
    // NOT enforced here (no WITH SECURITY_ENFORCED): enabling it requires a
    // permission set granting the dashboard's audience read access to UEN__c /
    // Sync_Status__c, otherwise the running user hits "secure query included
    // inaccessible field" and the dashboard fails to load. Tracked as a hardening
    // follow-up — see README "Security & compliance posture".
    /**
     * Returns the most recently touched vendor Accounts, newest first, with the
     * fields the Vendor Onboarding dashboard renders. Use the Account's
     * Sync_Status__c directly; falls back to "Pending" when the picklist is blank
     * so the dashboard never surfaces a null status column.
     */
    @AuraEnabled(cacheable=true)
    public static List<VendorSyncDTO> getRecentSyncedVendors(Integer limitSize) {
        Integer rowLimit = (limitSize == null || limitSize <= 0) ? 50 : Math.min(limitSize, 200);

        List<Account> accounts = [
            SELECT Id, Name, UEN__c, CurrencyIsoCode, Sync_Status__c, LastModifiedDate
            FROM Account
            ORDER BY LastModifiedDate DESC
            LIMIT :rowLimit
        ];

        return toDTO(accounts);
    }

    /**
     * Returns only vendors whose last sync attempt failed (Sync_Status__c = 'Error').
     * Used by the dashboard's separate "Failed syncs" tile so operators can find
     * them without scrolling the main table.
     */
    @AuraEnabled(cacheable=true)
    public static List<VendorSyncDTO> getFailedSyncs(Integer limitSize) {
        Integer rowLimit = (limitSize == null || limitSize <= 0) ? 50 : Math.min(limitSize, 200);

        List<Account> accounts = [
            SELECT Id, Name, UEN__c, CurrencyIsoCode, Sync_Status__c, LastModifiedDate
            FROM Account
            WHERE Sync_Status__c = 'Error'
            ORDER BY LastModifiedDate DESC
            LIMIT :rowLimit
        ];

        return toDTO(accounts);
    }

    private static List<VendorSyncDTO> toDTO(List<Account> accounts) {
        List<VendorSyncDTO> rows = new List<VendorSyncDTO>();
        for (Account a : accounts) {
            VendorSyncDTO row = new VendorSyncDTO();
            row.accountId = a.Id;
            row.name = a.Name;
            row.uen = a.UEN__c;
            row.currencyIsoCode = a.CurrencyIsoCode;
            row.lastModified = a.LastModifiedDate;
            // Defensive: a record inserted before Sync_Status__c existed may have null.
            row.syncStatus = String.isBlank(a.Sync_Status__c) ? 'Pending' : a.Sync_Status__c;
            rows.add(row);
        }
        return rows;
    }

    public class VendorSyncDTO {
        @AuraEnabled public Id accountId { get; set; }
        @AuraEnabled public String name { get; set; }
        @AuraEnabled public String uen { get; set; }
        @AuraEnabled public String currencyIsoCode { get; set; }
        @AuraEnabled public Datetime lastModified { get; set; }
        @AuraEnabled public String syncStatus { get; set; }
    }
}

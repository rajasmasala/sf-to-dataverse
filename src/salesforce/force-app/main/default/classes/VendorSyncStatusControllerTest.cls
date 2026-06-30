@isTest
private class VendorSyncStatusControllerTest {
    @testSetup
    static void setupTestData() {
        // Inserts fire VendorTrigger -> @future(callout=true). The queued @future
        // executes inside @testSetup's own governor context, so the callout mock
        // must be registered BEFORE the inserts happen here, otherwise the
        // callout surfaces as "Methods defined as TestMethod do not support
        // Web service callouts".
        Test.setMock(HttpCalloutMock.class, new NoopCalloutMock());
        insert new List<Account>{
            new Account(Name = 'Synced Vendor',  UEN__c = '202611111A'),
            new Account(Name = 'Pending Vendor', UEN__c = '202622222B'),
            new Account(Name = 'Failed Vendor',  UEN__c = '202633333C'),
            new Account(Name = 'Another Failed', UEN__c = '202644444D')
        };

        // Force the queued @future(callout=true) from the inserts above to flush
        // NOW, inside @testSetup, so it doesn't leak into the test methods.
        // After the flush, the mock will have stamped every Account as 'Synced'.
        // We then re-stamp the deterministic statuses the controller tests
        // actually assert on. We only touch Sync_Status__c here, so the trigger's
        // Name/UEN__c/CurrencyIsoCode field-change filter treats this as a no-op
        // and does not enqueue another @future.
        Test.startTest();
        Test.stopTest();

        List<Account> seeded = [
            SELECT Id, Name FROM Account
            WHERE Name IN ('Synced Vendor', 'Pending Vendor', 'Failed Vendor', 'Another Failed')
        ];
        for (Account a : seeded) {
            if (a.Name == 'Synced Vendor') {
                a.Sync_Status__c = 'Synced';
            } else if (a.Name == 'Pending Vendor') {
                a.Sync_Status__c = ''; // blank -> controller maps to 'Pending'
            } else {
                a.Sync_Status__c = 'Error';
            }
        }
        update seeded;
    }

    // No-op mock used solely to satisfy Salesforce's "callouts not allowed in
    // test methods" rule when @testSetup's inserts fire the trigger.
    private class NoopCalloutMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(200);
            res.setBody('{}');
            return res;
        }
    }

    @isTest
    static void testGetRecentSyncedVendorsReturnsAll() {
        Test.setMock(HttpCalloutMock.class, new NoopCalloutMock());
        Test.startTest();
        List<VendorSyncStatusController.VendorSyncDTO> rows =
            VendorSyncStatusController.getRecentSyncedVendors(50);
        Test.stopTest();

        System.assertEquals(4, rows.size(), 'All seeded vendors should be returned');
        // Read the scratch org's default currency rather than hard-coding it;
        // scratch orgs default to USD unless currencySettings.defaultCurrencyIsoCode
        // is set in project-scratch-def.json, and we don't want CI to be brittle.
        Set<String> names = new Set<String>();
        Set<String> currencies = new Set<String>();
        for (VendorSyncStatusController.VendorSyncDTO row : rows) {
            names.add(row.name);
            currencies.add(row.currencyIsoCode);
            System.assert(row.accountId != null, 'accountId must be populated');
            System.assert(row.syncStatus != null, 'syncStatus must never be null');
        }
        System.assertEquals(1, currencies.size(), 'All seeded vendors share the org default currency');
        System.assert(names.contains('Synced Vendor'));
        System.assert(names.contains('Pending Vendor'));
    }

    @isTest
    static void testPendingStatusFallbackWhenBlank() {
        Test.setMock(HttpCalloutMock.class, new NoopCalloutMock());
        Test.startTest();
        List<VendorSyncStatusController.VendorSyncDTO> rows =
            VendorSyncStatusController.getRecentSyncedVendors(50);
        Test.stopTest();

        VendorSyncStatusController.VendorSyncDTO pending = null;
        for (VendorSyncStatusController.VendorSyncDTO row : rows) {
            if (row.name == 'Pending Vendor') {
                pending = row;
            }
        }
        System.assertNotEquals(null, pending, 'Pending Vendor should be in result set');
        System.assertEquals('Pending', pending.syncStatus, 'Blank picklist should map to Pending');
    }

    @isTest
    static void testGetFailedSyncsFiltersByError() {
        Test.setMock(HttpCalloutMock.class, new NoopCalloutMock());
        Test.startTest();
        List<VendorSyncStatusController.VendorSyncDTO> failed =
            VendorSyncStatusController.getFailedSyncs(50);
        Test.stopTest();

        System.assertEquals(2, failed.size(), 'Only the two Error vendors should return');
        for (VendorSyncStatusController.VendorSyncDTO row : failed) {
            System.assertEquals('Error', row.syncStatus);
        }
    }

    @isTest
    static void testLimitParameterClamped() {
        // limit <= 0 should default to 50; passing null should also be tolerated.
        Test.setMock(HttpCalloutMock.class, new NoopCalloutMock());
        Test.startTest();
        List<VendorSyncStatusController.VendorSyncDTO> defaultRows =
            VendorSyncStatusController.getRecentSyncedVendors(null);
        List<VendorSyncStatusController.VendorSyncDTO> zeroRows =
            VendorSyncStatusController.getRecentSyncedVendors(0);
        Test.stopTest();

        System.assertEquals(4, defaultRows.size(), 'null limit should fall back to default');
        System.assertEquals(4, zeroRows.size(),  'zero limit should fall back to default');
    }
}

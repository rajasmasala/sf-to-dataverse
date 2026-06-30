@isTest
private class VendorTriggerHandlerTest {
    private static final String UEN = '202612345G';

    @testSetup
    static void setupTestData() {
        // Inserts fire VendorTrigger -> @future(callout=true). The queued @future
        // executes inside @testSetup's own governor context, so the callout mock
        // must be registered BEFORE the inserts happen here, otherwise the
        // callout surfaces as "Methods defined as TestMethod do not support
        // Web service callouts". We also explicitly flush the queued @future
        // here via Test.startTest()/Test.stopTest() so it doesn't leak into
        // the test methods (which would cause their own @future flush to fail
        // with the same callout error since Salesforce only synchronously
        // executes one @future per Test.stopTest()).
        Test.setMock(HttpCalloutMock.class, new SuccessMock());
        insert new List<Account>{
            new Account(Name = 'Acme Pre-Update', UEN__c = UEN),
            new Account(Name = 'Recursion Guard', UEN__c = '202611111X'),
            new Account(Name = 'NoOp Vendor',     UEN__c = '202655555Y'),
            new Account(Name = 'Relevant Vendor', UEN__c = '202666666Z')
        };
        Test.startTest();
        Test.stopTest();
    }

    private class SuccessMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(200);
            res.setBody('{}');
            return res;
        }
    }

    private class ErrorMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(500);
            res.setBody('{"error":"boom"}');
            return res;
        }
    }

    // Counts callouts so we can assert the field-change filter suppresses no-op updates.
    private static Integer calloutCount = 0;
    private class CountingMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            calloutCount++;
            HttpResponse res = new HttpResponse();
            res.setStatusCode(200);
            res.setBody('{}');
            return res;
        }
    }

    private class ThrowingMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            throw new CalloutException('Simulated network failure');
        }
    }

    @isTest
    static void testInsertFiresCalloutAndStampsSynced() {
        Test.setMock(HttpCalloutMock.class, new SuccessMock());
        Test.startTest();
        insert new Account(Name = 'Merlion Tech Dynamics Pte Ltd', UEN__c = '202677777A');
        Test.stopTest();

        List<Account> inserted = [
            SELECT Id, Sync_Status__c FROM Account
            WHERE Name = 'Merlion Tech Dynamics Pte Ltd'
        ];
        System.assertEquals(1, inserted.size(), 'Account should be inserted');
        System.assertEquals('Synced', inserted[0].Sync_Status__c,
            'Successful 2xx callout must persist Sync_Status__c = Synced');
    }

    @isTest
    static void testUpdateFiresCallout() {
        Account a = [SELECT Id FROM Account WHERE Name = 'Acme Pre-Update' LIMIT 1];
        VendorTriggerHandler.resetRecursionGuard();

        Test.setMock(HttpCalloutMock.class, new SuccessMock());
        Test.startTest();
        update new Account(Id = a.Id, Name = 'Acme Post-Update');
        Test.stopTest();

        Account refreshed = [SELECT Name, Sync_Status__c FROM Account WHERE Id = :a.Id];
        System.assertEquals('Acme Post-Update', refreshed.Name);
        System.assertEquals('Synced', refreshed.Sync_Status__c,
            'Update + 2xx callout must persist Synced status');
    }

    @isTest
    static void testCalloutErrorDoesNotPropagateAndStampsError() {
        Test.setMock(HttpCalloutMock.class, new ErrorMock());
        Test.startTest();
        insert new Account(Name = 'Error Vendor', UEN__c = '202698765W');
        Test.stopTest();

        List<Account> inserted = [
            SELECT Id, Sync_Status__c FROM Account WHERE Name = 'Error Vendor'
        ];
        System.assertEquals(1, inserted.size());
        System.assertEquals('Error', inserted[0].Sync_Status__c,
            '4xx/5xx response must persist Sync_Status__c = Error');
    }

    @isTest
    static void testCalloutExceptionStampsError() {
        // Throwing from the mock simulates a CalloutException path (network/limits).
        Test.setMock(HttpCalloutMock.class, new ThrowingMock());
        Test.startTest();
        insert new Account(Name = 'Exception Vendor', UEN__c = '202600000Q');
        Test.stopTest();

        List<Account> inserted = [
            SELECT Id, Sync_Status__c FROM Account WHERE Name = 'Exception Vendor'
        ];
        System.assertEquals(1, inserted.size());
        System.assertEquals('Error', inserted[0].Sync_Status__c,
            'CalloutException must persist Sync_Status__c = Error');
    }

    @isTest
    static void testRecursionGuardSkipsDuplicates() {
        Account a = [SELECT Id FROM Account WHERE Name = 'Recursion Guard' LIMIT 1];
        VendorTriggerHandler.resetRecursionGuard();

        Test.setMock(HttpCalloutMock.class, new SuccessMock());
        Test.startTest();
        update new Account(Id = a.Id, Name = 'Second Update Same Txn');
        Test.stopTest();

        System.assertEquals(1, [SELECT COUNT() FROM Account WHERE Name = 'Second Update Same Txn']);
    }

    @isTest
    static void testNoOpUpdateDoesNotFireCallout() {
        Account a = [SELECT Id FROM Account WHERE Name = 'NoOp Vendor' LIMIT 1];
        VendorTriggerHandler.resetRecursionGuard();

        calloutCount = 0;
        Test.setMock(HttpCalloutMock.class, new CountingMock());
        Test.startTest();
        update new Account(Id = a.Id, Description = 'Updated description only');
        Test.stopTest();
        System.assertEquals(0, calloutCount, 'No-op update must not fire a callout');
    }

    @isTest
    static void testRelevantFieldUpdateFiresCallout() {
        Account a = [SELECT Id FROM Account WHERE Name = 'Relevant Vendor' LIMIT 1];
        VendorTriggerHandler.resetRecursionGuard();

        calloutCount = 0;
        Test.setMock(HttpCalloutMock.class, new CountingMock());
        Test.startTest();
        update new Account(Id = a.Id, Name = 'Relevant Vendor Renamed');
        Test.stopTest();
        System.assertEquals(1, calloutCount, 'Relevant-field update should fire exactly one callout');
    }
}

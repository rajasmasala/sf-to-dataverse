// Standalone class to fire the trigger-driven test.
// Anonymous Apex uses a different (cached) schema view than compiled classes,
// so we deploy this as a class to ensure UEN__c / Sync_Status__c resolve.

global class FireTriggerE2E {
    global static void fire() {
        Account a = new Account(
            Name = 'Trigger-Driven E2E Vendor ' + Datetime.now().getTime(),
            UEN__c = 'TRIGGERE2E001',
            CurrencyIsoCode = 'USD'
        );
        insert a;
        System.debug(LoggingLevel.INFO, 'INSERTED_ID: ' + a.Id);
        System.debug(LoggingLevel.INFO, 'INSERTED_NAME: ' + a.Name);
        // Give the @future job a moment to enqueue
        System.debug(LoggingLevel.INFO, 'TRIGGER_FIRED');
    }

    // Self-test method we can run via apex:test:run to verify the trigger actually fired.
    global static String checkStatus() {
        List<Account> recent = [
            SELECT Id, Name, UEN__c, Sync_Status__c, CreatedDate
            FROM Account
            WHERE UEN__c = 'TRIGGERE2E001'
            ORDER BY CreatedDate DESC
            LIMIT 1
        ];
        if (recent.isEmpty()) {
            return 'NO_ACCOUNT_FOUND';
        }
        Account a = recent[0];
        return 'STATUS=' + a.Sync_Status__c + ' NAME=' + a.Name + ' CREATED=' + a.CreatedDate;
    }
}

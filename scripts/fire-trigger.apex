// Insert a real Account, which will fire VendorTrigger -> VendorTriggerHandler.sendVendorsToAzure @future job.
// After Test.stopTest equivalent (insert commits the trigger), wait for the @future to execute, then poll AsyncApexJob.

// First, warm the Azure function with a direct call so cold-start doesn't trip Apex timeout.
// (Done from PowerShell already.)

// Insert the account
Account a = new Account(
    Name = 'Trigger-Driven E2E Vendor ' + Datetime.now().getTime(),
    UEN__c = 'TRIGGERE2E001',
    CurrencyIsoCode = 'USD'
);
insert a;
System.debug(LoggingLevel.INFO, 'Inserted Account Id: ' + a.Id);
System.debug(LoggingLevel.INFO, 'Inserted Account Name: ' + a.Name);

// Capture the inserted account so we can look up its Salesforce Id externally
String sfId = a.Id;
System.debug(LoggingLevel.INFO, 'SF_ID_FOR_LOOKUP:' + sfId);

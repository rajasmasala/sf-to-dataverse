// E2E live integration smoke trigger.
// Inserts a single Account, which fires VendorTrigger -> VendorTriggerHandler.sendVendorsToAzure
// -> HTTP POST to callout:Azure_EventGrid_Endpoint.
// Used by docs/e2e-walkthrough.md. Safe to re-run.
Account a = new Account(
    Name = 'E2E Live Test ' + DateTime.now().getTime(),
    CurrencyIsoCode = 'USD'
);
insert a;
System.debug('E2E: inserted Account ' + a.Id);

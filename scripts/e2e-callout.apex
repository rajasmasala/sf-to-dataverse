HttpRequest req = new HttpRequest();
req.setEndpoint('callout:Azure_EventGrid_Endpoint');
req.setMethod('POST');
req.setHeader('Content-Type', 'application/json');
req.setHeader('aeg-event-type', 'Notification');
req.setBody('[{"id":"sf-apex-test-001","eventType":"Salesforce.Vendor.Updated","subject":"VendorOnboarding/apextest","eventTime":"2026-06-22T14:10:00Z","data":{"Id":"001test","Name":"SF Apex Test","UEN__c":"TESTUEN","CurrencyIsoCode":"USD"},"dataVersion":"1.0"}]');
req.setTimeout(10000);
Http http = new Http();
try {
    HttpResponse res = http.send(req);
    System.debug(LoggingLevel.INFO, 'SF->Azure status: ' + res.getStatusCode());
    System.debug(LoggingLevel.INFO, 'SF->Azure body: ' + res.getBody());
} catch (Exception e) {
    System.debug(LoggingLevel.ERROR, 'Callout exception: ' + e.getMessage());
}
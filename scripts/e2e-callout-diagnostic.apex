// Re-test the Apex callout now that we know:
//   - Remote Site Settings are deployed (httpbin + Azure Function host)
//   - Function is warm (just received a call at 19:36 UTC)
//   - Previous "Read timed out" was because function was cold
// Apex max timeout is 60s, so let's use it.

String EG_CODE = 'KSpiJuAkyDzZOEKQcdrEXkBwkNOAQYxXa2nQ2-g5adlQAzFuJFimIA==';
String FUNC_HOST = 'your-func-app.azurewebsites.net';

// Test 1: httpbin sanity (still should work)
try {
    HttpRequest r = new HttpRequest();
    r.setEndpoint('https://httpbin.org/get');
    r.setMethod('GET');
    r.setTimeout(60000);
    HttpResponse res = new Http().send(r);
    System.debug(LoggingLevel.INFO, 'TEST 1 httpbin: status=' + res.getStatusCode());
} catch (Exception e) {
    System.debug(LoggingLevel.ERROR, 'TEST 1 httpbin FAIL: ' + e.getTypeName() + ' -> ' + e.getMessage());
}

// Test 2: Azure function root (cold-start test)
try {
    HttpRequest r = new HttpRequest();
    r.setEndpoint('https://' + FUNC_HOST + '/');
    r.setMethod('GET');
    r.setTimeout(60000);  // Apex max is 60s
    HttpResponse res = new Http().send(r);
    System.debug(LoggingLevel.INFO, 'TEST 2 azure root: status=' + res.getStatusCode() + ' body=' + res.getBody().left(200));
} catch (Exception e) {
    System.debug(LoggingLevel.ERROR, 'TEST 2 azure root FAIL: ' + e.getTypeName() + ' -> ' + e.getMessage());
}

// Test 3: Event Grid webhook (THE REAL TEST)
try {
    String url = 'https://' + FUNC_HOST + '/runtime/webhooks/EventGrid?functionName=SalesforceCDCWebhook&code=' + EG_CODE;
    HttpRequest r = new HttpRequest();
    r.setEndpoint(url);
    r.setMethod('POST');
    r.setHeader('Content-Type', 'application/json');
    r.setHeader('aeg-event-type', 'Notification');
    String eventId = 'sf-apex-live-' + Datetime.now().getTime();
    r.setBody('[{"id":"' + eventId + '","eventType":"Salesforce.Vendor.Updated","subject":"VendorOnboarding/apex","eventTime":"' + Datetime.now().formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\'') + '","data":{"Id":"001apexlive","Name":"SF Apex Live Vendor","UEN__c":"APEXLIVE001","CurrencyIsoCode":"USD"},"dataVersion":"1.0"}]');
    r.setTimeout(60000);  // Apex max
    Long startMs = Datetime.now().getTime();
    HttpResponse res = new Http().send(r);
    Long elapsedMs = Datetime.now().getTime() - startMs;
    System.debug(LoggingLevel.INFO, 'TEST 3 EG webhook: status=' + res.getStatusCode() + ' in ' + elapsedMs + 'ms body=' + res.getBody().left(300));
} catch (Exception e) {
    System.debug(LoggingLevel.ERROR, 'TEST 3 EG webhook FAIL: ' + e.getTypeName() + ' -> ' + e.getMessage());
}

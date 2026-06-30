// Update the Azure_EventGrid_Endpoint Named Credential via Tooling API Metadata field.
// Tooling API requires the full Metadata sub-object on PATCH.
String egKey = 'KSpiJuAkyDzZOEKQcdrEXkBwkNOAQYxXa2nQ2-g5adlQAzFuJFimIA==';
String realUrl = 'https://your-func-app.azurewebsites.net/runtime/webhooks/EventGrid?functionName=SalesforceCDCWebhook&code=' + egKey;

String instanceUrl = URL.getOrgDomainUrl().toExternalForm();

// 1. Get the NC Id via Tooling API
String qUrl = instanceUrl + '/services/data/v59.0/tooling/query/?q='
  + EncodingUtil.urlEncode('SELECT Id FROM NamedCredential WHERE DeveloperName=\'Azure_EventGrid_Endpoint\'', 'UTF-8');

HttpRequest q = new HttpRequest();
q.setEndpoint(qUrl);
q.setMethod('GET');
q.setHeader('Authorization', 'Bearer ' + UserInfo.getSessionId());
q.setHeader('Content-Type', 'application/json');

String ncId = null;
try {
    HttpResponse qr = new Http().send(q);
    System.debug(LoggingLevel.INFO, 'Q status: ' + qr.getStatusCode() + ' body: ' + qr.getBody());
    if (qr.getStatusCode() == 200) {
        Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(qr.getBody());
        List<Object> recs = (List<Object>) parsed.get('records');
        if (!recs.isEmpty()) {
            Map<String, Object> first = (Map<String, Object>) recs[0];
            ncId = (String) first.get('Id');
        }
    }
} catch (Exception e) {
    System.debug(LoggingLevel.ERROR, 'Q failed: ' + e.getMessage());
}

if (ncId == null) {
    System.debug(LoggingLevel.ERROR, 'No NC found, aborting.');
} else {
    System.debug(LoggingLevel.INFO, 'Patching NC Id: ' + ncId);

    // 2. Build the Metadata sub-object payload as JSON.
    // Tooling API expects: { "Metadata": { ...full named credential metadata... } }
    Map<String, Object> metadata = new Map<String, Object>{
        'fullName' => 'Azure_EventGrid_Endpoint',
        'label' => 'Azure Event Grid Endpoint',
        'endpoint' => realUrl,
        'principalType' => 'Anonymous',
        'protocol' => 'NoAuthentication'
    };
    Map<String, Object> body = new Map<String, Object>{ 'Metadata' => metadata };
    String patchBody = JSON.serialize(body);

    // 3. PATCH the NC
    HttpRequest up = new HttpRequest();
    up.setEndpoint(instanceUrl + '/services/data/v59.0/tooling/sobjects/NamedCredential/' + ncId);
    up.setMethod('PATCH');
    up.setHeader('Authorization', 'Bearer ' + UserInfo.getSessionId());
    up.setHeader('Content-Type', 'application/json');
    up.setBody(patchBody);
    try {
        HttpResponse ur = new Http().send(up);
        System.debug(LoggingLevel.INFO, 'PATCH status: ' + ur.getStatusCode() + ' body: ' + ur.getBody());
    } catch (Exception e) {
        System.debug(LoggingLevel.ERROR, 'PATCH failed: ' + e.getMessage());
    }

    // 4. Verify by re-querying
    HttpRequest vq = new HttpRequest();
    vq.setEndpoint(instanceUrl + '/services/data/v59.0/tooling/query/?q='
      + EncodingUtil.urlEncode('SELECT Id, Endpoint FROM NamedCredential WHERE DeveloperName=\'Azure_EventGrid_Endpoint\'', 'UTF-8'));
    vq.setMethod('GET');
    vq.setHeader('Authorization', 'Bearer ' + UserInfo.getSessionId());
    vq.setHeader('Content-Type', 'application/json');
    try {
        HttpResponse vr = new Http().send(vq);
        System.debug(LoggingLevel.INFO, 'VERIFY status: ' + vr.getStatusCode() + ' body: ' + vr.getBody());
    } catch (Exception e) {
        System.debug(LoggingLevel.ERROR, 'VERIFY failed: ' + e.getMessage());
    }
}

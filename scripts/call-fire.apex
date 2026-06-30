// Call the deployed FireTriggerE2E.fire() method.
// This runs as anonymous Apex but only calls the method - the actual
// Account insert happens inside the compiled class, where UEN__c is visible.
FireTriggerE2E.fire();
System.debug(LoggingLevel.INFO, 'CALLED_FIRE_OK');

/*
 * Idempotent Salesforce seed for the SF->Dataverse Loom demo.
 *
 * Reads the vendor list from test/seed-data/vendors.seed.json by running the
 * Node companion (seed-salesforce-export.apex) — but this file is also safe to
 * run standalone against any org that has the UEN__c field deployed: it embeds
 * the same 22 vendors so `sf apex run -f seed-salesforce.apex` works without a
 * pre-export step.
 *
 * Behaviour:
 *   - Queries existing Accounts by UEN__c (idempotent: skip-or-update).
 *   - Database.insert(accList, false) so partial failures don't roll back the
 *     whole batch.
 *   - Prints a System.debug summary of inserted IDs and any SaveResult errors.
 *   - Does NOT clobber the existing e2e test vendor (UEN APEXLIVE001).
 *
 * Run:
 *   sf apex run -f test/seed-data/seed-salesforce.apex
 *
 * The target-org must be set (sf config set target-org <alias>) and the UEN__c
 * field must be deployed (sf project deploy start --target-org <alias>).
 */

List<Account> toInsert = new List<Account>();
Set<String> uensPresent = new Set<String>();

// Pre-fetch existing vendors by UEN so we can skip-or-update idempotently.
for (Account existing : [
    SELECT Id, Name, UEN__c, CurrencyIsoCode
    FROM Account
    WHERE UEN__c IN (
        '201923451K','202014567B','201845678A','202156789C','199834521D',
        '202234512F','201967890G','201712345H','202078901J','201945612K',
        '202189023L','201678904M','202056718N','202145629P','201989032Q',
        '202012345R','201956748T','202178909U','201834561V','202245672W',
        '201967813X','202023454Z'
    )
    WITH USER_MODE
]) {
    uensPresent.add(existing.UEN__c);
}

System.debug(LoggingLevel.INFO, 'Seed: ' + uensPresent.size() + ' vendors already present by UEN; will skip-or-update.');

// Helper to build a row. salesforceId is synthetic for the demo only — the
// Azure Function reads the real Account.Id from the CDC payload at sync time,
// so these seed UENs are what end up as crfe6_uen in Dataverse.
List<List<Object>> seedRows = new List<List<Object>>{
    new List<Object>{ 'Changi Airfreight Services Pte Ltd', '201923451K', 'SGD' },
    new List<Object>{ 'Sentosa Fresh Catering Pte Ltd', '202014567B', 'INR' },
    new List<Object>{ 'Jurong Logistics Group Pte Ltd', '201845678A', 'SGD' },
    new List<Object>{ 'Marina Bay Freight Forwarders Pte Ltd', '202156789C', 'SGD' },
    new List<Object>{ 'Lion City Construction Pte Ltd', '199834521D', 'SGD' },
    new List<Object>{ 'Pulau Merino Catering Singapore Pte Ltd', '202234512F', 'SGD' },
    new List<Object>{ 'Tampines IT Solutions Pte Ltd', '201967890G', 'USD' },
    new List<Object>{ 'Orchard Managed Services Asia Pacific Pte Ltd', '201712345H', 'SGD' },
    new List<Object>{ 'Bukit Timah Facilities Maintenance Pte Ltd', '202078901J', 'SGD' },
    new List<Object>{ 'Kallang Packaging Industries Pte Ltd', '201945612K', 'SGD' },
    new List<Object>{ 'Geylang Transport & Haulage Pte Ltd', '202189023L', 'MYR' },
    new List<Object>{ 'Serangoon Security Services Pte Ltd', '201678904M', 'SGD' },
    new List<Object>{ 'Bedok Printing House Pte Ltd', '202056718N', 'SGD' },
    new List<Object>{ 'Hougang Uniforms & PPE Pte Ltd', '202145629P', 'SGD' },
    new List<Object>{ 'Woodlands Waste Management Pte Ltd', '201989032Q', 'SGD' },
    new List<Object>{ 'Clementi Professional Services Pte Ltd', '202012345R', 'EUR' },
    new List<Object>{ 'Ang Mo Kio Catering Pte Ltd', '201956748T', 'SGD' },
    new List<Object>{ 'Queenstown Industrial Supplies Pte Ltd', '202178909U', 'SGD' },
    new List<Object>{ 'Newton Freight & Warehousing Pte Ltd', '201834561V', 'SGD' },
    new List<Object>{ 'Bishan Technical Services Singapore Pte Ltd', '202245672W', 'SGD' },
    new List<Object>{ 'East Coast Marine Supplies Pte Ltd', '201967813X', 'USD' },
    new List<Object>{ 'Tuas Industrial Catering Asia Pacific Pte Ltd', '202023454Z', 'SGD' }
};

for (List<Object> row : seedRows) {
    String name = (String) row[0];
    String uen = (String) row[1];
    // row[2] (currency code) is intentionally unused — see note below.
    if (uensPresent.contains(uen)) {
        System.debug(LoggingLevel.INFO, 'Seed: skipping ' + uen + ' (' + name + ') — already present.');
        continue;
    }
    Account acc = new Account(
        Name = name,
        UEN__c = uen
    );
    // CurrencyIsoCode is intentionally NOT set: Multi-Currency is not enabled on
    // this scratch org (the feature is requested in project-scratch-def.json but
    // the corporate currency isn't SGD, so setting it to any of the seed values
    // is rejected by the restricted picklist). Currency is cosmetic for the demo
    // anyway — the Azure Function logs "Skipping currency bind" on unknown codes.
    toInsert.add(acc);
}

if (toInsert.isEmpty()) {
    System.debug(LoggingLevel.INFO, 'Seed: nothing to insert — all ' + seedRows.size() + ' vendors already present.');
} else {
    Database.SaveResult[] results = Database.insert(toInsert, false);
    Integer ok = 0;
    Integer fail = 0;
    for (Database.SaveResult sr : results) {
        if (sr.isSuccess()) {
            ok++;
            System.debug(LoggingLevel.INFO, 'Seed: INSERTED Id=' + sr.getId());
        } else {
            fail++;
            Database.Error firstErr = sr.getErrors()[0];
            System.debug(LoggingLevel.ERROR, 'Seed: FAILED statusCode=' + firstErr.getStatusCode() + ' message=' + firstErr.getMessage());
        }
    }
    System.debug(LoggingLevel.INFO, 'Seed: done. inserted=' + ok + ' failed=' + fail + ' skipped=' + (seedRows.size() - toInsert.size()));
}

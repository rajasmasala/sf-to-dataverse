/**
 * Dataverse sync logic extracted from SalesforceCDCWebhook for unit testability.
 *
 * Pure module — does NOT depend on @azure/functions. Takes an axios-compatible
 * HTTP client and a credential factory so tests can inject mocks.
 */

const axios = require('axios');
const { tracer, SpanStatusCode } = require('../telemetry');

const HTTP_TIMEOUT_MS = 30000;

// crfe6_syncstatus option-set values are resolved from the TARGET ORG's metadata
// by label at runtime (and cached at module scope), because the option-value prefix
// differs between environments — e.g. "Synced" is 100000001 in the repo solution but
// 705570001 in the deployed org. Resolving by label keeps the bridge correct against
// any org without hardcoding environment-specific magic numbers (which previously
// caused HTTP 400 "value … is outside the valid range").
let _statusMapCache = null;

function _resetStatusMapForTests() {
    _statusMapCache = null;
}

async function getSyncStatusMap({ httpClient, dataverseUrl, authHeaders }) {
    if (_statusMapCache) {
        return _statusMapCache;
    }
    const resp = await httpClient.get(
        `${dataverseUrl}/api/data/v9.2/EntityDefinitions(LogicalName='account')` +
            `/Attributes(LogicalName='crfe6_syncstatus')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata` +
            `?$select=LogicalName&$expand=OptionSet($select=Options)`,
        { headers: authHeaders, timeout: HTTP_TIMEOUT_MS }
    );
    const options = resp.data?.OptionSet?.Options || [];
    const map = {};
    for (const opt of options) {
        const label = opt.Label?.UserLocalizedLabel?.Label;
        if (label) {
            map[label] = opt.Value;
        }
    }
    _statusMapCache = map;
    return map;
}

/**
 * Best-effort stamp of crfe6_syncstatus = Error after a failed sync.
 *
 * Uses `If-Match: *` so the PATCH is update-only — if the row does not exist yet it
 * returns 404 and we swallow it rather than creating a bare error row. Any failure
 * here is logged and ignored: the caller always rethrows the *original* error so
 * Event Grid still retries / dead-letters. A later successful sync flips it back.
 */
async function stampSyncError({ httpClient, requestUrl, authHeaders, context, encodedSfId, errorValue }) {
    if (errorValue === undefined) {
        context.log("crfe6_syncstatus option 'Error' not found in org metadata; skipping best-effort error stamp.");
        return;
    }
    try {
        await httpClient.patch(
            requestUrl,
            { crfe6_syncstatus: errorValue },
            {
                headers: { ...authHeaders, 'If-Match': '*' },
                timeout: HTTP_TIMEOUT_MS
            }
        );
        context.log(`Stamped crfe6_syncstatus=Error for salesforceId ${encodedSfId}.`);
    } catch (stampErr) {
        const s = stampErr.response ? stampErr.response.status : 'n/a';
        // Redacted: never log the Dataverse body (potential PII), only the status.
        context.log(
            `Best-effort error stamp did not persist (status ${s}); original failure is authoritative.`
        );
    }
}

/**
 * Synchronise a single Salesforce CDC event into Dataverse.
 *
 * @param {object} opts
 * @param {object} opts.event          - Event Grid event with .data being the CDC payload
 * @param {object} opts.context        - Logger with .log() and .error() methods
 * @param {object} opts.credential     - Object exposing getToken(resource) -> { token }
 * @param {string} opts.dataverseUrl   - Base Dataverse URL, no trailing slash
 * @param {object} [opts.httpClient]   - Axios-compatible HTTP client (defaults to global axios)
 * @returns {Promise<{status: number, skipped: boolean}>} - Sync outcome
 */
async function syncVendorToDataverse({ event, context, credential, dataverseUrl, httpClient = axios }) {
    context.log(`Processing Event Grid event ID: ${event.id}`);

    if (!event.data || !event.data.Id) {
        // Throw so Event Grid dead-letters malformed poison events rather than dropping silently.
        throw new Error('Invalid payload structural state: Missing Salesforce ID.');
    }

    const salesforceId = event.data.Id;
    const vendorName = event.data.Name;
    const uen = event.data.UEN__c;
    const currencyCode = event.data.CurrencyIsoCode;

    // Skip DELETE change events — they have no body fields and would PATCH nulls.
    const changeType = event.data.ChangeEventHeader?.changeType;
    if (changeType === 'DELETE') {
        context.log(`Skipping DELETE event for salesforceId ${salesforceId}.`);
        return { status: 204, skipped: true };
    }

    const tokenResponse = await credential.getToken(`${dataverseUrl}/.default`);
    const accessToken = tokenResponse.token;
    const authHeaders = {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0'
    };

    // Resolve this org's crfe6_syncstatus option values by label (cached across invocations).
    const statusMap = await getSyncStatusMap({ httpClient, dataverseUrl, authHeaders });
    const syncedValue = statusMap.Synced;
    const errorValue = statusMap.Error;

    // Upsert via Alternate Key. Encode salesforceId to prevent OData injection.
    const encodedSfId = encodeURIComponent(salesforceId).replace(/'/g, '%27');
    const requestUrl = `${dataverseUrl}/api/data/v9.2/accounts(crfe6_salesforceid='${encodedSfId}')`;

    try {
        // Resolve transactioncurrencyid by ISO code via $filter (no alternate key on this table).
        let currencyBind = null;
        if (currencyCode) {
            const curResp = await httpClient.get(
                `${dataverseUrl}/api/data/v9.2/transactioncurrencies`,
                {
                    headers: authHeaders,
                    timeout: HTTP_TIMEOUT_MS,
                    params: {
                        '$filter': `isocurrencycode eq '${currencyCode}'`,
                        '$select': 'transactioncurrencyid',
                        '$top': 1
                    }
                }
            );
            const curId = curResp.data?.value?.[0]?.transactioncurrencyid;
            if (curId) {
                currencyBind = `/transactioncurrencies(${curId})`;
            } else {
                context.log(`No Dataverse currency row found for ISO code '${currencyCode}'. Skipping currency bind.`);
            }
        }

        // Map external Salesforce schema into designated Dataverse attributes.
        // NOTE: crfe6_lastmodifiedbyintegration_at / crfe6_sync_notes are intentionally NOT
        // written — those columns are not deployed on the Account table in this org, and
        // including them makes Dataverse reject the whole PATCH (HTTP 400 "invalid property").
        // The read side falls back to createdon. Re-add them only once deployed to the org.
        const dataversePayload = {
            name: vendorName,
            crfe6_uen: uen
        };
        // Stamp the org's "Synced" option value (resolved by label above). On failure the
        // catch below stamps "Error" instead, so the read side can distinguish Synced from Error.
        if (syncedValue !== undefined) {
            dataversePayload.crfe6_syncstatus = syncedValue;
        } else {
            context.log("crfe6_syncstatus option 'Synced' not found in org metadata; skipping status stamp.");
        }
        if (currencyBind) {
            dataversePayload['transactioncurrencyid@odata.bind'] = currencyBind;
        }

        context.log(`Executing idempotent patch for salesforceId ${encodedSfId}`);

        // Child span — OTel context propagation makes this a child of the surrounding
        // salesforce.cdc.ingest span. Only the non-PII Salesforce ID and HTTP status recorded.
        const span = tracer.startSpan('dataverse.upsert');
        span.setAttribute('account.salesforce_id', encodedSfId);
        try {
            const response = await httpClient.patch(requestUrl, dataversePayload, {
                headers: { ...authHeaders, Prefer: 'return=representation' },
                timeout: HTTP_TIMEOUT_MS
            });
            span.setAttribute('http.status_code', response.status);
            context.log(`Dataverse synchronization successful. Status Code: ${response.status}`);
            return { status: response.status, skipped: false };
        } catch (err) {
            const respStatus = err.response?.status;
            if (respStatus !== undefined) {
                span.setAttribute('http.status_code', respStatus);
            }
            span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
            throw err;
        } finally {
            span.end();
        }
    } catch (err) {
        // Any failure (currency lookup or the upsert itself) flips the row to Error so the
        // read side reflects the real failure. Best-effort and update-only — see stampSyncError.
        await stampSyncError({ httpClient, requestUrl, authHeaders, context, encodedSfId, errorValue });
        throw err;
    }
}

module.exports = { syncVendorToDataverse, getSyncStatusMap, _resetStatusMapForTests, HTTP_TIMEOUT_MS };

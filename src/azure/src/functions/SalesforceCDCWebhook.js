const { app } = require('@azure/functions');
const { ClientSecretCredential } = require('@azure/identity');
const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const { syncVendorToDataverse } = require('../sync/dataverseSync');
// Require telemetry at cold start so the SDK is initialised before any trigger
// handler runs. The module is a no-op when OTEL_EXPORTER_OTLP_ENDPOINT is unset.
const { tracer, SpanStatusCode } = require('../telemetry');

function buildCredentialConfig(env = process.env) {
    const tenantId = env.DATAVERSE_TENANT_ID;
    // Accept DATAVERSE_APP_ID as an alias for DATAVERSE_CLIENT_ID: the GitHub Actions
    // secret / .env convention (and the README secrets table) name it DATAVERSE_APP_ID,
    // while the SDK and this module historically read DATAVERSE_CLIENT_ID. Honour both
    // so a deployment configured by either name works (the seed script does the same).
    const clientId = env.DATAVERSE_CLIENT_ID || env.DATAVERSE_APP_ID;
    const clientSecret = env.DATAVERSE_CLIENT_SECRET;
    const dataverseUrl = (env.DATAVERSE_ENV_URL || '').replace(/\/+$/, '');

    const missing = [
        ['DATAVERSE_TENANT_ID', tenantId],
        ['DATAVERSE_CLIENT_ID', clientId],
        ['DATAVERSE_CLIENT_SECRET', clientSecret],
        ['DATAVERSE_ENV_URL', env.DATAVERSE_ENV_URL]
    ].filter(([, v]) => !v).map(([k]) => k);

    if (missing.length) {
        throw new Error(
            `Configuration missing: required environment variable(s) not defined: ${missing.join(', ')}`
        );
    }

    return { tenantId, clientId, clientSecret, dataverseUrl };
}

// Module-scope credential keeps the SDK's in-memory token cache across invocations.
let _cached = null;
function getCredential() {
    if (!_cached) {
        const { tenantId, clientId, clientSecret, dataverseUrl } = buildCredentialConfig();
        _cached = {
            credential: new ClientSecretCredential(tenantId, clientId, clientSecret),
            dataverseUrl
        };
    }
    return _cached;
}

// Exposed for tests to reset the module-scope cache when env vars change between cases.
function _resetCredentialCacheForTests() {
    _cached = null;
}

// PATCH is treated as idempotent because we upsert by deterministic alternate key
// (crfe6_salesforceid) — replaying produces the same Dataverse state.
axiosRetry(axios, {
    retries: 3,
    retryDelay: (attempt) => axiosRetry.exponentialDelay(attempt),
    shouldResetTimeout: true,
    retryCondition: (error) => {
        if (!error.response) return true;
        const status = error.response.status;
        return status === 429 || status === 408 || (status >= 500 && status <= 599);
    },
    onRetry: (retryCount, error, requestConfig) => {
        const status = error.response ? error.response.status : 'no-response';
        console.warn(
            `[axios-retry] attempt ${retryCount} after status=${status} ` +
            `for ${requestConfig.method?.toUpperCase()} ${requestConfig.url}`
        );
    }
});

async function runHandler(event, context) {
    let credential, dataverseUrl;
    try {
        ({ credential, dataverseUrl } = getCredential());
    } catch (cfgError) {
        context.error(`Configuration error: ${cfgError.message}`);
        throw cfgError;
    }

    try {
        await syncVendorToDataverse({ event, context, credential, dataverseUrl });
    } catch (error) {
        const status = error.response ? error.response.status : 'n/a';
        context.error(
            `Critical transport or execution failure: ${error.message} (Dataverse status: ${status})`
        );
        throw error;
    }
}

app.eventGrid('SalesforceCDCWebhook', {
    handler: async (event, context) => {
        // Only the non-PII Salesforce system ID is captured as a span attribute.
        // Account name, UEN, and any other business identifiers stay out of
        // telemetry — see the observability section in the README.
        const span = tracer.startSpan('salesforce.cdc.ingest');
        span.setAttributes({
            'event.id': event.id || '',
            'event.type': event.eventType || '',
            'event.subject': event.subject || ''
        });
        try {
            return await runHandler(event, context);
        } catch (err) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
            throw err;
        } finally {
            span.end();
        }
    }
});

module.exports = {
    buildCredentialConfig,
    _resetCredentialCacheForTests,
    runHandler
};

/**
 * Standalone smoke generator for the OTel instrumentation in src/telemetry.js.
 *
 * Produces a real Jaeger trace that mirrors the span tree the
 * SalesforceCDCWebhook function would emit in production, without requiring
 * the Azure Functions runtime, Azurite, or live Dataverse credentials.
 *
 * Usage:
 *   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces \
 *   OTEL_SERVICE_ENV=local-smoke \
 *   node src/azure/scripts/smoke-trace.js
 *
 * After running, open http://localhost:16686 and select service
 * "sf-to-dataverse-salesforce-cdc" to see the trace.
 */

const { tracer, SpanStatusCode } = require('../src/telemetry');
const context = require('@opentelemetry/api').context;
const traceApi = require('@opentelemetry/api').trace;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function emitHappyPath() {
    // Root span mirrors the one in SalesforceCDCWebhook.js.
    const root = tracer.startSpan('salesforce.cdc.ingest', {
        attributes: {
            'event.id': 'smoke-' + Date.now(),
            'event.type': 'Salesforce.Vendor.Updated',
            'event.subject': 'VendorOnboarding/001D000000I8aUm'
        }
    });

    // Use context.active to establish parent-child linkage — passing `parent`
    // directly to startSpan has historically been flaky across OTel versions
    // because it expects a SpanContext rather than a Span.
    await context.with(traceApi.setSpan(context.active(), root), async () => {
        // Child span 1: token acquisition. Real Dataverse calls go through
        // @azure/identity ClientSecretCredential; we simulate the span only.
        const tokenSpan = tracer.startSpan('dataverse.gettoken');
        await sleep(40);
        tokenSpan.setAttributes({
            'dataverse.tenant': 'smoke-tenant',
            'dataverse.client_id': 'smoke-client'
        });
        tokenSpan.end();

        // Child span 2: the actual PATCH to Dataverse's alternate-key endpoint.
        // HttpInstrumentation would normally create this automatically; we add it
        // here explicitly so the smoke trace shows the full call hierarchy even
        // when no real HTTP traffic is generated.
        const patchSpan = tracer.startSpan('dataverse.patch.account');
        await sleep(120);
        patchSpan.setAttributes({
            'http.method': 'PATCH',
            'http.url': 'https://smoke.crm.dynamics.com/api/data/v9.2/accounts(crfe6_salesforceid=001D000000I8aUm)',
            'http.status_code': 204
        });
        patchSpan.end();
    });

    root.end();
}

async function emitErrorPath() {
    const root = tracer.startSpan('salesforce.cdc.ingest', {
        attributes: {
            'event.id': 'smoke-err-' + Date.now(),
            'event.type': 'Salesforce.Vendor.Updated',
            'event.subject': 'VendorOnboarding/001D000000I8aUn'
        }
    });

    await context.with(traceApi.setSpan(context.active(), root), async () => {
        const patchSpan = tracer.startSpan('dataverse.patch.account');
        await sleep(80);
        patchSpan.setAttributes({
            'http.method': 'PATCH',
            'http.url': 'https://smoke.crm.dynamics.com/api/data/v9.2/accounts(crfe6_salesforceid=001D000000I8aUn)',
            'http.status_code': 401
        });
        patchSpan.recordException(new Error('Unauthorized: client secret expired'));
        patchSpan.setStatus({ code: SpanStatusCode.ERROR, message: '401 Unauthorized' });
        patchSpan.end();
    });

    root.setStatus({ code: SpanStatusCode.ERROR, message: 'Dataverse sync failed' });
    root.end();
}

(async () => {
    if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
        process.stderr.write(
            '[smoke] OTEL_EXPORTER_OTLP_ENDPOINT is not set. No trace will be exported.\n'
        );
        process.exit(1);
    }

    process.stderr.write('[smoke] emitting happy-path trace...\n');
    await emitHappyPath();

    process.stderr.write('[smoke] emitting error-path trace...\n');
    await emitErrorPath();

    // SimpleSpanProcessor exports synchronously on span.end(), but give the
    // HTTP exporter a moment to drain its keep-alive socket before exit.
    await sleep(500);
    process.stderr.write('[smoke] done. Open http://localhost:16686\n');
})();

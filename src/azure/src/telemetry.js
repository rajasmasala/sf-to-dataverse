/**
 * OpenTelemetry bootstrap for the Azure Function worker.
 *
 * Design goals specific to serverless:
 *   - Graceful degradation: if OTEL_EXPORTER_OTLP_ENDPOINT is unset the module
 *     becomes a no-op (returns the global noop tracer, never starts the SDK).
 *     Tests and local dev workflows that do not have a collector running must
 *     not crash or block on network IO.
 *   - SimpleSpanProcessor (not BatchSpanProcessor): each span is exported
 *     synchronously on span.end(). On Azure Functions the worker can be
 *     frozen between invocations and shut down at any time, so batching is
 *     unsafe — a batched exporter frequently loses the last few spans of an
 *     invocation. SimpleSpanProcessor trades a small per-span HTTP cost for
 *     reliability, which is the correct trade-off for low-traffic serverless.
 *   - http instrumentation covers axios automatically (axios is built on top
 *     of Node's http/https modules), so no separate axios instrumentation is
 *     needed.
 *
 * Initialize at module load (cold start) by requiring this file from the
 * function module so that instrumentation is in place before the trigger
 * handler runs.
 */

const { trace, SpanStatusCode } = require('@opentelemetry/api');

const NOOP_TRACER = trace.getTracer('noop');

function buildResource() {
    // Lazy-require so that requiring telemetry.js without an exporter never
    // pulls in the SDK (keeps the no-op path zero-dependency).
    //
    // @opentelemetry/resources@2.x removed the `Resource` class constructor
    // (it's now an internal detail). The public, supported API is the
    // resourceFromAttributes() factory. Resolved defensively so that if a
    // future major re-introduces the constructor we still work.
    const resources = require('@opentelemetry/resources');
    const semantic = require('@opentelemetry/semantic-conventions');

    // semantic-conventions exports named string constants for each attribute.
    // Resolve them defensively because the exact export name has shifted
    // between OTel versions (ATTR_SERVICE_NAME vs SERVICE_NAME).
    const serviceNameKey =
        semantic.ATTR_SERVICE_NAME || semantic.SemanticResourceAttributes.SERVICE_NAME;
    const serviceVersionKey =
        semantic.ATTR_SERVICE_VERSION || semantic.SemanticResourceAttributes.SERVICE_VERSION;
    const deploymentEnvKey =
        semantic.ATTR_DEPLOYMENT_ENVIRONMENT ||
        semantic.SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT;

    const attributes = {
        [serviceNameKey]: 'sf-to-dataverse-salesforce-cdc',
        [serviceVersionKey]: '1.0.0',
        [deploymentEnvKey]: process.env.OTEL_SERVICE_ENV || 'local'
    };

    if (typeof resources.resourceFromAttributes === 'function') {
        return resources.resourceFromAttributes(attributes);
    }
    // Legacy fallback for OTel 1.x — `Resource` was a public constructor.
    return new resources.Resource(attributes);
}

function startSdk() {
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
    const { SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');
    const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');

    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces';

    const exporter = new OTLPTraceExporter({ url: endpoint });
    const spanProcessor = new SimpleSpanProcessor(exporter);

    const sdk = new NodeSDK({
        resource: buildResource(),
        traceExporter: exporter,
        spanProcessor,
        instrumentations: [new HttpInstrumentation()]
    });

    sdk.start();

    if (process.env.OTEL_DEBUG === '1') {
        process.stderr.write(
            `[otel] SDK started, exporting to ${endpoint} (${process.env.OTEL_SERVICE_ENV || 'local'})\n`
        );
    }

    return { sdk, tracer: trace.getTracer('sf-to-dataverse-salesforce-cdc') };
}

let _state = null;

/**
 * Returns the active tracer. Idempotent — safe to call from any module.
 * Returns a no-op tracer when no OTLP endpoint is configured.
 */
function getTracer() {
    if (_state) return _state.tracer;
    if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
        return NOOP_TRACER;
    }
    _state = startSdk();
    return _state.tracer;
}

/**
 * Test-only: force a fresh SDK start (or stop) between test cases.
 * Resets internal state so the next getTracer() call re-evaluates env vars.
 */
function _resetForTests() {
    if (_state && _state.sdk && typeof _state.sdk.shutdown === 'function') {
        try {
            _state.sdk.shutdown();
        } catch {
            // Best-effort cleanup; tests do not depend on shutdown succeeding.
        }
    }
    _state = null;
}

module.exports = {
    getTracer,
    tracer: getTracer(),
    SpanStatusCode,
    _resetForTests
};

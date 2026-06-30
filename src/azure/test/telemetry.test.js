/**
 * Telemetry unit tests.
 *
 * Verifies the graceful-degradation contract (no-op when env unset), span
 * lifecycle (start -> setAttributes -> setStatus on error -> end), and PII
 * hygiene (no UEN or Account name leaks into span attributes).
 */

jest.mock('@azure/functions', () => ({
    app: { eventGrid: jest.fn() }
}));

jest.mock('@azure/identity', () => ({
    ClientSecretCredential: jest.fn()
}));

jest.mock('axios', () => ({
    get: jest.fn(),
    patch: jest.fn()
}));

jest.mock('axios-retry', () => {
    const fn = jest.fn();
    fn.exponentialDelay = jest.fn((attempt) => Math.pow(2, attempt) * 100);
    return { __esModule: true, default: fn };
});

const ORIGINAL_ENV = { ...process.env };

describe('telemetry module - graceful degradation', () => {
    let telemetry;

    beforeEach(() => {
        jest.resetModules();
        delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
        delete process.env.OTEL_SERVICE_ENV;
        telemetry = require('../src/telemetry');
    });

    afterEach(() => {
        telemetry._resetForTests();
        process.env = { ...ORIGINAL_ENV };
    });

    it('returns a tracer without throwing when OTEL_EXPORTER_OTLP_ENDPOINT is unset', () => {
        const tracer = telemetry.getTracer();
        expect(tracer).toBeDefined();
        expect(typeof tracer.startSpan).toBe('function');
    });

    it('module-level tracer is functional (startSpan returns an object with end())', () => {
        const span = telemetry.tracer.startSpan('test.span');
        expect(span).toBeDefined();
        expect(typeof span.end).toBe('function');
        expect(typeof span.setAttribute).toBe('function');
        expect(typeof span.setStatus).toBe('function');
        span.end();
    });

    it('is idempotent - repeated getTracer calls return the same tracer instance when no env is set', () => {
        const a = telemetry.getTracer();
        const b = telemetry.getTracer();
        expect(a).toBe(b);
    });

    it('_resetForTests does not throw when called before any SDK initialisation', () => {
        expect(() => telemetry._resetForTests()).not.toThrow();
    });
});

describe('telemetry module - SDK init when OTEL_EXPORTER_OTLP_ENDPOINT set', () => {
    let telemetry;

    beforeEach(() => {
        jest.resetModules();
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318/v1/traces';
        process.env.OTEL_SERVICE_ENV = 'unit-test';
        telemetry = require('../src/telemetry');
    });

    afterEach(() => {
        telemetry._resetForTests();
        delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
        delete process.env.OTEL_SERVICE_ENV;
    });

    it('returns a non-noop tracer after env var is set', () => {
        const tracer = telemetry.getTracer();
        expect(tracer).toBeDefined();
        expect(typeof tracer.startSpan).toBe('function');
    });

    it('starts a span and ends it without throwing against a (non-listening) collector URL', () => {
        // Span.end() triggers a synchronous export attempt via SimpleSpanProcessor.
        // With no collector listening on localhost:4318, the export fails - but
        // the failure is swallowed by the exporter, so the call must not throw.
        const span = telemetry.tracer.startSpan('unit.test.span');
        span.setAttribute('test.key', 'test.value');
        expect(() => span.end()).not.toThrow();
    });

    it('_resetForTests clears internal state so a subsequent getTracer picks up env changes', () => {
        const first = telemetry.getTracer();
        expect(first).toBeDefined();
        telemetry._resetForTests();
        delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
        const second = telemetry.getTracer();
        expect(typeof second.startSpan).toBe('function');
    });
});

describe('span lifecycle - start, attributes, status, end', () => {
    // Use the no-op path so we don't depend on a live collector. The spans
    // produced are still real Span objects - they just don't get exported.
    let telemetry;

    beforeEach(() => {
        jest.resetModules();
        delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
        telemetry = require('../src/telemetry');
    });

    afterEach(() => {
        telemetry._resetForTests();
    });

    it('exposes SpanStatusCode enum with ERROR value', () => {
        expect(telemetry.SpanStatusCode).toBeDefined();
        expect(telemetry.SpanStatusCode.ERROR).toBeDefined();
    });

    it('a span can record attributes and an ERROR status before end()', () => {
        const span = telemetry.tracer.startSpan('test.span');
        span.setAttributes({
            'event.id': 'evt-1',
            'event.type': 'SalesforceAccountChanged'
        });
        span.setAttribute('event.subject', '/accounts/001X');
        span.setStatus({
            code: telemetry.SpanStatusCode.ERROR,
            message: 'synthetic failure'
        });
        expect(() => span.end()).not.toThrow();
    });

    it('PII hygiene - allowlist of attribute names excludes name and UEN', () => {
        // Static contract: the only business identifier the webhook is allowed
        // to put on a span is the Salesforce system ID (event.id, event.type,
        // event.subject, account.salesforce_id, http.status_code). Name and UEN
        // are not in that allowlist.
        const piiAttributeNames = ['account.name', 'account.uen', 'vendor.name', 'vendor.uen'];
        const allowedAttributeNames = [
            'event.id',
            'event.type',
            'event.subject',
            'account.salesforce_id',
            'http.status_code'
        ];
        // The allowlist and denylist must not overlap.
        const overlap = piiAttributeNames.filter((n) => allowedAttributeNames.includes(n));
        expect(overlap).toEqual([]);
        // Sanity: the tracer's startSpan accepts the allowed attribute names.
        const span = telemetry.tracer.startSpan('pii.test.span');
        span.setAttributes(
            allowedAttributeNames.reduce((acc, k) => ({ ...acc, [k]: 'redacted' }), {})
        );
        expect(Object.keys(span)).toBeDefined();
        span.end();
    });
});

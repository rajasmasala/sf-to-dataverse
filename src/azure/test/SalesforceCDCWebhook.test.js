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

function loadWebhook() {
    let exports;
    let axiosRetry;
    let axios;
    let app;
    let ClientSecretCredential;
    jest.isolateModules(() => {
        exports = require('../src/functions/SalesforceCDCWebhook');
        axiosRetry = require('axios-retry').default;
        axios = require('axios');
        app = require('@azure/functions').app;
        ClientSecretCredential = require('@azure/identity').ClientSecretCredential;
    });
    return { exports, axiosRetry, axios, app, ClientSecretCredential };
}

function baseEnv() {
    return {
        DATAVERSE_TENANT_ID: 'tenant-abc',
        DATAVERSE_CLIENT_ID: 'client-def',
        DATAVERSE_CLIENT_SECRET: 'secret-ghi',
        DATAVERSE_ENV_URL: 'https://test.crm.dynamics.com/'
    };
}

describe('SalesforceCDCWebhook module', () => {
    it('registers exactly one eventGrid handler named SalesforceCDCWebhook', () => {
        const { app } = loadWebhook();
        expect(app.eventGrid).toHaveBeenCalledTimes(1);
        const [name, options] = app.eventGrid.mock.calls[0];
        expect(name).toBe('SalesforceCDCWebhook');
        expect(typeof options.handler).toBe('function');
    });

    it('configures axios-retry on the shared axios instance with 3 retries & correct conditions', () => {
        const { axiosRetry, axios } = loadWebhook();
        expect(axiosRetry).toHaveBeenCalledTimes(1);
        const [instance, config] = axiosRetry.mock.calls[0];
        expect(instance).toBe(axios);
        expect(config.retries).toBe(3);
        expect(typeof config.retryDelay).toBe('function');
        expect(config.shouldResetTimeout).toBe(true);

        const shouldRetry = config.retryCondition;
        expect(shouldRetry({})).toBe(true);          // no response = network error
        expect(shouldRetry({ response: { status: 400 } })).toBe(false);
        expect(shouldRetry({ response: { status: 404 } })).toBe(false);
        expect(shouldRetry({ response: { status: 408 } })).toBe(true);
        expect(shouldRetry({ response: { status: 429 } })).toBe(true);
        expect(shouldRetry({ response: { status: 500 } })).toBe(true);
        expect(shouldRetry({ response: { status: 503 } })).toBe(true);
        expect(shouldRetry({ response: { status: 599 } })).toBe(true);
        expect(shouldRetry({ response: { status: 600 } })).toBe(false);

        config.retryDelay(2);
        expect(axiosRetry.exponentialDelay).toHaveBeenCalledWith(2);
    });

    it('onRetry logs without leaking the request body', () => {
        const { axiosRetry } = loadWebhook();
        const config = axiosRetry.mock.calls[0][1];
        const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            config.onRetry(1, { message: 'boom' }, { method: 'patch', url: 'https://x/y' });
            const output = consoleWarn.mock.calls[0][0];
            expect(output).toContain('attempt 1');
            expect(output).toContain('status=no-response');
            expect(output).toContain('PATCH https://x/y');
        } finally {
            consoleWarn.mockRestore();
        }
    });
});

describe('buildCredentialConfig', () => {
    let buildCredentialConfig;

    beforeEach(() => {
        ({ buildCredentialConfig } = loadWebhook().exports);
    });

    it('reads tenantId, clientId, clientSecret, env URL and strips trailing slash', () => {
        const cfg = buildCredentialConfig(baseEnv());
        expect(cfg).toEqual({
            tenantId: 'tenant-abc',
            clientId: 'client-def',
            clientSecret: 'secret-ghi',
            dataverseUrl: 'https://test.crm.dynamics.com'
        });
    });

    it('throws listing every missing variable', () => {
        expect(() => buildCredentialConfig({})).toThrow(/DATAVERSE_TENANT_ID/);
        expect(() => buildCredentialConfig({})).toThrow(/DATAVERSE_CLIENT_ID/);
        expect(() => buildCredentialConfig({})).toThrow(/DATAVERSE_CLIENT_SECRET/);
        expect(() => buildCredentialConfig({})).toThrow(/DATAVERSE_ENV_URL/);
    });

    it('lists only the still-missing variables when partially populated', () => {
        expect(() => buildCredentialConfig({ DATAVERSE_TENANT_ID: 'x' })).toThrow(
            /DATAVERSE_CLIENT_ID, DATAVERSE_CLIENT_SECRET, DATAVERSE_ENV_URL/
        );
    });

    it('accepts a URL without trailing slash unchanged', () => {
        const cfg = buildCredentialConfig({ ...baseEnv(), DATAVERSE_ENV_URL: 'https://x.crm.dynamics.com' });
        expect(cfg.dataverseUrl).toBe('https://x.crm.dynamics.com');
    });

    it('accepts DATAVERSE_APP_ID as an alias for DATAVERSE_CLIENT_ID', () => {
        // The GitHub Actions secret / .env convention names this DATAVERSE_APP_ID; the
        // Function must honour it so a deployment configured per the README still works.
        const env = { ...baseEnv() };
        delete env.DATAVERSE_CLIENT_ID;
        env.DATAVERSE_APP_ID = 'app-from-secret';
        expect(buildCredentialConfig(env).clientId).toBe('app-from-secret');
    });

    it('prefers DATAVERSE_CLIENT_ID when both names are present', () => {
        const cfg = buildCredentialConfig({ ...baseEnv(), DATAVERSE_APP_ID: 'app-id-ignored' });
        expect(cfg.clientId).toBe('client-def');
    });
});

describe('registered handler integration', () => {
    let handler;
    let axios;
    let ClientSecretCredential;
    let exports;

    beforeEach(() => {
        const loaded = loadWebhook();
        axios = loaded.axios;
        ClientSecretCredential = loaded.ClientSecretCredential;
        exports = loaded.exports;
        handler = loaded.app.eventGrid.mock.calls[0][1].handler;

        ClientSecretCredential.mockImplementation(() => ({
            getToken: jest.fn().mockResolvedValue({ token: 'fake-token' })
        }));
        axios.patch.mockResolvedValue({ status: 204 });
        axios.get.mockResolvedValue({ status: 200, data: { value: [] } });
        process.env = { ...baseEnv() };
    });

    afterEach(() => {
        delete process.env.DATAVERSE_TENANT_ID;
        delete process.env.DATAVERSE_CLIENT_ID;
        delete process.env.DATAVERSE_CLIENT_SECRET;
        delete process.env.DATAVERSE_ENV_URL;
    });

    it('constructs ClientSecretCredential with tenant/client/secret from env on first call', async () => {
        await handler(
            { id: 'evt-1', data: { Id: '001X', Name: 'Acme' } },
            { log: jest.fn(), error: jest.fn(), warn: jest.fn() }
        );

        expect(ClientSecretCredential).toHaveBeenCalledWith(
            'tenant-abc',
            'client-def',
            'secret-ghi'
        );
        expect(axios.patch).toHaveBeenCalledTimes(1);
        const url = axios.patch.mock.calls[0][0];
        expect(url).toContain('https://test.crm.dynamics.com/api/data/v9.2/');
        expect(url).toContain("crfe6_salesforceid='001X'");
    });

    it('reuses the same credential instance across invocations (token cache)', async () => {
        const ctx = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
        await handler({ id: 'evt-1', data: { Id: '001A', Name: 'A' } }, ctx);
        await handler({ id: 'evt-2', data: { Id: '001B', Name: 'B' } }, ctx);

        expect(ClientSecretCredential).toHaveBeenCalledTimes(1);
        expect(axios.patch).toHaveBeenCalledTimes(2);
    });

    it('throws on missing config so Event Grid surfaces the misconfiguration', async () => {
        process.env = {};
        const ctx = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
        await expect(
            handler({ id: 'evt-1', data: { Id: '001A' } }, ctx)
        ).rejects.toThrow(/Configuration missing/);
        expect(ctx.error).toHaveBeenCalled();
        expect(axios.patch).not.toHaveBeenCalled();
    });

    it('rethrows underlying sync errors after logging', async () => {
        const apiErr = Object.assign(new Error('HTTP 500'), {
            response: { status: 500, data: {} }
        });
        axios.patch.mockRejectedValue(apiErr);

        const ctx = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
        await expect(
            handler({ id: 'evt-1', data: { Id: '001A', Name: 'A' } }, ctx)
        ).rejects.toThrow(/HTTP 500/);
        expect(ctx.error).toHaveBeenCalled();
    });

    it('does not log raw event payload (PII hygiene)', async () => {
        const ctx = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
        await handler(
            { id: 'evt-1', data: { Id: '001A', Name: 'Acme', UEN__c: 'SECRET_UEN' } },
            ctx
        );
        const allLogOutput = ctx.log.mock.calls.map((c) => String(c[0])).join('\n');
        expect(allLogOutput).not.toContain('SECRET_UEN');
    });

    it('refreshes the cached credential when env changes after a cache reset', async () => {
        await handler(
            { id: 'evt-1', data: { Id: '001A', Name: 'A' } },
            { log: jest.fn(), error: jest.fn(), warn: jest.fn() }
        );
        expect(ClientSecretCredential).toHaveBeenCalledTimes(1);

        exports._resetCredentialCacheForTests();

        process.env.DATAVERSE_TENANT_ID = 'tenant-xyz';
        await handler(
            { id: 'evt-2', data: { Id: '001B', Name: 'B' } },
            { log: jest.fn(), error: jest.fn(), warn: jest.fn() }
        );
        expect(ClientSecretCredential).toHaveBeenCalledTimes(2);
        expect(ClientSecretCredential).toHaveBeenLastCalledWith(
            'tenant-xyz',
            'client-def',
            'secret-ghi'
        );
    });
});

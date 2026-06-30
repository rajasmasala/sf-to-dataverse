const axios = require('axios');
const { syncVendorToDataverse, getSyncStatusMap, _resetStatusMapForTests, HTTP_TIMEOUT_MS } = require('../src/sync/dataverseSync');

jest.mock('axios');

function makeContext() {
    return { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
}

const fakeCredential = {
    getToken: jest.fn().mockResolvedValue({ token: 'fake-token', expiresOnTimestamp: Date.now() + 3600000 })
};

// The deployed org's crfe6_syncstatus option set uses the 705570xxx prefix (NOT the
// repo solution's 100000xxx). The bridge resolves the value by label at runtime, so
// these are the values the tests expect to see written.
const ORG_OPTIONS = {
    OptionSet: {
        Options: [
            { Value: 705570000, Label: { UserLocalizedLabel: { Label: 'Pending' } } },
            { Value: 705570001, Label: { UserLocalizedLabel: { Label: 'Synced' } } },
            { Value: 705570002, Label: { UserLocalizedLabel: { Label: 'Error' } } }
        ]
    }
};

// Route axios.get by URL: option-set metadata vs. currency lookup.
function mockDataverseGets({ currency = [], optionSet = ORG_OPTIONS } = {}) {
    axios.get.mockImplementation((url) => {
        if (String(url).includes('PicklistAttributeMetadata')) {
            return Promise.resolve({ status: 200, data: optionSet });
        }
        if (String(url).includes('transactioncurrencies')) {
            return Promise.resolve({ status: 200, data: { value: currency } });
        }
        return Promise.resolve({ status: 200, data: {} });
    });
}

function buildEvent(overrides = {}) {
    return {
        id: 'evt-test',
        data: {
            Id: '001D000000I8aWY',
            Name: 'Acme Pte Ltd',
            UEN__c: '202612345G',
            ChangeEventHeader: { changeType: 'UPDATE' },
            ...overrides
        }
    };
}

describe('syncVendorToDataverse', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        axios.get.mockReset();
        axios.patch.mockReset();
        _resetStatusMapForTests();   // option-set cache is module-scoped; reset per test
        mockDataverseGets();         // metadata available by default, no currency match
    });

    describe('malformed payload', () => {
        it('throws on missing event.data', async () => {
            const ctx = makeContext();
            await expect(
                syncVendorToDataverse({
                    event: { id: 'evt-1' },
                    context: ctx,
                    credential: fakeCredential,
                    dataverseUrl: 'https://test.crm.dynamics.com'
                })
            ).rejects.toThrow(/Missing Salesforce ID/);
            expect(axios.patch).not.toHaveBeenCalled();
            expect(axios.get).not.toHaveBeenCalled();
        });

        it('throws on missing event.data.Id', async () => {
            const ctx = makeContext();
            await expect(
                syncVendorToDataverse({
                    event: { id: 'evt-1', data: { Name: 'No ID' } },
                    context: ctx,
                    credential: fakeCredential,
                    dataverseUrl: 'https://test.crm.dynamics.com'
                })
            ).rejects.toThrow(/Missing Salesforce ID/);
            expect(fakeCredential.getToken).not.toHaveBeenCalled();
        });
    });

    describe('DELETE events', () => {
        it('skips DELETE events and makes no HTTP calls', async () => {
            const ctx = makeContext();
            const result = await syncVendorToDataverse({
                event: buildEvent({ ChangeEventHeader: { changeType: 'DELETE' } }),
                context: ctx,
                credential: fakeCredential,
                dataverseUrl: 'https://test.crm.dynamics.com'
            });
            expect(result).toEqual({ status: 204, skipped: true });
            expect(axios.patch).not.toHaveBeenCalled();
            expect(axios.get).not.toHaveBeenCalled();
        });
    });

    describe('crfe6_syncstatus option-value resolution', () => {
        it('resolves the option value by label from org metadata (705570001 for Synced)', async () => {
            axios.patch.mockResolvedValue({ status: 204 });
            await syncVendorToDataverse({
                event: buildEvent({ CurrencyIsoCode: undefined }),
                context: makeContext(),
                credential: fakeCredential,
                dataverseUrl: 'https://test.crm.dynamics.com'
            });
            // First GET is the picklist metadata lookup.
            const metaCall = axios.get.mock.calls.find((c) => String(c[0]).includes('PicklistAttributeMetadata'));
            expect(metaCall).toBeDefined();
            const [, patchBody] = axios.patch.mock.calls[0];
            expect(patchBody.crfe6_syncstatus).toBe(705570001); // resolved, not hardcoded 100000001
        });

        it('caches the option-set map (only one metadata lookup across replays)', async () => {
            axios.patch.mockResolvedValue({ status: 204 });
            const base = { context: makeContext(), credential: fakeCredential, dataverseUrl: 'https://test.crm.dynamics.com' };
            await syncVendorToDataverse({ event: buildEvent(), ...base });
            await syncVendorToDataverse({ event: buildEvent(), ...base });
            const metaCalls = axios.get.mock.calls.filter((c) => String(c[0]).includes('PicklistAttributeMetadata'));
            expect(metaCalls.length).toBe(1);
        });

        it('omits crfe6_syncstatus when the Synced label is absent (still upserts name/uen)', async () => {
            mockDataverseGets({ optionSet: { OptionSet: { Options: [] } } });
            axios.patch.mockResolvedValue({ status: 204 });
            await syncVendorToDataverse({
                event: buildEvent({ CurrencyIsoCode: undefined }),
                context: makeContext(),
                credential: fakeCredential,
                dataverseUrl: 'https://test.crm.dynamics.com'
            });
            const [, patchBody] = axios.patch.mock.calls[0];
            expect(patchBody).toEqual({ name: 'Acme Pte Ltd', crfe6_uen: '202612345G' });
            expect(patchBody.crfe6_syncstatus).toBeUndefined();
        });

        it('getSyncStatusMap returns a label->value map', async () => {
            const map = await getSyncStatusMap({
                httpClient: axios,
                dataverseUrl: 'https://test.crm.dynamics.com',
                authHeaders: {}
            });
            expect(map).toEqual({ Pending: 705570000, Synced: 705570001, Error: 705570002 });
        });
    });

    describe('happy path — upsert', () => {
        it('PATCHes Dataverse with correct URL, headers, body (no currency)', async () => {
            const ctx = makeContext();
            axios.patch.mockResolvedValue({ status: 204 });

            const result = await syncVendorToDataverse({
                event: buildEvent({ CurrencyIsoCode: undefined }),
                context: ctx,
                credential: fakeCredential,
                dataverseUrl: 'https://test.crm.dynamics.com'
            });

            expect(result).toEqual({ status: 204, skipped: false });
            expect(fakeCredential.getToken).toHaveBeenCalledWith('https://test.crm.dynamics.com/.default');

            expect(axios.patch).toHaveBeenCalledTimes(1);
            const [url, body, config] = axios.patch.mock.calls[0];
            expect(url).toBe(
                "https://test.crm.dynamics.com/api/data/v9.2/accounts(crfe6_salesforceid='001D000000I8aWY')"
            );
            // No crfe6_lastmodifiedbyintegration_at (column not deployed) — see dataverseSync.js note.
            expect(body).toEqual({
                name: 'Acme Pte Ltd',
                crfe6_uen: '202612345G',
                crfe6_syncstatus: 705570001
            });
            expect(body['transactioncurrencyid@odata.bind']).toBeUndefined();
            expect(config.timeout).toBe(HTTP_TIMEOUT_MS);
            expect(config.headers.Authorization).toBe('Bearer fake-token');
            expect(config.headers.Prefer).toBe('return=representation');
            expect(config.headers['OData-MaxVersion']).toBe('4.0');
        });

        it('resolves currency bind via $filter when ISO code is provided', async () => {
            const ctx = makeContext();
            mockDataverseGets({ currency: [{ transactioncurrencyid: 'cur-123' }] });
            axios.patch.mockResolvedValue({ status: 204 });

            await syncVendorToDataverse({
                event: buildEvent({ CurrencyIsoCode: 'SGD' }),
                context: ctx,
                credential: fakeCredential,
                dataverseUrl: 'https://test.crm.dynamics.com'
            });

            const curCall = axios.get.mock.calls.find((c) => String(c[0]).includes('transactioncurrencies'));
            expect(curCall).toBeDefined();
            const [getUrl, getConfig] = curCall;
            expect(getUrl).toBe('https://test.crm.dynamics.com/api/data/v9.2/transactioncurrencies');
            expect(getConfig.params.$filter).toBe("isocurrencycode eq 'SGD'");
            expect(getConfig.params.$select).toBe('transactioncurrencyid');
            expect(getConfig.params.$top).toBe(1);

            const [, patchBody] = axios.patch.mock.calls[0];
            expect(patchBody['transactioncurrencyid@odata.bind']).toBe('/transactioncurrencies(cur-123)');
        });

        it('continues without currency bind when ISO code has no match', async () => {
            const ctx = makeContext();
            mockDataverseGets({ currency: [] });
            axios.patch.mockResolvedValue({ status: 204 });

            await syncVendorToDataverse({
                event: buildEvent({ CurrencyIsoCode: 'XYZ' }),
                context: ctx,
                credential: fakeCredential,
                dataverseUrl: 'https://test.crm.dynamics.com'
            });

            const [, patchBody] = axios.patch.mock.calls[0];
            expect(patchBody['transactioncurrencyid@odata.bind']).toBeUndefined();
        });
    });

    describe('crfe6_syncstatus stamping', () => {
        it('stamps the resolved Synced value on every successful PATCH', async () => {
            axios.patch.mockResolvedValue({ status: 204 });
            await syncVendorToDataverse({
                event: buildEvent(),
                context: makeContext(),
                credential: fakeCredential,
                dataverseUrl: 'https://test.crm.dynamics.com'
            });
            const [, patchBody] = axios.patch.mock.calls[0];
            expect(patchBody.crfe6_syncstatus).toBe(705570001);
        });

        it('stamps the resolved Error value (best-effort, update-only) when the upsert throws', async () => {
            const serverErr = Object.assign(new Error('boom'), {
                response: { status: 500, data: {} },
                isAxiosError: true
            });
            axios.patch.mockRejectedValue(serverErr);

            await expect(
                syncVendorToDataverse({
                    event: buildEvent(),
                    context: makeContext(),
                    credential: fakeCredential,
                    dataverseUrl: 'https://test.crm.dynamics.com'
                })
            ).rejects.toThrow(/boom/);

            // Two PATCHes: the failed upsert, then the best-effort Error stamp.
            expect(axios.patch).toHaveBeenCalledTimes(2);
            const [stampUrl, stampBody, stampConfig] = axios.patch.mock.calls[1];
            expect(stampUrl).toBe(axios.patch.mock.calls[0][0]); // same alternate-key URL
            expect(stampBody).toEqual({ crfe6_syncstatus: 705570002 }); // resolved Error value
            expect(stampConfig.headers['If-Match']).toBe('*');         // update-only
        });
    });

    describe('idempotency', () => {
        it('uses deterministic alternate-key URL and identical bodies on replay', async () => {
            axios.patch.mockResolvedValue({ status: 204 });
            const event = buildEvent();
            const base = {
                context: makeContext(),
                credential: fakeCredential,
                dataverseUrl: 'https://test.crm.dynamics.com'
            };

            await syncVendorToDataverse({ event, ...base });
            await syncVendorToDataverse({ event, ...base });

            expect(axios.patch).toHaveBeenCalledTimes(2);
            expect(axios.patch.mock.calls[0][0]).toBe(axios.patch.mock.calls[1][0]);
            // No per-write timestamp anymore — replays produce a byte-identical body.
            expect(axios.patch.mock.calls[0][1]).toEqual(axios.patch.mock.calls[1][1]);
        });

        it('URL-encodes salesforceId to prevent OData injection', async () => {
            axios.patch.mockResolvedValue({ status: 204 });

            const malicious = "O'BRIEN')/evil('payload";
            await syncVendorToDataverse({
                event: buildEvent({ Id: malicious }),
                context: makeContext(),
                credential: fakeCredential,
                dataverseUrl: 'https://test.crm.dynamics.com'
            });

            const url = axios.patch.mock.calls[0][0];
            expect(url).toContain('accounts(crfe6_salesforceid=');
            const keyValue = url.match(/crfe6_salesforceid='(.*)'\)$/)[1];
            expect(keyValue).not.toContain("'");
            expect(keyValue).toContain('%27');
            expect(decodeURIComponent(keyValue)).toBe(malicious);
        });
    });

    describe('error propagation', () => {
        it('propagates 5xx so Event Grid dead-letters', async () => {
            const ctx = makeContext();
            const serverErr = Object.assign(new Error('Dataverse is down'), {
                response: { status: 500, data: { error: { message: 'boom' } } },
                isAxiosError: true
            });
            axios.patch.mockRejectedValue(serverErr);

            await expect(
                syncVendorToDataverse({
                    event: buildEvent(),
                    context: ctx,
                    credential: fakeCredential,
                    dataverseUrl: 'https://test.crm.dynamics.com'
                })
            ).rejects.toThrow(/Dataverse is down/);
        });

        it('propagates network errors with no response', async () => {
            axios.patch.mockRejectedValue(new Error('connect ECONNREFUSED'));

            await expect(
                syncVendorToDataverse({
                    event: buildEvent(),
                    context: makeContext(),
                    credential: fakeCredential,
                    dataverseUrl: 'https://test.crm.dynamics.com'
                })
            ).rejects.toThrow(/ECONNREFUSED/);
        });
    });
});

import { createElement } from 'lwc';
import { registerApexTestWireAdapter } from '@salesforce/wire-service-jest-util';

import VendorSyncDashboard from 'c/vendorSyncDashboard';
import getRecentSyncedVendors from '@salesforce/apex/VendorSyncStatusController.getRecentSyncedVendors';
import getFailedSyncs from '@salesforce/apex/VendorSyncStatusController.getFailedSyncs';

// registerApexTestWireAdapter is marked deprecated in wire-service-jest-util 3.x
// but remains the documented pattern in current @salesforce/sfdx-lwc-jest recipes.
const recentAdapter = registerApexTestWireAdapter(getRecentSyncedVendors);
const failedAdapter = registerApexTestWireAdapter(getFailedSyncs);

// refreshApex lives in the @salesforce/apex LWC module; stub it so the test does
// not pull in LDS internals. The virtual flag lets jest create the module when
// no real source is bundled by sfdx-lwc-jest's transform pipeline.
jest.mock('@salesforce/apex', () => ({
    refreshApex: jest.fn().mockResolvedValue(undefined)
}), { virtual: true });

const RECENT_FIXTURE = [
    {
        accountId: '001000000000001AAA',
        name: 'Acme Synced',
        uen: '202611111A',
        currencyIsoCode: 'SGD',
        syncStatus: 'Synced',
        lastModified: '2026-06-22T00:00:00.000Z'
    },
    {
        accountId: '001000000000002AAA',
        name: 'Globex Pending',
        uen: '202622222B',
        currencyIsoCode: 'SGD',
        syncStatus: 'Pending',
        lastModified: '2026-06-22T00:00:01.000Z'
    },
    {
        accountId: '001000000000003AAA',
        name: 'Initech Error',
        uen: '202633333C',
        currencyIsoCode: 'USD',
        syncStatus: 'Error',
        lastModified: '2026-06-22T00:00:02.000Z'
    }
];

const FAILED_FIXTURE = [
    {
        accountId: '001000000000003AAA',
        name: 'Initech Error',
        uen: '202633333C',
        currencyIsoCode: 'USD',
        syncStatus: 'Error',
        lastModified: '2026-06-22T00:00:02.000Z'
    }
];

function createComponent() {
    const element = createElement('c-vendor-sync-dashboard', {
        is: VendorSyncDashboard
    });
    document.body.appendChild(element);
    return element;
}

function flushPromises() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('c/vendor-sync-dashboard', () => {
    let element;

    beforeEach(() => {
        element = createComponent();
    });

    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.restoreAllMocks();
    });

    it('renders rows for each recently synced vendor after data loads', async () => {
        recentAdapter.emit(RECENT_FIXTURE);
        failedAdapter.emit([]);
        await flushPromises();

        const table = element.shadowRoot.querySelector('lightning-datatable');
        expect(table).not.toBeNull();
        expect(table.data).toHaveLength(3);
        expect(table.data[0]).toMatchObject({ name: 'Acme Synced', uen: '202611111A' });
        // statusCellClass enrichment drives future cell coloring.
        expect(table.data[0].statusCellClass).toBe('slds-theme--success');
        expect(table.data[1].statusCellClass).toBe('slds-theme--info');
        expect(table.data[2].statusCellClass).toBe('slds-theme--error');
    });

    it('shows the empty-state copy when no vendors are returned', async () => {
        recentAdapter.emit([]);
        failedAdapter.emit([]);
        await flushPromises();

        const empties = element.shadowRoot.querySelectorAll('.slds-text-color_weak');
        expect(Array.from(empties).some((p) => p.textContent.includes('No vendors synced yet'))).toBe(true);
    });

    it('renders the failed-sync tile with one entry when an error record is present', async () => {
        recentAdapter.emit(RECENT_FIXTURE);
        failedAdapter.emit(FAILED_FIXTURE);
        await flushPromises();

        // lightning-layout-item is a real LWC, but our <ul> sits in its slot, so it
        // appears in our component's shadowRoot directly.
        const failedItems = element.shadowRoot.querySelectorAll('ul.slds-list_dotted li.slds-item');
        expect(failedItems).toHaveLength(1);
        expect(failedItems[0].textContent).toContain('Initech Error');
        expect(failedItems[0].textContent).toContain('202633333C');

        // The failed-tile heading lives in the second lightning-card (the nested one).
        const nestedCards = element.shadowRoot.querySelectorAll('lightning-card');
        expect(nestedCards.length).toBeGreaterThanOrEqual(2);
        const failedHeading = nestedCards[nestedCards.length - 1].querySelector('h2.slds-text-heading_small');
        expect(failedHeading.textContent).toContain('1 failed sync');
    });

    it('pluralises the failed count when more than one failed sync', async () => {
        recentAdapter.emit([]);
        failedAdapter.emit([
            FAILED_FIXTURE[0],
            { ...FAILED_FIXTURE[0], accountId: '001000000000004AAA', name: 'Other Failure' }
        ]);
        await flushPromises();

        const nestedCards = element.shadowRoot.querySelectorAll('lightning-card');
        const failedHeading = nestedCards[nestedCards.length - 1].querySelector('h2.slds-text-heading_small');
        expect(failedHeading.textContent).toContain('2 failed syncs');
    });

    it('shows the empty copy in the failed tile when no errors', async () => {
        recentAdapter.emit(RECENT_FIXTURE);
        failedAdapter.emit([]);
        await flushPromises();

        const emptyTexts = Array.from(element.shadowRoot.querySelectorAll('.slds-text-color_weak'))
            .map((p) => p.textContent);
        expect(emptyTexts.some((t) => t.includes('No failed syncs'))).toBe(true);
    });

    it('calls refreshApex and fires a success toast when Refresh button is clicked', async () => {
        const { refreshApex } = require('@salesforce/apex');
        refreshApex.mockClear();

        // Spy on the host element's dispatchEvent so we can intercept ShowToastEvent.
        // LWC routes component-dispatched events through the host's dispatchEvent,
        // which is what the ShowToastEvent uses to reach the lightning environment.
        const dispatchSpy = jest.spyOn(element, 'dispatchEvent');

        recentAdapter.emit(RECENT_FIXTURE);
        failedAdapter.emit(FAILED_FIXTURE);
        await flushPromises();

        const button = element.shadowRoot.querySelector('lightning-button');
        button.click();
        await flushPromises();

        expect(refreshApex).toHaveBeenCalledTimes(2);

        // ShowToastEvent is dispatched with type 'lightning__showtoast'. The toast
        // payload (title, message, variant) is exposed both directly on the event
        // and on event.detail, depending on the LWC engine version; we read both.
        const dispatchedToasts = dispatchSpy.mock.calls
            .map((call) => call[0])
            .filter((event) => event && event.type === 'lightning__showtoast');
        expect(dispatchedToasts.length).toBeGreaterThan(0);
        const last = dispatchedToasts[dispatchedToasts.length - 1];
        const variant = last.variant || (last.detail && last.detail.variant);
        expect(variant).toBe('success');
    });

    it('shows an error message when the recent wire returns an error', async () => {
        recentAdapter.error({ body: { message: 'Apex blew up' } });
        failedAdapter.emit([]);
        await flushPromises();

        const errorDiv = element.shadowRoot.querySelector('div[role="alert"].slds-has-error');
        expect(errorDiv).not.toBeNull();
        expect(errorDiv.textContent).toContain('Apex blew up');
    });

    it('does not double-fire refresh while one is already in-flight', async () => {
        const { refreshApex } = require('@salesforce/apex');
        refreshApex.mockClear();

        recentAdapter.emit(RECENT_FIXTURE);
        failedAdapter.emit([]);
        await flushPromises();

        const button = element.shadowRoot.querySelector('lightning-button');
        button.click();
        button.click();
        button.click();
        await flushPromises();

        // Two refreshApex calls per click (recent + failed); only the first click counts.
        expect(refreshApex).toHaveBeenCalledTimes(2);
    });
});

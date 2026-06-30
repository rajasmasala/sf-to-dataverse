import { LightningElement, wire, track, api } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getRecentSyncedVendors from '@salesforce/apex/VendorSyncStatusController.getRecentSyncedVendors';
import getFailedSyncs from '@salesforce/apex/VendorSyncStatusController.getFailedSyncs';

const COLUMNS = [
    { label: 'Vendor Name', fieldName: 'name', type: 'text', wrapText: true },
    { label: 'UEN', fieldName: 'uen', type: 'text' },
    { label: 'Currency', fieldName: 'currencyIsoCode', type: 'text' },
    {
        label: 'Sync Status',
        fieldName: 'syncStatus',
        type: 'text',
        cellAttributes: { class: { fieldName: 'statusCellClass' } }
    },
    {
        label: 'Last Modified',
        fieldName: 'lastModified',
        type: 'date',
        typeAttributes: {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }
    }
];

export default class VendorSyncDashboard extends LightningElement {
    columns = COLUMNS;

    // LWC design properties declared in vendorSyncDashboard.js-meta.xml
    // (targetConfig <property> elements) must be exposed as @api on the
    // component class, otherwise the deploy fails with
    // "The '<name>' property doesn't exist on the component". The @api
    // decorator also makes these reactive, so @wire can bind to them.
    @api recentLimit = 50;
    @api failedLimit = 50;

    // Track the wire result objects so refreshApex can re-provision them after
    // an imperative refresh. `@track` on the DTOs themselves isn't needed because
    // we reassign the array references.
    wiredRecentResult;
    wiredFailedResult;

    @track recentVendors = [];
    @track failedVendors = [];
    @track recentError;
    @track failedError;
    isRefreshing = false;

    @wire(getRecentSyncedVendors, { limitSize: '$recentLimit' })
    wiredRecent(result) {
        this.wiredRecentResult = result;
        if (result.data) {
            this.recentVendors = this.withStatusClass(result.data);
            this.recentError = undefined;
        } else if (result.error) {
            this.recentVendors = [];
            this.recentError = result.error;
        }
    }

    @wire(getFailedSyncs, { limitSize: '$failedLimit' })
    wiredFailed(result) {
        this.wiredFailedResult = result;
        if (result.data) {
            this.failedVendors = this.withStatusClass(result.data);
            this.failedError = undefined;
        } else if (result.error) {
            this.failedVendors = [];
            this.failedError = result.error;
        }
    }

    get hasRecentVendors() {
        return this.recentVendors.length > 0;
    }

    get hasFailedVendors() {
        return this.failedVendors.length > 0;
    }

    get showRecentError() {
        return this.recentError !== undefined;
    }

    get showFailedError() {
        return this.failedError !== undefined;
    }

    get recentErrorMessage() {
        return this.reduceError(this.recentError);
    }

    get failedErrorMessage() {
        return this.reduceError(this.failedError);
    }

    get failedCountLabel() {
        const count = this.failedVendors.length;
        return `${count} failed ${count === 1 ? 'sync' : 'syncs'}`;
    }

    // Imperative refresh — forces both wire adapters to re-provision.
    // Wired data is cacheable, so without this the table only updates on
    // record navigation or manual LDS invalidation.
    async handleRefresh() {
        if (this.isRefreshing) {
            return;
        }
        this.isRefreshing = true;
        try {
            const refreshes = [];
            if (this.wiredRecentResult) {
                refreshes.push(refreshApex(this.wiredRecentResult));
            }
            if (this.wiredFailedResult) {
                refreshes.push(refreshApex(this.wiredFailedResult));
            }
            await Promise.all(refreshes);
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Refreshed',
                    message: 'Vendor sync status reloaded.',
                    variant: 'success'
                })
            );
        } catch (error) {
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Refresh failed',
                    message: this.reduceError(error),
                    variant: 'error'
                })
            );
        } finally {
            this.isRefreshing = false;
        }
    }

    // Attach a CSS-friendly status token so lightning-datatable can color the cell.
    // lightning-datatable only applies classes declared in a cellAttributes.class
    // field, and the value must be a class name present in a <template>
    // stylesheet (we keep the mapping minimal — no custom CSS in this PoC, but
    // the field is correct for future styling).
    withStatusClass(rows) {
        return rows.map((row) => ({
            ...row,
            statusCellClass: `slds-theme--${this.statusTone(row.syncStatus)}`
        }));
    }

    statusTone(status) {
        switch (status) {
            case 'Synced':
                return 'success';
            case 'Error':
                return 'error';
            case 'Pending':
            default:
                return 'info';
        }
    }

    reduceError(error) {
        if (!error) {
            return 'Unknown error';
        }
        if (Array.isArray(error.body)) {
            return error.body.map((e) => e.message).join(', ');
        }
        if (error.body && typeof error.body.message === 'string') {
            return error.body.message;
        }
        if (typeof error.message === 'string') {
            return error.message;
        }
        return JSON.stringify(error);
    }
}

#!/usr/bin/env node
/**
 * Dataverse seed for the SF->Dataverse Loom demo.
 *
 * Two-phase seeding against the Account table by alternate key
 * crfe6_salesforceid:
 *
 *   Phase 1 — UPSERT all 22 vendors from vendors.seed.json as Synced
 *             (crfe6_syncstatus = 100000001), with a spread of
 *             crfe6_lastmodifiedbyintegration_at timestamps across the last
 *             ~14 days. This is the "baseline happy path" state.
 *
 *   Phase 2 — INJECT STATUS VARIETY (the demo-critical step). PATCH ~7 of the
 *             rows to vary status for the Loom narrative:
 *               3 -> Pending (100000000): "sync in flight"
 *               4 -> Error   (100000002): specific crfe6_sync_notes strings
 *
 *             The Azure Function stamps Synced on every successful sync, so a
 *             pure end-to-end run would produce ALL Synced rows — not good demo
 *             variety. Phase 2 is the post-hoc fix.
 *
 * Auth: reuses the SAME env-var pattern and ClientSecretCredential shape as
 * src/azure/src/functions/SalesforceCDCWebhook.js — no new credential handling.
 * Reads from .env at the repo root (or the process environment). Does NOT
 * import the Azure Function package itself (keeps this script standalone and
 * free of @azure/functions plumbing); it only mirrors the auth + PATCH shape.
 *
 * Run (from repo root):
 *   node test/seed-data/seed-dataverse.js
 *
 * Env vars required (same names the Azure Function uses):
 *   DATAVERSE_ENV_URL       e.g. https://orgXXXX.crm5.dynamics.com
 *   DATAVERSE_TENANT_ID
 *   DATAVERSE_APP_ID        (the Function calls this DATAVERSE_CLIENT_ID)
 *   DATAVERSE_CLIENT_SECRET
 *
 * Linkage (B1):
 *   By default this script resolves the REAL Salesforce Account.Id for each
 *   vendor by shelling out to `sf data query` (SOQL re-query by UEN) and uses
 *   that real Id as the alt-key value. This makes Dataverse's
 *   crfe6_salesforceid hold the actual Salesforce Id — so a side-by-side Loom
 *   shot of the SF Account list and the Dataverse gallery lines up.
 *
 *   The synthetic salesforceId values in vendors.seed.json (001SEED01…) are
 *   now FALLBACKS, used only when:
 *     - --use-synthetic-ids is passed (dry-runs without SF auth), OR
 *     - the SF resolver finds no row for a given UEN (insert failed / wrong
 *       target-org) — in which case a loud warning is printed.
 *
 * Flags:
 *   --phase=1              only upsert the Synced baseline
 *   --phase=2              only inject status variety
 *   --dry-run              print the PATCHes that WOULD run, execute nothing
 *   --use-synthetic-ids    skip SF resolution; use JSON's salesforceId values
 *   --sf-target-org=<alias>  pass through to `sf data query --target-org`
 *   (default:              run both phases, resolve real SF Ids)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Mirror the Azure Function's auth stack exactly. These are devDependencies of
// the Azure package; we require them here so this script is self-contained and
// doesn't need the Azure package's telemetry initialisation.
const { ClientSecretCredential } = require('@azure/identity');
const axios = require('axios');

const HTTP_TIMEOUT_MS = 30000;

// OptionSet values from src/powerplatform/sf-to-dataverse/Entities/account/Entity.xml
// (default). The live Dataverse env may have a different option prefix (e.g.
// 705570000 vs 100000000), so discoverSyncStatus() overrides these from the
// live metadata before any PATCH runs.
const SYNC_STATUS = {
    PENDING: 100000000,
    SYNCED: 100000001,
    ERROR: 100000002
};

// Discover the actual option-set values for crfe6_syncstatus in the live env.
// Returns an object {PENDING, SYNCED, ERROR} with the discovered integer values,
// matched by label (case-insensitive).
async function discoverSyncStatus(httpClient, authHeaders, dataverseUrl) {
    // OptionSetMetadata is the global option set; query it by name.
    // crfe6_syncstatus option set is usually named 'crfe6_syncstatus' too.
    const r = await httpClient.get(
        `${dataverseUrl}/api/data/v9.2/EntityDefinitions(LogicalName='account')/Attributes(LogicalName='crfe6_syncstatus')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet($select=Options),GlobalOptionSet($select=Options)`,
        { headers: authHeaders }
    );
    const opts = r.data.OptionSet?.Options || r.data.GlobalOptionSet?.Options || [];
    const byLabel = {};
    for (const o of opts) {
        if (o.Label?.UserLocalizedLabel?.Label) {
            byLabel[o.Label.UserLocalizedLabel.Label.toLowerCase()] = o.Value;
        }
    }
    return {
        PENDING: byLabel['pending'] ?? SYNC_STATUS.PENDING,
        SYNCED: byLabel['synced'] ?? SYNC_STATUS.SYNCED,
        ERROR: byLabel['error'] ?? SYNC_STATUS.ERROR
    };
}

// ---------------------------------------------------------------------------
// .env loader (minimal — avoids a dotenv dependency just for one file).
// ---------------------------------------------------------------------------
function loadDotenv() {
    const envPath = path.join(__dirname, '..', '..', '.env');
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        // Strip surrounding single or double quotes if present.
        if ((val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) {
            process.env[key] = val;
        }
    }
}

// The Azure Function calls this DATAVERSE_CLIENT_ID; .env ships DATAVERSE_APP_ID.
// Accept either so this script runs against the same .env without edits.
function resolveConfig() {
    const tenantId = process.env.DATAVERSE_TENANT_ID;
    const clientId = process.env.DATAVERSE_CLIENT_ID || process.env.DATAVERSE_APP_ID;
    const clientSecret = process.env.DATAVERSE_CLIENT_SECRET;
    const dataverseUrl = (process.env.DATAVERSE_ENV_URL || '').replace(/\/+$/, '');

    const missing = [
        ['DATAVERSE_TENANT_ID', tenantId],
        ['DATAVERSE_CLIENT_ID or DATAVERSE_APP_ID', clientId],
        ['DATAVERSE_CLIENT_SECRET', clientSecret],
        ['DATAVERSE_ENV_URL', process.env.DATAVERSE_ENV_URL]
    ].filter(([, v]) => !v).map(([k]) => k);

    if (missing.length) {
        throw new Error(
            'Configuration missing: required environment variable(s) not defined: ' +
            missing.join(', ') +
            '. Set them in .env at the repo root (or in the process environment).'
        );
    }
    return { tenantId, clientId, clientSecret, dataverseUrl };
}

// ---------------------------------------------------------------------------
// HTTP helpers — mirror dataverseSync.js auth header construction.
// ---------------------------------------------------------------------------
async function buildAuthHeaders(credential, dataverseUrl) {
    const tokenResponse = await credential.getToken(`${dataverseUrl}/.default`);
    return {
        'Authorization': `Bearer ${tokenResponse.token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0'
    };
}

function accountUrlByAltKey(dataverseUrl, salesforceId) {
    // Mirrors dataverseSync.js: encode to prevent OData injection.
    const encoded = encodeURIComponent(salesforceId).replace(/'/g, '%27');
    return `${dataverseUrl}/api/data/v9.2/accounts(crfe6_salesforceid='${encoded}')`;
}

async function patchAccount({ httpClient, authHeaders, dataverseUrl, salesforceId, payload, dryRun, label }) {
    const url = accountUrlByAltKey(dataverseUrl, salesforceId);
    if (dryRun) {
        console.log(`[dry-run] PATCH ${url}`);
        console.log(`[dry-run]   ${JSON.stringify(payload)}`);
        return { status: 0, skipped: true, label };
    }
    const response = await httpClient.patch(url, payload, {
        headers: { ...authHeaders, Prefer: 'return=representation' },
        timeout: HTTP_TIMEOUT_MS
    });
    console.log(`[${label}] PATCH salesforceId=${salesforceId} -> HTTP ${response.status}`);
    return { status: response.status, skipped: false, label };
}

async function queryAll({ httpClient, authHeaders, dataverseUrl }) {
    // Used for the post-seed verification report.
    const url = `${dataverseUrl}/api/data/v9.2/accounts?$filter=crfe6_salesforceid ne null&$select=name,crfe6_salesforceid,crfe6_uen,crfe6_syncstatus,crfe6_sync_notes,crfe6_lastmodifiedbyintegration_at&$top=500`;
    const response = await httpClient.get(url, { headers: authHeaders, timeout: HTTP_TIMEOUT_MS });
    return response.data.value || [];
}

// ---------------------------------------------------------------------------
// Seed logic
// ---------------------------------------------------------------------------

// B1: resolve the real Salesforce Account.Id for each vendor by SOQL re-query
// on UEN. UEN is the stable business key present in both systems (SF assigns
// its own Id on insert; the JSON's salesforceId is a synthetic fallback).
// Returns a new array of vendors with `effectiveSalesforceId` set.
function resolveSalesforceIds(vendors, sfTargetOrg) {
    const uens = vendors.map(v => `'${String(v.uen).replace(/'/g, "\\'")}'`).join(',');
    const soql = `SELECT Id, UEN__c FROM Account WHERE UEN__c IN (${uens})`;
    const sfArgs = ['data', 'query', '-q', soql, '--json'];
    if (sfTargetOrg) sfArgs.push('--target-org', sfTargetOrg);

    let raw;
    try {
        if (process.platform === 'win32') {
            // Two Windows quirks stack here:
            //   1. execFileSync on a .cmd wrapper throws EINVAL on Node 24+.
            //   2. shell:true passes args unescaped to cmd.exe, so a SOQL with
            //      spaces (e.g. "SELECT Id, UEN__c FROM Account...") gets tokenized
            //      and sf sees "Id," "UEN__c" "FROM" as separate unexpected args.
            // Workaround: write the SOQL to a temp file and pass it via sf's
            // stdin support? No — sf doesn't read stdin. Instead, write a tiny
            // .bat wrapper that calls sf with the SOQL properly quoted, and
            // execFileSync the wrapper. Simpler: build a single cmd line with
            // double-quoted SOQL and run it via cmd /c (shell:true).
            const quoted = sfArgs.map(a => `"${String(a).replace(/"/g, '""')}"`).join(' ');
            raw = execFileSync(`sf ${quoted}`, [], {
                encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, shell: 'cmd.exe',
            });
        } else {
            raw = execFileSync('sf', sfArgs, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
        }
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.error(
                'FATAL: `sf` CLI not found on PATH. Either install it and auth a target-org,\n' +
                'or re-run with --use-synthetic-ids to skip Salesforce Id resolution.'
            );
        } else {
            console.error('FATAL: `sf data query` failed.');
            if (err.stderr) console.error(String(err.stderr).trim());
            console.error('Re-run with --use-synthetic-ids to skip Salesforce Id resolution.');
        }
        process.exit(1);
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        console.error('FATAL: could not parse `sf data query --json` output as JSON.');
        console.error(raw.slice(0, 500));
        process.exit(1);
    }

    const records = (parsed.result && parsed.result.records) || [];
    if (!records.length) {
        console.warn(
            'WARN: `sf data query` returned 0 Accounts for the seed UENs.\n' +
            '  This usually means the Salesforce seed (seed-salesforce.apex) has not been\n' +
            '  run yet against this target-org, or the wrong target-org is selected.\n' +
            '  Falling back to synthetic IDs for all vendors.'
        );
    }
    const uenToId = new Map(records.map(r => [r.UEN__c, r.Id]));

    let resolved = 0, fallback = 0;
    const out = vendors.map(vendor => {
        const realId = uenToId.get(vendor.uen);
        if (realId) {
            resolved++;
            return { ...vendor, effectiveSalesforceId: realId };
        }
        fallback++;
        console.warn(
            `WARN: no SF Account found for UEN ${vendor.uen} (${vendor.name}). ` +
            `Falling back to synthetic ID ${vendor.salesforceId}.`
        );
        return { ...vendor, effectiveSalesforceId: vendor.salesforceId };
    });
    console.log(`SF Id resolution: ${resolved} resolved, ${fallback} synthetic fallback.`);
    return out;
}

function buildBaselinePayload(vendor, now, existingFields, syncStatus) {
    // Phase 1: every row seeded as Synced with a spread of timestamps.
    const lastModified = new Date(now.getTime() - vendor.lastModifiedHoursAgo * 3600 * 1000);
    const payload = {
        name: vendor.name,
        crfe6_uen: vendor.uen,
        crfe6_syncstatus: syncStatus.SYNCED,
        crfe6_lastmodifiedbyintegration_at: lastModified.toISOString()
    };
    // Tolerate missing fields (env may not have every crfe6_* field deployed).
    // This lets the demo seed proceed without a full solution redeploy.
    for (const k of Object.keys(payload)) {
        if (k !== 'name' && !existingFields.has(k)) delete payload[k];
    }
    return payload;
}

function buildVarietyPayload(vendor, now, existingFields, syncStatus) {
    // Phase 2: vary status for the demo narrative.
    const lastModified = new Date(now.getTime() - vendor.lastModifiedHoursAgo * 3600 * 1000);
    const payload = {
        crfe6_syncstatus: vendor.targetStatus === 'Pending'
            ? syncStatus.PENDING
            : vendor.targetStatus === 'Error'
                ? syncStatus.ERROR
                : syncStatus.SYNCED,
        crfe6_lastmodifiedbyintegration_at: lastModified.toISOString()
    };
    if (vendor.syncNotes && existingFields.has('crfe6_sync_notes')) {
        payload.crfe6_sync_notes = vendor.syncNotes;
    }
    // Clear stale notes when moving away from Error so we don't leave an
    // Error note dangling on a Synced/Pending row from a prior run.
    if (vendor.targetStatus !== 'Error' && existingFields.has('crfe6_sync_notes')) {
        payload.crfe6_sync_notes = null;
    }
    for (const k of Object.keys(payload)) {
        if (k.startsWith('crfe6_') && !existingFields.has(k)) delete payload[k];
    }
    return payload;
}

// Discover which crfe6_* fields actually exist on Account in the target env.
// Used to filter PATCH payloads so the seed tolerates field-deploy drift.
async function discoverExistingFields(httpClient, authHeaders, dataverseUrl) {
    const r = await httpClient.get(
        `${dataverseUrl}/api/data/v9.2/EntityDefinitions(LogicalName='account')/Attributes?$select=LogicalName`,
        { headers: authHeaders }
    );
    return new Set(
        r.data.value
            .map(a => a.LogicalName)
            .filter(n => n && n.startsWith('crfe6'))
    );
}

async function phase1UpsertBaseline({ httpClient, authHeaders, dataverseUrl, vendors, now, dryRun, existingFields, syncStatus }) {
    console.log(`\n=== Phase 1: upsert ${vendors.length} vendors as Synced ===`);
    let ok = 0, fail = 0;
    for (const vendor of vendors) {
        try {
            await patchAccount({
                httpClient, authHeaders, dataverseUrl,
                salesforceId: vendor.effectiveSalesforceId,
                payload: buildBaselinePayload(vendor, now, existingFields, syncStatus),
                dryRun,
                label: 'phase1'
            });
            ok++;
        } catch (err) {
            fail++;
            const status = err.response?.status ?? 'n/a';
            console.error(`[phase1] FAILED salesforceId=${vendor.effectiveSalesforceId} (${vendor.name}): ${err.message} (HTTP ${status})`);
            if (err.response?.data) console.error(`  body: ${JSON.stringify(err.response.data).slice(0, 500)}`);
        }
    }
    console.log(`Phase 1 done: ok=${ok} fail=${fail}`);
    return { ok, fail };
}

async function phase2InjectVariety({ httpClient, authHeaders, dataverseUrl, vendors, now, dryRun, existingFields, syncStatus }) {
    const toVary = vendors.filter(v => v.targetStatus === 'Pending' || v.targetStatus === 'Error');
    console.log(`\n=== Phase 2: inject status variety into ${toVary.length} vendors ===`);
    let ok = 0, fail = 0;
    for (const vendor of toVary) {
        try {
            await patchAccount({
                httpClient, authHeaders, dataverseUrl,
                salesforceId: vendor.effectiveSalesforceId,
                payload: buildVarietyPayload(vendor, now, existingFields, syncStatus),
                dryRun,
                label: `phase2:${vendor.targetStatus}`
            });
            ok++;
        } catch (err) {
            fail++;
            const status = err.response?.status ?? 'n/a';
            console.error(`[phase2] FAILED salesforceId=${vendor.effectiveSalesforceId} (${vendor.name}): ${err.message} (HTTP ${status})`);
        }
    }
    console.log(`Phase 2 done: ok=${ok} fail=${fail}`);
    return { ok, fail };
}

async function verifyStatusDistribution({ httpClient, authHeaders, dataverseUrl, dryRun, expectedVendors }) {
    if (dryRun) {
        console.log('\n[dry-run] skipping verification query (no writes performed).');
        return;
    }
    console.log('\n=== Verifying status distribution ===');
    let rows;
    try {
        rows = await queryAll({ httpClient, authHeaders, dataverseUrl });
    } catch (err) {
        const status = err.response?.status ?? 'n/a';
        console.error(`Verification query failed: ${err.message} (HTTP ${status})`);
        return;
    }
    // Count by status across ALL synced-from-Salesforce rows (not just our seed
    // set — the existing e2e vendor '001apexlive' counts too).
    const counts = { Pending: 0, Synced: 0, Error: 0, Unknown: 0 };
    for (const row of rows) {
        const s = row.crfe6_syncstatus;
        if (s === SYNC_STATUS.PENDING) counts.Pending++;
        else if (s === SYNC_STATUS.SYNCED) counts.Synced++;
        else if (s === SYNC_STATUS.ERROR) counts.Error++;
        else counts.Unknown++;
    }
    console.log(`Dataverse Account rows with crfe6_salesforceid != null: ${rows.length}`);
    console.log(`  Pending: ${counts.Pending}`);
    console.log(`  Synced:  ${counts.Synced}`);
    console.log(`  Error:   ${counts.Error}`);
    if (counts.Unknown) console.log(`  Unknown: ${counts.Unknown}`);

    // Confirm every seed vendor is present. Uses effectiveSalesforceId so the
    // check matches what was actually PATCHed (real SF Id under default mode,
    // synthetic under --use-synthetic-ids).
    const presentIds = new Set(rows.map(r => r.crfe6_salesforceid));
    const missing = expectedVendors.filter(v => !presentIds.has(v.effectiveSalesforceId));
    if (missing.length) {
        console.warn(`WARN: ${missing.length} seed vendor(s) not found by crfe6_salesforceid:`);
        for (const v of missing) console.warn(`  - ${v.effectiveSalesforceId} (${v.name})`);
    } else {
        console.log(`All ${expectedVendors.length} seed vendors present by crfe6_salesforceid.`);
    }
}

function parseArgs(argv) {
    const out = { phase: null, dryRun: false, useSyntheticIds: false, sfTargetOrg: null };
    for (const arg of argv.slice(2)) {
        if (arg === '--dry-run') out.dryRun = true;
        else if (arg === '--use-synthetic-ids') out.useSyntheticIds = true;
        else if (arg.startsWith('--phase=')) out.phase = parseInt(arg.slice('--phase='.length), 10);
        else if (arg.startsWith('--sf-target-org=')) out.sfTargetOrg = arg.slice('--sf-target-org='.length);
        else {
            console.error(`Unknown argument: ${arg}`);
            process.exit(2);
        }
    }
    return out;
}

async function main() {
    const args = parseArgs(process.argv);
    loadDotenv();

    const { tenantId, clientId, clientSecret, dataverseUrl } = resolveConfig();
    const seedPath = path.join(__dirname, 'vendors.seed.json');
    const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    const vendors = seed.vendors;
    const now = new Date();

    console.log(`Dataverse seed -> ${dataverseUrl}`);
    console.log(`Loaded ${vendors.length} vendors from ${path.relative(process.cwd(), seedPath)}`);
    console.log(`Target distribution: ${vendors.filter(v => v.targetStatus === 'Synced').length} Synced, ` +
        `${vendors.filter(v => v.targetStatus === 'Pending').length} Pending, ` +
        `${vendors.filter(v => v.targetStatus === 'Error').length} Error`);
    if (args.dryRun) console.log('** DRY RUN — no PATCHes will execute **');

    // B1: resolve real Salesforce Account.Ids by UEN before PATCHing Dataverse,
    // unless --use-synthetic-ids was passed (escape hatch for dry-runs without
    // SF auth). The resolver mutates vendors to carry effectiveSalesforceId.
    let resolvedVendors;
    if (args.useSyntheticIds) {
        console.log('Using synthetic salesforceId values (--use-synthetic-ids).');
        resolvedVendors = vendors.map(v => ({ ...v, effectiveSalesforceId: v.salesforceId }));
    } else {
        console.log(`Resolving real SF Account.Ids via \`sf data query\`${args.sfTargetOrg ? ` (target-org: ${args.sfTargetOrg})` : ''}...`);
        resolvedVendors = resolveSalesforceIds(vendors, args.sfTargetOrg);
    }

    const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
    const authHeaders = await buildAuthHeaders(credential, dataverseUrl);
    const httpClient = axios;

    // Discover which crfe6_* fields actually exist on Account, so we can
    // tolerate missing fields without a full solution redeploy. Prints the
    // discovered set so any drift is visible in the demo log.
    let existingFields;
    try {
        existingFields = await discoverExistingFields(httpClient, authHeaders, dataverseUrl);
        console.log(`Discovered crfe6_* fields on Account: ${[...existingFields].sort().join(', ')}`);
    } catch (err) {
        console.error('FATAL: could not query Account field metadata.');
        throw err;
    }

    // Discover the actual option-set integer values for crfe6_syncstatus in
    // this env. Different envs use different option prefixes (e.g. 100000000
    // in source, 705570000 in this Vikram-Dev env), so we must read the live
    // metadata to map Pending/Synced/Error to the right integers.
    let syncStatus = SYNC_STATUS;
    try {
        syncStatus = await discoverSyncStatus(httpClient, authHeaders, dataverseUrl);
        console.log(`Discovered crfe6_syncstatus values: Pending=${syncStatus.PENDING} Synced=${syncStatus.SYNCED} Error=${syncStatus.ERROR}`);
    } catch (err) {
        console.warn(`WARN: could not discover crfe6_syncstatus options; falling back to source defaults ${JSON.stringify(SYNC_STATUS)}. Error: ${err.message}`);
    }

    if (!args.phase || args.phase === 1) {
        await phase1UpsertBaseline({ httpClient, authHeaders, dataverseUrl, vendors: resolvedVendors, now, dryRun: args.dryRun, existingFields, syncStatus });
    }
    if (!args.phase || args.phase === 2) {
        await phase2InjectVariety({ httpClient, authHeaders, dataverseUrl, vendors: resolvedVendors, now, dryRun: args.dryRun, existingFields, syncStatus });
    }

    await verifyStatusDistribution({ httpClient, authHeaders, dataverseUrl, dryRun: args.dryRun, expectedVendors: resolvedVendors });

    console.log('\nSeed complete.');
}

main().catch(err => {
    console.error(`FATAL: ${err.message}`);
    if (err.response?.data) {
        console.error('Response body:', JSON.stringify(err.response.data, null, 2));
    }
    process.exit(1);
});

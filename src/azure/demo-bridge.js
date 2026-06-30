#!/usr/bin/env node
/**
 * Live demo of the Salesforce -> Dataverse bridge.
 *
 * Runs the REAL Azure Function handler (SalesforceCDCWebhook -> dataverseSync) against
 * the live Dataverse environment configured in the repo-root .env, simulating a
 * Salesforce vendor CDC event, then reads the upserted row back so you can see it land.
 *
 *   cd src/azure && node demo-bridge.js            # sync a demo vendor and show the row
 *   cd src/azure && node demo-bridge.js --cleanup  # delete the demo vendor row
 *
 * Manual dev/demo tooling only — touches a live org, so run it by hand (not in CI).
 */
const fs = require('fs');
const path = require('path');
const { ClientSecretCredential } = require('@azure/identity');
const axios = require('axios');

// 1) Load repo-root .env into process.env — the Function handler reads its config from env.
const envPath = path.join(__dirname, '..', '..', '.env');
for (const ln of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = ln.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const DV = (process.env.DATAVERSE_ENV_URL || '').replace(/\/+$/, '');
const VENDOR = { Id: 'DEMO-VENDOR-001', Name: 'Demo Logistics Pte Ltd', UEN__c: '202612345D' };

const out = (s = '') => console.log(s);
const rule = () => out('─'.repeat(62));

function cred() {
  return new ClientSecretCredential(
    process.env.DATAVERSE_TENANT_ID,
    process.env.DATAVERSE_CLIENT_ID || process.env.DATAVERSE_APP_ID,
    process.env.DATAVERSE_CLIENT_SECRET
  );
}

async function readBack() {
  const tok = await cred().getToken(`${DV}/.default`);
  const enc = encodeURIComponent(VENDOR.Id).replace(/'/g, '%27');
  const r = await axios.get(
    `${DV}/api/data/v9.2/accounts(crfe6_salesforceid='${enc}')` +
      `?$select=accountid,name,crfe6_uen,crfe6_salesforceid,crfe6_syncstatus`,
    { headers: { Authorization: `Bearer ${tok.token}`, Accept: 'application/json', Prefer: 'odata.include-annotations="*"' }, timeout: 30000 }
  );
  return r.data;
}

async function cleanup() {
  const tok = await cred().getToken(`${DV}/.default`);
  const enc = encodeURIComponent(VENDOR.Id).replace(/'/g, '%27');
  await axios.delete(`${DV}/api/data/v9.2/accounts(crfe6_salesforceid='${enc}')`,
    { headers: { Authorization: `Bearer ${tok.token}` }, timeout: 30000 });
  out(`🧹 Deleted demo vendor (crfe6_salesforceid='${VENDOR.Id}').`);
}

(async () => {
  rule(); out('  SF → Dataverse Bridge — LIVE DEMO'); out(`  target: ${DV}`); rule();

  if (process.argv.includes('--cleanup')) { await cleanup(); return; }

  // 2) Build a Salesforce CDC event shaped exactly like VendorTriggerHandler emits.
  const event = {
    id: 'demo-' + Date.now(),
    eventType: 'Salesforce.Vendor.Updated',
    subject: 'VendorOnboarding/' + VENDOR.Id,
    data: { ...VENDOR, ChangeEventHeader: { changeType: 'UPDATE' } }
  };
  out('  Simulated Salesforce vendor event:');
  out(`    salesforceId : ${VENDOR.Id}`);
  out(`    name         : ${VENDOR.Name}`);
  out(`    uen          : ${VENDOR.UEN__c}`);
  out('');
  out('  → Invoking the bridge handler (SalesforceCDCWebhook → Dataverse Web API)…');

  // 3) Run the REAL function handler — same code path the Azure Function executes.
  //    Requiring the module outside the Functions host prints two benign "test mode"
  //    warnings from @azure/functions; silence just those so the demo output stays clean.
  const _warn = console.warn;
  console.warn = (...a) => { if (/@azure\/functions|test mode|Azure Functions runtime/i.test(a.join(' '))) return; _warn(...a); };
  const { runHandler } = require('./src/functions/SalesforceCDCWebhook');
  console.warn = _warn;
  const context = {
    log: (...a) => out('    [bridge] ' + a.join(' ')),
    error: (...a) => console.error('    [bridge:err] ' + a.join(' '))
  };
  await runHandler(event, context);

  // 4) Read the row straight back from live Dataverse.
  out('');
  out('  ✅ Reading the vendor row back from Dataverse:');
  const row = await readBack();
  out(`    accountid          : ${row.accountid}`);
  out(`    name               : ${row.name}`);
  out(`    crfe6_uen          : ${row.crfe6_uen}`);
  out(`    crfe6_salesforceid : ${row.crfe6_salesforceid}`);
  out(`    crfe6_syncstatus   : ${row.crfe6_syncstatus} (${row['crfe6_syncstatus@OData.Community.Display.V1.FormattedValue']})`);
  out('');
  out('  Re-run:   cd src/azure && node demo-bridge.js');
  out('  Clean up: cd src/azure && node demo-bridge.js --cleanup');
  rule();
})().catch((e) => {
  const s = e.response ? e.response.status : 'n/a';
  console.error('  ❌ demo failed (HTTP ' + s + '): ' + e.message);
  if (e.response && e.response.data) {
    const d = typeof e.response.data === 'string' ? e.response.data : JSON.stringify(e.response.data);
    console.error('  detail: ' + d.slice(0, 400));
  }
  process.exit(1);
});

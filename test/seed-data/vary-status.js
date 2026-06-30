#!/usr/bin/env node
/**
 * Thin companion dispatcher to seed-dataverse.js that runs ONLY Phase 2
 * (inject status variety: 3 Pending + 4 Error). Useful when you've already
 * let the Azure Function sync the Salesforce inserts naturally (Phase 1 via
 * the live pipeline) and just want to inject the demo variety afterwards.
 *
 * Equivalent to:  node test/seed-data/seed-dataverse.js --phase=2
 *
 * Run (from repo root):
 *   node test/seed-data/vary-status.js
 *   node test/seed-data/vary-status.js --dry-run
 *
 * See seed-dataverse.js for required env vars.
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const result = spawnSync(process.execPath, [
    path.join(__dirname, 'seed-dataverse.js'),
    '--phase=2',
    ...process.argv.slice(2)
], { stdio: 'inherit' });

process.exit(result.status ?? 1);

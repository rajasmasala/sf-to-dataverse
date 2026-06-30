#!/usr/bin/env bash
# Thin wrapper that runs the anonymous-Apex Salesforce seed against the
# currently-configured sf target-org. No arguments.
#
# Prereqs:
#   - sf CLI installed and a writable target-org configured:
#       sf org login web --set-default-dev-hub
#       sf org create scratch -f config/project-scratch-def.json -a dev -y 30
#       sf project deploy start --target-org dev     # deploys UEN__c
#       sf config set target-org dev
#   - UEN__c field deployed (the deploy step above).
set -euo pipefail

if ! command -v sf >/dev/null 2>&1; then
  echo "ERROR: sf CLI not found on PATH. Install: https://developer.salesforce.com/tools/salesforcecli" >&2
  exit 127
fi

TARGET_ORG="$(sf config get target-org --json 2>/dev/null | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["result"][0]["value"] if d.get("result") else "")' 2>/dev/null || true)"
if [ -z "${TARGET_ORG:-}" ]; then
  echo "ERROR: no sf target-org configured. Run:" >&2
  echo "  sf config set target-org <alias>" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "Running Salesforce seed against target-org '${TARGET_ORG}'..."
sf apex run -f "${SCRIPT_DIR}/seed-salesforce.apex"
echo "Done. Look for 'Seed: done. inserted=...' in the debug log above."

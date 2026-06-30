#!/bin/bash
curl -X POST \
  http://localhost:7071/runtime/webhooks/EventGrid?functionName=SalesforceCDCWebhook \
  -H "Content-Type: application/json" \
  -H "aeg-event-type: Notification" \
  -d @test/mock-salesforce-cdc-event.json
echo -e "\nEvent dispatched to local runtime."
# Scotty’s Vision Kitchen

Owner-private, installable kitchen companion for the Lenovo M8 and S24 Ultra. Large touch controls, device-local IndexedDB, explicit cloud acknowledgement, private D1/R2 backup, and reviewed live Google Sheets integration.

## Use

Open the published private URL in Chrome on both devices using the same authorised ChatGPT identity. Install from Chrome’s menu. Open once online and wait for Offline app ready. The S24 Ultra is the preferred invoice camera; the tablet is for kitchen logging and recipe building. Sync while the app is open and connected. Old standalone logger data must be exported as JSON and imported; browser origins cannot be migrated silently.

Prices are CAD. An unreviewed or missing price stays unknown. Count-to-weight/volume conversions require measured values. Saved recipe cards retain a cost snapshot; ingredient margin excludes labour, overhead and tax. Recipe revisions branch instead of silently overwriting simultaneous edits.

## Storage and privacy

Events are immutable, scoped to the authenticated Site user, deduplicated by owner and ID, and hash checked. Attachments are owner scoped and private. No Google credentials are shipped to the client. Server connector calls are confined in code to the configured Vision workbook. Platform consent is connector wide; the application itself enforces the workbook restriction. Local browser records are not protected by online sign-out: use a dedicated, screen-locked tablet and keep backups. JSON backups contain data, not image bytes; keep original receipt photos and sync attachments.

## Google Sheets

Refresh reads current metadata and the live ingredient tabs. The bundled ingredient cache is an existing private source cache whose prices begin unverified; it never substitutes for a successful live read. User-reviewed overlays persist across refreshes.

Sheets writes require an explicit preview and approval. Each plan is regenerated before commit; changed plans require another preview. Native CellData is read before existing blank rows or reviewed ingredient cells are filled; formatting and validation are preserved. Post-write values are read back. A write with an uncertain outcome is blocked from automatic retry for reconciliation. Ingredient writes establish no stock balance. Waste writes a linked negative stock movement using the original cost snapshot. Finalised recipe writes use separate revision IDs and do not consume stock. Labour/full batch cost remains blank. Invoice intake and wing events are backed up but not automatically posted to purchases, inventory or safety pass fields.

Corrections of waste already posted to Google Sheets require manager reconciliation and reversal in the workbook. Local voids are preserved; a voided entry cannot be newly posted. Do not treat Sheets waste totals as reconciled until posted corrections have been reviewed. Source table fit/visual rendering and real user-authorised Google write acceptance require verification at first approved posting; no production test rows were inserted.

## Checks

`node checks/core.test.mjs`; `node node_modules/typescript/bin/tsc --noEmit`; Sites build helper. Local browser QA checks the actual logger interfaces and live recipe calculations. Local preview is HTTP: service worker installation and authenticated connector calls must be checked on the HTTPS deployment. No live food measurements, staff names, stock quantities, invoice prices or taxes were invented.

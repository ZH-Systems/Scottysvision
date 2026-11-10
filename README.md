# Scotty’s Vision Kitchen

The kitchen companion from the original Scotty’s artifact, migrated to **React 19 + Next.js 16** for Vercel, with **Supabase Auth, Postgres and private file storage**. The original cream/green/orange design, large touch controls, CAD costing and Toronto timestamps are retained.

## What it does

- Recipe builder with live ingredient costing, measured conversions, reviewed overrides, retained cost snapshots, printable cards and concurrent revision branches.
- Ingredient catalog with the original 213 bundled ingredients, reviewed prices, CSV imports, live Sheets refresh and approved Vision mappings.
- Two-step waste logging with a numeric keypad, staff/reason management, corrections that preserve originals, totals and three CSV export formats.
- Wing batches with per-tray cooking/cooling records, derived deadlines, actual-time corrections, oven-out corrections, notes, discard records, printable history and optional audible reminders.
- Invoice/photo/PDF intake with manual package-price review. No automatic OCR, price approval, purchase posting or inventory receipt is implied.
- Local device storage, automatic retrying Supabase sync while open, JSON backup/import and private receipt file upload.
- Explicit Google Sheets preview → approval → write → read-back. Local/Supabase logging does not wait for a workbook write.

## Deploy to Vercel

1. Create or choose the Supabase project.
2. Run the **entire** [SQL migration](supabase/migrations/20261110000000_vision_parity.sql) in its SQL Editor. This creates the tables, views, RLS, transactional sync function and private `vision-attachments` bucket. Run once in a project where these objects do not already exist.
3. In Supabase **Authentication → Users**, create the kitchen email/password account. Use the same account on devices that should share records. The app does not expose public registration.
4. Import this repository in Vercel. Set framework **Next.js**, root directory **repository root**, Node **22.x** or another supported release meeting package.json, install command **npm ci**, build command **npm run build**. Leave output directory at its framework default. Do not select `archive/sites-original` as the root.
5. Add these values under **Vercel → Project → Settings → Environment Variables**, for the deployment environments you will use:

| Variable                    | Value                                            | Exposure                                   |
| --------------------------- | ------------------------------------------------ | ------------------------------------------ |
| `SUPABASE_URL`              | Supabase project URL                             | Public configuration                       |
| `SUPABASE_ANON_KEY`         | Supabase anon or publishable API key             | Public configuration                       |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role or server secret API key   | Server only, never prefix with NEXT_PUBLIC |
| `SUPABASE_STORAGE_BUCKET`   | `vision-attachments`                             | Optional, defaults to this name            |
| `VISION_ALLOWED_EMAILS`     | Optional comma-separated approved account emails | Server allowlist                           |

6. Deploy/redeploy after saving environment variables. Open the application, go to **Sync & backup**, sign in, and leave automatic backup enabled. Set Vercel Deployment Protection if the entire hosted shell/catalog should also require access control.

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are also accepted as aliases, but the names in the table avoid build-time public-variable substitution. `/api/config` returns only the public URL/key, bucket and setup booleans. It never returns the service key or Google private key.

Supabase credentials alone enable local + Supabase logging. Google Sheets needs the additional optional setup below because Vercel does not provide the original ChatGPT/Sites connector capability.

## Keep the original workbook integration

1. Enable Google Sheets API for a Google Cloud service account.
2. Share the existing Vision workbook with that service account email as Editor.
3. Add these Vercel environment variables and redeploy:

| Variable                       | Value                                                                      |
| ------------------------------ | -------------------------------------------------------------------------- |
| `VISION_SPREADSHEET_ID`        | The Vision workbook ID from its URL                                        |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service account email                                                      |
| `GOOGLE_PRIVATE_KEY`           | Its private key, actual newlines or literal `\n` accepted; server only     |
| `VISION_SHEETS_ALLOWED_EMAILS` | Comma-separated Supabase login emails permitted to use the shared workbook |

The same workbook headings/tabs from the artifact are required: `MASTER INGREDIENTS`, `01_INGREDIENTS`, `99_LISTS`, `09_WASTE_LOG`, `08_INVENTORY_TXNS`, `04_RECIPES`, `05_RECIPE_COMPONENTS`. No workbook ID or credentials are hard-coded in the active application.

Sheets writes require explicit approval. Waste creates a negative stock movement; recipes do not consume stock. Corrections to already-posted waste and uncertain posting attempts need manager reconciliation. The Vercel app coordinates its own users with a workbook-wide Postgres lock; it cannot coordinate with the separate original Sites/D1 app. Avoid concurrent posting from both installations.

## Supabase parity model

Every original logged event retains its ID, entity ID, timestamp and complete JSON payload. The immutable journal preserves history rather than replacing it with only a current row.

| Object                                      | Purpose                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| `vision_events`                             | All eight logged event kinds and immutable payloads                            |
| `vision_catalog_items`                      | Reference ingredients, including the bundled catalog and live source refreshes |
| `vision_files`                              | Receipt metadata, hashes and owner-scoped Storage paths                        |
| `vision_postings`                           | Sheets attempting/confirmed/reconciliation ledger                              |
| `vision_locks`                              | Workbook-wide posting lock                                                     |
| `vision_ingredients`                        | Current catalog with reviewed ingredient events overlaid                       |
| `vision_catalog`                            | Reference source catalog without review overlays                               |
| `vision_waste`, `vision_waste_voids`        | Waste and append-only corrections                                              |
| `vision_inventory_txns`                     | Derived negative waste movements, with void status; no invented opening stock  |
| `vision_wing_batches`, `vision_wing_events` | Batch definitions and all individual readings/actions                          |
| `vision_recipe_revisions`                   | Every draft/finalized revision and retained cost snapshot                      |
| `vision_invoices`                           | Every invoice intake/review-copy record                                        |
| `vision_settings`                           | Latest employee/reason settings                                                |

All owner data is scoped to the Supabase Auth user. Reporting views use security-invoker mode, so authenticated SQL/API reads retain RLS. Direct browser writes to the journal, metadata, posting ledger and locks are not granted. Server routes validate the bearer token with Supabase Auth, derive the owner themselves, and use the server-only service key. Transactional RPCs are executable only by service_role.

There is no distributed transaction between device storage, Supabase and Google Sheets. Each new record saves locally, then queues for Supabase; acknowledgment marks it backed up. A failed sync keeps the record pending for retry. Sheets posting remains a separate explicitly approved operation, and an uncertain write is never automatically replayed.

## Offline and migrating records

Install/add the app to the home screen after an online visit. The service worker caches the React shell and loaded assets, excludes APIs and uses a content-derived cache version on each build. Cloud sync and Sheets calls require connectivity and the app open. Browser/OS suspension can delay timers and sounds.

Use the original app’s JSON export, then import from **Sync & backup**. For full Vision backups from the old Site, check the explicit ownership-transfer checkbox. It keeps source IDs/timestamps/payloads but does not reuse the old Site owner, sync cursor or acknowledged-ID list. Imported records must receive new Supabase acknowledgments. Conflicting immutable IDs fail instead of being overwritten. Standalone waste and wing backups are supported too.

A domain change cannot silently copy browser storage. JSON backups contain records, not receipt bytes. Keep original photos/PDFs and upload/attach them again if their bytes are not in this origin’s IndexedDB. Do not run the original and new application simultaneously against the same local IndexedDB origin during migration. Keep exports until the new account’s backup is verified.

## Development

```bash
npm ci
cp .env.example .env.local
# Fill .env.local with development values, never commit it.
npm run dev
```

The app builds without credentials so Vercel can compile before setup is complete; missing configuration is displayed on Sync. Credentials are read at request time.

```bash
npm test
npm run typecheck
npm run build
# Or all three:
npm run verify
```

Tests execute the Postgres migration against PGlite and check RLS, immutable conflicts/rollback, pagination, catalog overlays and workbook locking. Other tests retain original costing/conversion assertions and cover waste snapshots, correction handling and wing deadlines/conflicts. Production Supabase Auth/Storage and Google writes require configured external services and are not claimed tested without them.

## Source layout

- `components/kitchen/`: React screens, reusable fields/dialogs and state/sync provider. No iframe or innerHTML-based UI rendering in the active app.
- `lib/core/`: preserved pure calculation/validation functions from the artifact, consumed by React and tests.
- `lib/local.ts`: IndexedDB and presentation helpers.
- `lib/server.ts`, `lib/validation.ts`: server configuration, identity and request validation.
- `app/api/`: Vercel-compatible Next route handlers.
- `lib/vision-connectors.ts`: Google service-account transport, fixed to the configured workbook.
- `lib/vision-store.ts`: a bounded adapter for the preserved posting planner’s known storage operations.
- `supabase/migrations/`: deployable PostgreSQL schema.
- `archive/sites-original/`: complete tracked source snapshot of the remixed artifact, including its original scripts, logger HTML, assets and Cloudflare schema. This archive is excluded from TypeScript checks and is not served as the application.

The active runtime has no Cloudflare binding dependency. The archive retains the original platform-specific code for provenance and comparison.

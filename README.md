# Scotty’s Vision Kitchen

The original Scotty’s kitchen artifact rebuilt in **React 19, TypeScript and Next.js 16**, ready for Vercel. Its cream, green and orange styling, touch controls, CAD costing and Toronto timestamps are retained. The original source is preserved in `archive/sites-original`.

## Capabilities

- Recipes: live ingredient costing, measured conversions, reviewed overrides, immutable final cards, printed cards, selling prices, labour and overhead costing, margin calculations and explicit concurrent revision branches.
- Ingredients: the original 213 reference ingredients, reviewed prices, CSV import/template, Sheets refresh, Vision mappings, reorder points and par levels. Missing prices and conversions remain unknown.
- Waste: original two-step keypad workflow, employees and reasons, remembered form selections, corrections preserving originals, date filters, printable totals, three CSV formats and standalone JSON backups.
- Wings: per-tray cooking and cooling records, actual-time corrections, deadlines, notes, discards, history printing, original guidance, audible reminders and optional scheduled Web Push.
- Invoices: camera/photo/PDF attachment, manual review, optional OCR and independent verification, editable extracted candidates, reviewed price updates and explicitly approved stock receipts. Extraction does not approve a price or receive stock.
- Stock and production: purchase receipts, reasoned count adjustments, location transfers, finalized-recipe consumption and output, low-stock indicators and reversing movements. Duplicate invoice receipts and stale count adjustments are rejected transactionally. No opening stock is invented.
- Shared kitchens: individual Supabase accounts, owner/manager/staff/viewer roles, kitchen switching, membership management, shared recipe/invoice drafts and settings, and explicit restoration of conflicting draft revisions.
- Backups: local-first IndexedDB, retryable Supabase sync, complete ZIP export/import including receipt bytes, original JSON imports, standalone logger exports and raw recovery downloads.
- Offline: production shell and all generated React bundles cached together. Optional browser Background Sync uses the current session; Web Push uses a separate server scheduler.
- Sheets: original preview → explicit approval → write → read-back workflow, posting locks and a manager reconciliation ledger for uncertain attempts.

## Deploy

1. Create or choose a Supabase project.
2. Run these SQL files in order, using the entire file each time:
   - [Initial schema](supabase/migrations/20261110000000_vision_parity.sql).
   - [Shared kitchens and operations](supabase/migrations/20261110010000_shared_kitchens_and_operations.sql).

   If the initial schema was already applied, run **only the second file**. These migrations are not intended to be replayed manually after success.

3. Create email/password users in **Supabase Authentication → Users**. There is no public registration screen. Each user initially has a personal kitchen. Sign in as its owner, open **Sync & backup → Kitchen access**, and add other existing users by email. Use individual accounts for attribution.
4. Import this repository into Vercel. Select **Next.js**, repository root, Node **22.x** or a supported version satisfying `package.json`, install `npm ci`, build `npm run build`, and the default framework output directory.
5. Set these environment variables in the Vercel project, then redeploy:

| Variable                    | Value                                      | Visibility                          |
| --------------------------- | ------------------------------------------ | ----------------------------------- |
| `SUPABASE_URL`              | Project URL                                | Public configuration                |
| `SUPABASE_ANON_KEY`         | Anon or publishable key                    | Public configuration                |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role or server secret key          | Server only                         |
| `SUPABASE_STORAGE_BUCKET`   | Optional, defaults to `vision-attachments` | Public bucket name, private objects |
| `VISION_ALLOWED_EMAILS`     | Optional comma-separated login allowlist   | Server only                         |

6. Open **Sync & backup**, sign in and sync. The existing owner's records remain in the same scope when upgrading. Other kitchen members access that scope through membership.

Never prefix a service key with `NEXT_PUBLIC`. Runtime `/api/config` returns only public configuration and feature flags. Credentials are not hard-coded. The application builds without credentials and displays setup status. `.env.example` lists optional integrations too.

## Roles and data

| Role    | Access                                                                                                                |
| ------- | --------------------------------------------------------------------------------------------------------------------- |
| Viewer  | Read shared records and pull backups                                                                                  |
| Staff   | Log waste/wings, save working records, perform production                                                             |
| Manager | Staff access plus prices, catalog changes, stock receipt/count/transfer/reversal, invoice approval and reconciliation |
| Owner   | Manager access plus kitchen naming and membership management                                                          |

Sheets also requires the explicit email allowlist below. Revoked membership blocks future server access; data already downloaded onto a device cannot be remotely erased.

The immutable `vision_events` journal retains IDs, entity IDs, timestamps and complete original payloads. Original record views remain available. The forward migration adds `vision_workspaces`, `vision_memberships`, `vision_drafts`, `vision_operations`, `vision_stock_movements`, `vision_purchase_receipts`, `vision_push_subscriptions`, `vision_reminders` and `vision_reconciliations`, plus stock balances. `created_by` attributes new events to individual users. Historical records retain their original payloads.

Member reads use RLS and security-invoker views. Browser writes go through authenticated server routes and bounded service-role RPCs. The server validates tokens with Supabase Auth and checks the selected kitchen and role. Stock operations use database locks, immutable operation IDs and atomic rollback. Waste with a known measured base quantity deducts stock once; voids reverse it once. Unmeasured waste cannot fabricate a stock conversion.

Shared draft revisions include parent revisions. Concurrent branches stay visible until an operator chooses a revision. Kitchen switching preserves each kitchen's unsynced local work separately. Full backups do not reuse another account's cloud acknowledgments or sync cursor.

## Receipt OCR

Deploy the included [receipt extraction service](services/receipt-ocr/README.md), or supply an adapter with its JSON contract. Set `VISION_OCR_API_URL` and `VISION_OCR_API_KEY` in Vercel. The included Docker service performs Tesseract OCR, supports native/scanned PDFs, and can use an optional OpenAI-compatible model for structured extraction. It can run independently of the Vercel application.

Optional `VISION_VERIFY_API_URL` and `VISION_VERIFY_API_KEY` configure a second verification call. Without it, schema and arithmetic checks still run. The editor shows candidates and warnings, requires acceptance into the draft, and leaves unknown quantities, units and prices blank. Review mappings and package measurements before approving an invoice receipt. A receipt uses the net line subtotal, not tax-inclusive guesses. Natural invoice identity and review lineage prevent duplicate stock receipts; reverse the earlier receipt before receiving a corrected one.

## Background work and notifications

The production service worker caches the complete build asset manifest. An initial online visit and successful offline installation are required. APIs are excluded from the cache. Open-app sync remains available independently of browser Background Sync.

Enable background backup in **Sync & backup**. Browser support and operating-system scheduling vary. The worker stores only the current short-lived access token, not a refresh token. Open the app to refresh an expired session. Browser storage remains sensitive and device access should be controlled.

For closed-app wing reminders:

1. Run `npm run push:keys` locally and set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` and a strong `CRON_SECRET` in Vercel. Keep the private key and cron secret private.
2. Schedule an authenticated GET to `/api/cron/reminders`, with `Authorization: Bearer <CRON_SECRET>`. `vercel.cron.example.json` is an inactive example; configure a supported schedule in your hosting plan. Alternatively schedule `scripts/run-reminders.mjs` with private `VISION_URL` and `CRON_SECRET` environment variables on your server.
3. Enable background reminders in the app and grant browser notification permission. Each browser must subscribe separately.

Delivery uses standard Web Push, membership checks and deduplication. Connectivity, scheduler frequency and device restrictions affect delivery times. Operational food-safety checks still require actual measurements.

## Google Sheets

Enable the Google Sheets API, create a service account and share the Vision workbook with that account as Editor. Set these Vercel variables:

| Variable                       | Value                                                 |
| ------------------------------ | ----------------------------------------------------- |
| `VISION_SPREADSHEET_ID`        | Workbook ID                                           |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service account email                                 |
| `GOOGLE_PRIVATE_KEY`           | Private key, actual newlines or literal `\n` accepted |
| `VISION_SHEETS_ALLOWED_EMAILS` | Comma-separated permitted Supabase login emails       |

Required original tabs are `MASTER INGREDIENTS`, `01_INGREDIENTS`, `99_LISTS`, `09_WASTE_LOG`, `08_INVENTORY_TXNS`, `04_RECIPES` and `05_RECIPE_COMPONENTS`. Sheets posting remains separately approved. Finalizing a recipe does not consume stock; a production operation does.

There is no distributed transaction across IndexedDB, Supabase and Google. Local writes queue for cloud acknowledgement. Uncertain workbook writes require manager reconciliation and are never automatically replayed. The reconciliation screen records the manager's evidence and resolution. The app's workbook lock cannot coordinate with a separate running original Sites installation.

## Moving devices and recovery

Use complete ZIP backup to include records and receipt originals. Imports bound the uncompressed archive size and validate required entries before restoration. JSON-only and original standalone logger backups remain supported. For old full Site backups, use the explicit ownership-transfer option. Cross-origin browser storage cannot be copied silently, so export from the original app first. Older JSON exports do not contain photo bytes; retain and attach those originals separately.

Keep exports until the new kitchen's backup is verified. Raw recovery downloads are available even when saved application state cannot be opened. Browser/OS eviction can remove local data, so local storage alone is not a backup.

## Development and verification

```bash
npm ci
cp .env.example .env.local
# Fill only local development secrets, never commit them.
npm run dev
npm run verify
```

`verify` runs calculation and database tests, type checking, the production build, HTTP smoke tests, and a production-route integration harness using PostgreSQL in PGlite and fixture Auth/Storage/OCR services. Tests cover memberships, RLS, draft branching, stock rollback, duplicate receipts, count races, waste reversal, reconciliation and offline asset availability. The OCR service has separate Python tests exercising real Tesseract and PDF extraction.

Fixture integration tests do not prove live Supabase, Google, model-provider or Web Push delivery. Those require the deployment's actual credentials and configured external services. No production database or workbook is provisioned by committing this repository.

## Source map

| Path                                                               | Responsibility                                            |
| ------------------------------------------------------------------ | --------------------------------------------------------- |
| `app/`                                                             | Next.js shell and server route handlers                   |
| `components/kitchen/`                                              | React screens, touch controls, state provider and sync    |
| `lib/core/`                                                        | Pure recipe, waste, wing, costing, draft and backup logic |
| `lib/local.ts`                                                     | IndexedDB and presentation helpers                        |
| `lib/server.ts`, `lib/validation.ts`                               | Authentication, role checks and validated requests        |
| `lib/vision-connectors.ts`, `lib/vision-store.ts`                  | Google transport and preserved posting planner adapter    |
| `scripts/background-worker.js`, `scripts/build-service-worker.mjs` | Background backup and production offline packaging        |
| `supabase/migrations/`                                             | Schema, RLS and transactional operations                  |
| `services/receipt-ocr/`                                            | Independently deployable receipt OCR service              |
| `tests/`, `scripts/*production.mjs`                                | Database, logic and production-route checks               |
| `archive/sites-original/`                                          | Complete original artifact source for comparison          |

Styling lives in `app/globals.css` and the preserved scoped logger CSS. The active UI uses React components rather than iframe rendering. Next.js handles routing/server endpoints and Vercel packaging; React handles interactive views; TypeScript checks interfaces. Supabase stores shared records and private receipt objects. The original Cloudflare bindings are required only by the archived source.

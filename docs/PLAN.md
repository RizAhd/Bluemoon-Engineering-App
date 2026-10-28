# Bluemoon Site — The Plan

**For:** the owner of Bluemoon Engineering (Pvt) Ltd, and any developer who continues this work.
**Written:** 22 October 2026. **Repo:** https://github.com/RizAhd/Bluemoon-Engineering-App (the app is the repo root).
**Status of this document:** living plan. Update the Decision log (section 16) whenever the owner decides something.

Bluemoon Engineering is a CIDA-registered contractor (C-21184, grades C-6 building and C-7 highways/water/irrigation/drainage) in Welimada, Badulla. Sites are spread across Uva Province, often with no mobile signal. The app records what happens on each site — money spent, wages paid, tools issued, daily notes — and shows the owner what each project costs.

---

## 1. Vision & principles

**Vision:** every rupee, worker-day and tool on every Bluemoon site is recorded on the spot, on a phone, in the supervisor's own language, and the owner can see each project's true cost the same day — without a server, a subscription, or any risk of losing data.

**Principles (every feature is checked against these):**

| # | Principle | What it means in practice |
|---|---|---|
| 1 | **Offline first** | The phone's database is the truth. Nothing waits for the internet. Sync (later) is a copy, never a dependency. |
| 2 | **Rs 0 to start** | Phase 1–2 cost nothing to run. Paid services are added only when the owner asks and only when the free tier is genuinely too small (section 13). |
| 3 | **No data loss, ever** | Every write is a transaction. Nothing is hard-deleted. Daily automatic backups kept 25 days, weekly full backups to Google Drive, checksums on every file. Restore merges and never deletes. |
| 4 | **Three languages, one family** | English, Sinhala, Tamil — every string, every screen. Noto Sans fonts so all three scripts look like one app. |
| 5 | **Simple enough for a site in sunlight** | High contrast, big targets (56 dp), amounts in big tabular digits, one primary action per screen, no ERP screens. |
| 6 | **One source of truth per record** | Each record has one UUID and a version number. Copies on other phones, in PDFs and in backups merge by UUID; the newer version wins; importing twice changes nothing. |
| 7 | **Everything per project** | Expenses, workers, wages, tools, notes and costs belong to a project. The header always shows which project you are working in. |
| 8 | **Fail soft** | Any error is caught, logged on the phone, explained in plain words, and recoverable. The app never closes on its own. |

---

## 2. Where we are today (2026-10-22)

> **Snapshot from 2026-10-22, kept for history.** The current state, build route (tag → `ci-result` branch) and
> open items are in [HANDOVER.md](HANDOVER.md).

### Built and pushed (commit `5725001`)

| Area | What works |
|---|---|
| Projects | Create/edit, status (active, on hold, completed), client, location, contract value, dates. Cost summary with category bars and contract progress. |
| Expenses | Amount-first form, 9 categories, paid-to, cash/bank/cheque, date (Today/Yesterday/calendar), receipt photos (camera or gallery, compressed to ~250 KB, SHA-256 stored). List grouped by day with day totals, month and all-time tiles. |
| Workers & wages | Worker file (name, trade, phone, daily rate). Ledger of work days, advances, payments; balance owed per worker; "Record work" fills amount from days × rate; "Pay wages" pre-fills what is owed. |
| Tools | Tool register; issue/return with worker, project, date, condition and photo proof; "out" vs "in store" from the latest movement. |
| Site notes | Daily note with weather and photos, per project. |
| PDF hand-off | Export a project as a readable PDF that also carries the full project data and photos embedded inside it. Another phone imports it offline, exactly, with checksum checks. Foreign PDFs can be attached to a project. |
| Backups | Daily automatic data snapshot (verified, 25 days kept, older deleted). Full backup with photos as zip parts ≤ 40 MB to Google Drive via the share sheet. Restore merges, never deletes. Android Auto Backup rules for Google-account backup (real APK only). |
| Languages | English, Sinhala, Tamil (Sinhala/Tamil are machine drafts — native review pending). Light and dark themes. |
| Safety | Error-handling core (`src/lib/errors.ts`): local error log, friendly messages, global crash handlers. |

### Being changed right now (multi-agent workflow running)

1. **Professional blue & white theme** — bright white light theme, true dark theme, new typography scale, spacing and alignment rules, written down in `design-system/bluemoon-site/MASTER.md` and applied to every screen.
2. **Projects as a bottom tab** with the full list, filters and a per-project hub.
3. **Workers per project** (`project_workers` table, per-project daily rate), Workers tab scoped to the current project.
4. **"Today's work & pay" sheet** (`/wage/today`): tick who worked today, half/full day, amount auto-filled, pay the same day, one Save.
5. **Everything scoped per project**: Expenses, Tools, Notes and Today follow the project switcher.
6. **Error handling everywhere**: recovery screen with Try again / Share error log, `guard()` around every file, share, photo and save action, "Report a problem" screen.
7. Unit tests (Jest) for money, dates and UTF-8 helpers; a data-safety code review with adversarial verification.

### Test status

| Check | Status |
|---|---|
| `npx tsc --noEmit` | passing at `5725001` |
| `npx eslint src` | passing |
| `npx expo-doctor` | 20/20 |
| Unit tests | being added (jest-expo) |
| Emulator flow + visual review (3 languages, dark mode) | planned next, see section 10 |
| Low-end Android device check | not yet |
| Native-speaker review of Sinhala/Tamil | not yet |

### How to run and test

```powershell
cd D:\Bluemoon-Engineering-App\app
npm install
npm run check                       # tsc + eslint
$env:REACT_NATIVE_PACKAGER_HOSTNAME = '192.168.8.101'   # this PC's Wi-Fi IP
npx expo start --go --lan --port 8081
```

- **Owner's phone (Redmi, Android):** install **Expo Go 58** (Play Store, or the APK from https://github.com/expo/expo-go-releases), same Wi-Fi as the PC, scan the QR. By USB instead: `adb reverse tcp:8081 tcp:8081`, then open `exp://127.0.0.1:8081` in Expo Go.
- **Emulator:** `emulator -avd ReplateAudit_API35 -gpu swiftshader_indirect -no-snapshot` (the default GPU mode crashed twice on this PC). Install Expo Go, then open `exp://192.168.8.101:8081` (if the intent cannot be resolved, open Expo Go → "Enter URL manually"). A helper script `emu.sh` (screenshot / tap / type / open / log) was used for automated flow tests; copy it into `scripts/` when the test phase is finished.

### Known limits today

- **Expo Go cannot run three things:** Android Auto Backup to the Google account (the data sits inside Expo Go), the background daily-backup job (it still runs every time the app opens), and "Share to Bluemoon Site" from WhatsApp (needs the native config plugin). All three work in the real APK.
- **Local APK builds fail on this PC**: Gradle/ninja hits the Windows 260-character path limit (`LongPathsEnabled = 0`), even from a short `D:\bm` folder. **Use the EAS cloud build** (`npm run build:apk`, free plan: 15 Android builds/month — https://docs.expo.dev/billing/plans/). Needs a free Expo account: `npx eas-cli@latest login`.
- App icon, name and splash shown on the phone are Expo Go's until the APK is used.

---

## 3. Users & roles

| Role | Now | Later (Phase 3–4) | Jobs to be done |
|---|---|---|---|
| **Owner** (Bluemoon) | yes, 1 | yes | See each project's cost vs contract today. Know what is owed to workers. Know which tools are out and with whom. Approve corrections. Keep backups safe. |
| **Site supervisor / engineer** | 1–2 | 8–12 | Record every expense with the bill photo in under 30 seconds. Mark who worked today and pay them. Issue/return tools with photo proof. Write the day's note. Never lose a record when there is no signal. |
| **Storekeeper** | — | 1 | Issue and return tools, see what is out. |
| **Accountant / office** | — | 1 | Monthly totals per project and per worker; export to Excel/PDF (Phase 5). |
| **Developer / maintainer** | 1 | 1 | Build, test, release, restore drills, support. |

Access today: whoever holds the phone. From Phase 3: named users with roles and per-project membership (section 7).

---

## 4. Product roadmap

Timelines are rough; the owner's priorities decide the order. Each phase ends only when its acceptance criteria pass.

### Phase 1 — Pilot on one site (now → ~8 November 2026)

**Scope:** one supervisor's phone, one active project, Expo Go for the first week, then the EAS APK.
**Milestones**
1. Redesign + per-project changes pass tsc/eslint/jest, the emulator flow test and the visual review in all three languages and dark mode.
2. First EAS cloud build (`preview` profile) installed on the owner's phone by link.
3. Two weeks of real use: every expense, every worker-day, every tool movement recorded in the app, not on paper.

**Acceptance criteria**
- A new expense with a photo takes ≤ 30 s; a "Today's work & pay" sheet for 10 workers takes ≤ 2 min.
- Zero crashes in the error log; zero records lost (daily snapshot count never goes down).
- Project cost summary in the app equals the supervisor's paper total for the two weeks (to the rupee).
- Owner has done one **full backup with photos** to Google Drive and one **restore** onto a second device (or the emulator).
- Sinhala and Tamil strings reviewed by a native speaker; corrections merged.

**Phase 1 week plan**

| Week | Developer | Owner / supervisor |
|---|---|---|
| 0 (now) | finish redesign + per-project changes; emulator flow test; fix findings; first EAS `preview` build | install Expo Go 58; try the app for 10 minutes; list anything confusing |
| 1 | daily: read the error log the supervisor shares; patch via a new build; add the PIN lock if time allows | record everything on one site; Monday full backup to Drive; note paper totals separately |
| 2 | native-speaker string review merged; restore drill with the owner; write the one-page guides | keep recording; compare paper vs app totals at the end of the week |
| end | pilot report: crashes, lost records, time per task, string fixes | decide: go to Phase 2 or extend the pilot |

**Open questions for the owner (answers go in the Decision log)**
1. Who reviews the Sinhala and Tamil wording — a supervisor, or an outside translator?
2. Which Google account holds the Drive backups? (Use a company account, not a personal one, and share it with one other person.)
3. Start the D-U-N-S application now? It is free, and both app stores need it later.
4. Does the accountant need a monthly Excel export (Phase 5), or are the PDF reports enough?
5. Should workers' phone numbers be stored at all? (They are optional today.)

### Phase 2 — Two phones (November 2026)

- Second supervisor installs the same APK link.
- **PDF hand-off** used weekly: Phone A exports the project, Phone B imports; both show the same totals.
- Weekly full backup to Drive becomes the owner's Monday routine (section 12).
- Add **expo-updates** so JS fixes reach phones without reinstalling (`eas update`).
- Add a **PIN / fingerprint lock** for the app (expo-local-authentication).
- Acceptance: both phones match after a hand-off; a lost-phone drill (restore from Drive to a new phone) completes in < 30 min.

### Phase 3 — Backend & sync on Cloudflare's free tier (when ≥ 3 users or the owner wants live totals; ~4–6 weeks of work)

- Accounts and roles (owner creates users), per-project membership.
- Outbox sync: records and photos flow between phones through Cloudflare D1 + R2 (section 7). PDF hand-off stays as the offline fallback.
- Nightly export of the server database and photos to Google Drive.
- Optional: owner web dashboard (read-only reports).
- Optional, opt-in and paid per document: AI reading of outside PDFs/receipts (Claude API, a few cents per document) to pre-fill expense or project fields; nothing saved without a human confirming.
- Acceptance: airplane-mode test (20 expenses with photos, reboot, reconnect → all 20 synced exactly once); supervisor cannot read another project; monthly restore drill from the server export.

### Phase 4 — Company rollout (Q1 2027)

- **Apply for a D-U-N-S number now** (free, slow) — both stores need it.
- Google Play **organization** account ($25 one-time), app on the **Internal testing** track (up to 100 named Gmail users, no review wait, no 12-tester rule). Public listing not required.
- iPhones (1–3 users): Apple Developer Program as an organization ($99/year), **Unlisted App** distribution.
- 10–15 users, 20-minute training per site, one-page guides in each language.
- Acceptance: all staff installed from Play within one day; support requests < 2 per week after week 2.

### Phase 5 — Growth features (only if asked)

Client progress bills (IPC) with retention and advances · BOQ tracking against the contract · GPS/time-stamped photos · accounting export (Excel/CSV per month) · WhatsApp report sharing with one tap · supplier credit tracking · petty-cash float per supervisor.

---

## 5. Frontend architecture

**Stack:** Expo SDK 58 (React Native 0.88, React 19.3), TypeScript 6, Expo Router (file routes, typed routes), React Compiler on, Reanimated 4, Lucide icons, Noto Sans fonts via `@expo-google-fonts`.

### Folder map

```
src/app/            screens = routes (Expo Router)
  (tabs)/           Today, Projects, Expenses, Workers, Tools (bottom tabs, in that order)
  add.tsx           quick-add sheet (the + button)
  more.tsx          Settings & more (opened from the header menu)
  project/  expense/  worker/  wage/  tool/  note/   forms and detail screens
  import.tsx backup.tsx notes.tsx problem.tsx
src/components/     ui/Txt, ui/Button, ui/form, ui/layout, ui/feedback, Stats, ProjectSwitcher (TabHeader),
                    PhotoStrip, ErrorScreen, ShareReceiver, AutoBackupRunner
src/db/             schema.ts (migrations), index.ts (single write path, live queries), repo.ts (validated
                    domain functions), types.ts
src/hooks/          data.ts (query hooks, current project), form.ts (useRecordForm)
src/i18n/           en.ts si.ts ta.ts index.ts
src/lib/            money dates files bundle pdf backup autoBackup utf8 errors
src/theme/          tokens.ts (colours, spacing, type, motion) index.ts (useColors, useFont, theme pref)
design-system/bluemoon-site/MASTER.md  visual system (source of truth)   FLOWS.md  screen flows
plugins/withBackupRules.js   Android Auto Backup rules (config plugin)
docs/               this plan
app.json eas.json eslint.config.js tsconfig.json package.json
```

### Design system
- All colours, spacing, radii, type sizes and motion timings are **tokens** in `src/theme/tokens.ts`; components never use raw hex. Light and dark palettes carry the same keys.
- `design-system/bluemoon-site/MASTER.md` holds the final values, component rules and a "Do not" list; `FLOWS.md` holds each screen's layout and interactions. Change the files first, then the code.
- Components: `Txt` (font per language, line-height 1.5 so Sinhala/Tamil marks never clip, `numeric` for tabular Latin digits), `Button` (primary/secondary/ghost/danger, 56 dp), `Field`/`AmountField`/`Chips`/`DateField`/`SelectField`/`PickerSheet`, `Screen` (safe areas, keyboard, footer), `Card`/`ListRow`/`ListCard`/`SectionTitle`, `Stat`/`ContractBar`/`CategoryBars`, `Badge`, `EmptyState`, `toast`, `TabHeader` (title, date subtitle, project switcher, menu button), `PhotoStrip`, `ErrorScreen`.

### Languages
- `useT()` returns a typed translator; a missing key in `si.ts` or `ta.ts` fails `tsc`, so the three files can never drift.
- The user picks the language in More; it is stored in `settings` (default: device language if si/ta, else English).
- Amounts always use Latin digits, "Rs 12,500.50" style (`src/lib/money.ts`).

### State & live queries
- No Redux. `useQuery(sql, params)` / `useFirst` run a SQLite query synchronously and re-run after every write (a module-level `dataVersion` counter notifies subscribers). Data is small (thousands of rows), so this is fast and always consistent.
- The "current project" is a settings row read by `useCurrentProjectId()`; `null` means "All projects".

### Forms
- `useRecordForm(table, existingId)` gives a stable UUID before the first save (so photos can attach to a new record), maps `ValidationError(field, key)` to an inline message under the right field, shows "Saved on phone" with a haptic, and hides orphan photos if a new form is abandoned.
- Validation keys: `errName errAmount errProject errDate errDays errNote errWorker rateRequired`.

### Photos
- Camera or gallery → resized to ≤ 1600 px, JPEG q 0.72 (~250 KB) → copied into `documents/attachments/<uuid>.jpg` → SHA-256 and size stored in `attachments`. Files never live in the cache folder.

### Performance budgets
- Cold start to Today ≤ 2 s on a 2019 mid-range Android (release APK; Expo Go is slower).
- Every list is a `FlatList`/`SectionList`; expense queries use `ix_expenses_project_day` and are capped at 500 rows per screen.
- Writes complete in < 50 ms; a 2,000-row import in < 3 s.
- Photo thumbnails via `expo-image` (cached, 96 px).

### Accessibility & sunlight
- Touch targets: 56 dp for primary actions, ≥ 48 dp for chips and rows, 8 dp gaps.
- Every icon-only control has `accessibilityLabel`; status is always colour **+ icon + word**.
- Text scales with the system font size up to 1.6×; body ≥ 16 sp; amounts 30–40 sp.
- Contrast ≥ 4.5:1 for text and ≥ 3:1 for large text/UI in both themes (values in MASTER.md).
- Bright white light theme by default; dark theme uses navy surfaces, never pure black; "Automatic" follows the phone.

---

## 6. Data architecture

### Tables (SQLite, `src/db/schema.ts`)

Every table has the common columns `id TEXT PRIMARY KEY` (UUID made on the phone), `created_at`, `updated_at`, `deleted_at` (soft delete), `version INTEGER` (starts at 1, +1 per change), `device_id`.

| Table | Purpose | Key columns |
|---|---|---|
| `projects` | one per site/contract | name, client, location, contract_cents, start_date, end_date, status (active/on_hold/completed), notes |
| `expenses` | money spent | project_id, day, category (materials/transport/fuel/machinery/food/tools/subcontract/utilities/other), amount_cents > 0, paid_to, method (cash/bank/cheque), note |
| `workers` | people | name, phone, trade, daily_rate_cents (default rate), active |
| `project_workers` *(migration 2)* | who works on which project | project_id, worker_id, rate_cents (rate on this project), active — one logical row per (project, worker) |
| `wage_entries` | the wage ledger | worker_id, project_id, day, kind (work / advance / payment), days (work only), amount_cents, note |
| `tools` | register | name, code, notes |
| `tool_movements` | issue / return | tool_id, kind, project_id, worker_id or taken_by, day, condition, note |
| `site_notes` | daily log | project_id, day, body, weather |
| `attachments` | photos/PDFs | owner_table, owner_id, kind (photo/pdf/file), file_name, mime, size, sha256 |
| `audit_log` | every write | seq, at, device_id, table_name, row_id, action, data (JSON) — never updated or deleted |
| `settings` | key/value | device_id, current_project, lang, theme, last_backup_at, auto_backup*, … |

**Views (totals are never computed on the phone's JS side):**
`v_project_cost` (expense, labour earned, labour paid per project) · `v_worker_balance` (overall per worker) · `v_project_worker_balance` (per project and worker: earned, advance, paid, balance, days_total) · `v_wage_day` (per project, worker, day: days, work, paid, advance) · `v_tool_status` (latest movement per tool, is_out).

### Rules
- **Money** is whole cents (LKR × 100) in INTEGER columns; parsing and formatting only in `src/lib/money.ts`.
- **Migrations are append-only.** `PRAGMA user_version` tracks the applied count; `getDb()` runs the missing ones in order inside transactions. Never edit a shipped migration; add a new one. A failing migration is reported and the recovery screen shows.
- **Single write path:** `save(table, values)` (insert or update, bumps version, stamps times, writes `audit_log`), `remove()` (soft delete), `mergeRow()` (import: newer version wins; equal version → later `updated_at`), all inside `tx()` (nested calls join the outer transaction). Screens call `repo.ts` functions, which validate first (`ValidationError`).
- **Deletes are soft** and travel between phones like any other change, so a deletion on one phone reaches the other.
- **Daily work is idempotent:** `recordWorkDay()` keeps one `work` entry per worker, project and day (re-saving the sheet updates it; unticking removes it).

### Bundle format (what travels in PDFs and backups)
```json
{ "format": "bluemoon-bundle", "version": 1, "kind": "project" | "backup",
  "exported_at": "...", "device_id": "...", "project_id": "...", "project_name": "...",
  "tables": { "projects": [...], "workers": [...], "tools": [...], "project_workers": [...],
              "expenses": [...], "wage_entries": [...], "tool_movements": [...],
              "site_notes": [...], "attachments": [...] } }
```
Import order = parents before children (`DATA_TABLES`). `applyBundle` first writes every file whose SHA-256 matches its `attachments` row (a bad file stops the import before any row changes), then merges all rows in one transaction and reports inserted / updated / skipped counts.

### PDF hand-off format
- `expo-print` renders the readable report (the phone's own fonts shape Sinhala/Tamil correctly).
- `pdf-lib` embeds three kinds of file attachments: `bluemoon-data.json` (the bundle), `bluemoon-data.sha256`, and each photo under its `file_name`. The PDF's Subject is `bluemoon-bundle v1`.
- Import walks the PDF's EmbeddedFiles name tree, checks the hash, and reports `ok | not-ours | damaged | newer`. Send PDFs as **Documents** in WhatsApp (not as images) so they are not re-encoded.

### Backup formats
| Kind | File | Contents | Where |
|---|---|---|---|
| Daily automatic snapshot | `backups/Bluemoon-auto-YYYY-MM-DD.zip` | manifest + `data.json` (all rows), DEFLATE, SHA-256 verified after writing, temp-then-move | app documents folder; 25 days kept, newest always kept |
| Full backup | `Bluemoon-backup-YYYY-MM-DD-HH-mm[-partNofM].zip` | every part: manifest + all rows + a slice of photos; parts ≤ 40 MB; STORE | share sheet → Google Drive |
| Android Auto Backup | — | `files/SQLite/` and `files/backups/` to the user's Google account (25 MB quota, so photos excluded); device-to-device transfer also carries `attachments/` | Google, automatic, real APK only |

**Restore semantics:** always a merge. Newer versions win, nothing on the phone is deleted, parts restore in any order, the same file can be restored twice safely. Errors: `not-zip`, `not-backup`, `newer` (update the app first), `damaged` (hash mismatch).

---

## 7. Backend architecture (Phase 3 design — Cloudflare free tier)

Chosen over Supabase (free plan pauses after 7 days idle, Pro $25/month — https://makerkit.dev/blog/saas/supabase-pricing), Firebase (Cloud Storage needs the Blaze card plan since 3 Feb 2026 — https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024) and an office PC (down whenever power or the PC is off). Cloudflare's free tier never pauses and keeps photos free of egress charges.

### Components
| Piece | Choice | Notes |
|---|---|---|
| API | **Cloudflare Workers**, TypeScript (Hono router) | one `worker/` folder in this repo; `wrangler deploy` |
| Database | **D1** (SQLite) | the **same schema** as the phone plus `tenant_id`, `user_id` (who synced it), `seq` (monotonic change counter), `server_updated_at` |
| Photos/PDFs | **R2** bucket, object key = `sha256` | de-duplicated by content; private; served through the Worker with auth |
| Scheduled jobs | Workers **Cron Triggers** + a GitHub Actions nightly job | heartbeat checks; export D1 + R2 to Google Drive (`wrangler d1 export`, `rclone`) — 30 daily, 12 monthly copies |
| Point-in-time restore | D1 **Time Travel** | restore to any minute in the retention window (check current docs for free vs paid retention) |
| Web dashboard (optional) | React on **Cloudflare Pages** | read-only: project cost, worker balances, tools out, device sync health |

### Authentication
- Owner creates users (`POST /users`) with a role: `owner`, `supervisor`, `storekeeper`. No self-sign-up.
- Login once online: phone number or email + password → JWT (HS256, 30 days) **bound to the `device_id`**; refresh while valid. Passwords hashed with PBKDF2-SHA256 (≥ 600k iterations, WebCrypto) or scrypt; login rate-limited.
- The phone keeps the session and locks the app behind PIN/fingerprint (Phase 2 feature), so the app opens offline for up to 30 days without re-login.

### Authorization
- `project_members(project_id, user_id, role)`. The Worker checks membership for **every row** it accepts or returns (`project_id` column; workers/tools are company-wide but their movements/wages are per project). Owner sees everything.

### Sync protocol
1. **Outbox:** `save()`/`remove()` also append `{table, row_id, version}` to an `outbox` table when sync is on. Each record shows a badge: *Saved on phone* → *Synced* → *Failed*.
2. **Push** (`POST /sync/push`): batches of ≤ 200 rows, oldest first. Server upserts by `id` when `incoming.version > stored.version` (or equal version with later `updated_at`); otherwise returns `conflict` and stores both copies in `conflicts` for the owner to resolve. The outbox row is deleted only after the server confirms.
3. **Pull** (`GET /sync/pull?since=<cursor>&limit=500`): rows with `seq > cursor`, applied with `mergeRow()` in one transaction; the device stores the new cursor. Soft deletes travel as rows with `deleted_at`.
4. **Photos:** `POST /files/upload-url {sha256,size,mime}` → upload → `PUT /files/:sha256/confirm` (server verifies size + hash). Downloads on demand, cached in `attachments/`. A row never references a photo the server has not confirmed.
5. **Heartbeat** (`POST /devices/heartbeat`): app version, last sync, unsynced count. The owner's Today shows any phone silent for > 2 days.
6. **Triggers:** app start, foreground, network reconnect, every 15 min in the foreground, and the background task. **Logout is blocked while anything is unsynced.**
7. **Migration from phone-only:** the first sync pushes the whole local database (a few MB) and all photos; PDF hand-off remains as the fallback when a site has no signal for days.

### Extra tables for sync

| Where | Table | Columns |
|---|---|---|
| phone | `outbox` | seq, table_name, row_id, version, created_at, attempts, last_error |
| phone | `sync_state` | key/value: cursor, last_sync_at, user_id, token |
| server | `users` | id, tenant_id, name, phone, email, password_hash, role (owner/supervisor/storekeeper), disabled_at |
| server | `devices` | id (= phone's device_id), user_id, app_version, last_seen_at, last_sync_at, unsynced_count, revoked_at |
| server | `project_members` | project_id, user_id, role |
| server | `conflicts` | id, table_name, row_id, server_row (JSON), incoming_row (JSON), device_id, created_at, resolved_at, resolved_by |
| server | every data table | phone columns + tenant_id, user_id, seq (from a global counter), server_updated_at |

**One sync, step by step**
1. Phone: `POST /sync/push` with up to 200 outbox rows (oldest first) and their current row data.
2. Worker: check JWT + device; for each row check project membership; upsert if newer; otherwise write a `conflicts` row; reply per row `{id, status: accepted|conflict|rejected}`.
3. Phone: delete accepted outbox rows; mark rejected rows *Failed* (shown to the user with the reason); keep conflicts visible to the owner.
4. Phone: `GET /sync/pull?since=<cursor>`; apply each page with `mergeRow()` in one transaction; save the new cursor; repeat until the page is short.
5. Phone: for each `attachments` row pulled, download the file on first view (or in the background on Wi-Fi) and verify its SHA-256 before marking it available.
6. Phone: `POST /devices/heartbeat`. The whole cycle is idempotent: if the app dies at any step, the next run repeats it without duplicates.

### Endpoints
```
POST /auth/login   POST /auth/refresh   POST /auth/logout   GET /me
POST /users  GET /users  PATCH /users/:id                      (owner)
GET  /projects/:id/members   PUT /projects/:id/members/:userId (owner)
POST /sync/push   GET /sync/pull?since=&limit=
POST /files/upload-url   PUT /files/:sha256/confirm   GET /files/:sha256
POST /devices/heartbeat   GET /devices                           (owner)
GET  /reports/project-cost?project_id=   GET /reports/worker-balances
POST /imports   GET /imports/:id          (Phase 3 optional AI PDF reading)
GET  /health
```

### Free-tier limits vs expected use (15 users)
| Resource | Free limit | Expected | Source |
|---|---|---|---|
| Workers requests | 100,000 / day | ~5,000 / day | https://eastondev.com/blog/en/posts/dev/20260526-cloudflare-free-limits/ |
| D1 rows read / written | 5 M / 100 k per day; blocks at the limit (no charge) since 1 Sep 2026 | ~50 k / ~1.5 k | https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/ |
| D1 storage | 5 GB | < 50 MB per year | same |
| R2 storage | 10 GB, zero egress | ~1.1 GB / month of photos → free for ~9 months, then ~$0.015 per GB-month | same (R2 may ask for a card on file) |

**Upgrade path:** Workers Paid at **$5/month** removes the daily caps. Nothing else changes.

---

## 8. Security & privacy

### Sri Lanka Personal Data Protection Act (PDPA)
- Act No. 9 of 2022, amended by Act No. 22 of 2025. Gazette Extraordinary No. 2498/16 (22 July 2026) brought Sections 2–3, Part I (processing) and **Part III (controllers and processors: Data Protection Officer, breach notification, impact assessments) into force on 1 January 2027**. Part II (data-subject rights) is deferred. Sources: https://www.ft.lk/front-page/Data-protection-compliance-regime-takes-effect-on-1-Jan-2027/44-795776, https://www.dailymirror.lk/breaking-news/Legal-experts-flag-unique-compliance-landscape-in-staggered-PDPA-rollout/108-346685.
- Personal data in this app: worker names, phone numbers, trades, wages and advances; later, staff accounts. **No NIC numbers, no ID photos.**

| Obligation | How we meet it |
|---|---|
| Minimum data | Only fields needed to pay and manage work; no NIC/ID images; photos are of bills and work, not people (train staff) |
| Access control | Phone lock + app PIN (Phase 2); roles and per-project membership (Phase 3) |
| Accountability | `audit_log` of every write with device and time; server audit from Phase 3 |
| Transparency | Privacy page at `bluemoonengineering.lk/privacy` (also required by Play/Apple) |
| DPO | The owner, until the company names someone |
| Breach procedure | One page: detect → contain (disable device/user, change passwords) → assess what data → notify the Data Protection Authority if required → inform affected workers → record it |
| Retention | Keep project records 7 years after completion (accounting practice; the owner/accountant confirms), then delete |

### Device security
- Modern Android encrypts storage; require a screen lock on staff phones.
- Phase 2: PIN/biometric lock on app open; auto-lock after 5 minutes.
- Lost phone today: restore from the latest Drive full backup onto a new phone; nothing can be remotely wiped. Phase 3: the owner disables the device; its token stops working.

### Server security (Phase 3)
- TLS everywhere (Cloudflare). Secrets only in Wrangler secrets, never in the repo. Hashed passwords, JWT with short refresh, device binding, login rate limits, least-privilege R2 access, D1 location hint `apac`.

### Third parties
- **Today: none.** No analytics, no crash-reporting SaaS; the error log stays on the phone unless the user shares it.
- Google: Android Auto Backup to the user's own Google account; Drive only when the user shares a backup there.
- Anthropic: **only** if the optional AI PDF reading is turned on (document contents are sent; disclosed in the privacy page; off by default).

---

## 9. Reliability & data safety

### The layers (each one catches what the previous misses)
1. **Phone database** — transactions, soft deletes, audit log, UUID + version.
2. **Daily automatic snapshot** (`src/lib/autoBackup.ts`) — all records, verified by re-reading the SHA-256, temp-then-move, **25 days kept**, older deleted automatically, newest always kept. Runs on app open/foreground and via the Android background task (12-hour minimum interval; Android chooses the moment — https://docs.expo.dev/versions/v58.0.0/sdk/background-task/).
3. **Android Auto Backup** — database + snapshots to the Google account (real APK), restored on reinstall.
4. **Weekly full backup with photos** to Google Drive (owner's routine) — parts ≤ 40 MB, each self-contained.
5. **Every exported project PDF** is itself a restorable copy of that project.
6. Phase 3: server copy + nightly export to Drive + Time Travel.

### Signals the owner sees on Today
Green "Records backed up today" · amber "Photos not saved to Drive for N days" (after 7) · red "Automatic backup failed" (tap → Backup screen shows the error).

### Restore drills
Monthly, on the emulator or a spare phone: install the app, restore the latest full backup, compare the Backup screen's record/photo counts and two project totals with the live phone. Log the result in `docs/RESTORE-DRILLS.md` (create on first drill).

### Error handling design (`src/lib/errors.ts`)
- `reportError(err, context)` appends one JSON line to `documents/errors.log` (trimmed at 256 KB).
- `friendlyMessage(err, t)` maps known failures to the user's language: storage full, permission denied, database error, file missing, no connection, camera off; anything else → "Something went wrong. Nothing was lost — please try again."
- `showError()` = report + alert; `guard(context, t, fn)` wraps any risky action and never throws.
- `installGlobalErrorHandlers()` catches uncaught errors and unhandled promise rejections; a fatal error shows **ErrorScreen** (Try again / Share error log / Go to Today) instead of closing the app; Expo Router's `ErrorBoundary` covers render errors per route.
- **More → Report a problem** lists the log newest-first with Share (WhatsApp/email to the developer) and Clear.

### Storage monitoring
The Backup screen shows records, photo count and MB used. `ENOSPC` maps to "phone is out of storage space". Planned: warn on Today when free space < 500 MB (`Paths.availableDiskSpace`).

---

## 10. Testing strategy

| Level | What | Command / tool | When |
|---|---|---|---|
| Static | types, lint, Expo config health | `npm run check`, `npx expo-doctor` | every commit |
| Unit | money parsing/formatting, date arithmetic (month/year ends, leap day, invalid dates), UTF-8 round trips for Sinhala/Tamil/emoji incl. the fallback codec | `npm test` (jest-expo, `src/lib/__tests__`) | every commit |
| Unit (next) | merge rules (`classifyRow`/`mergeRow`), bundle collect/apply, backup verify — needs a Node SQLite shim for `expo-sqlite` | `npm test` | Phase 2 |
| Emulator flow | scripted tour: new project → expenses → worker → today's work & pay → tool issue/return → note → backup → export PDF → import; screenshot at each step; checks totals, toasts, no clipping, no overlap | `emu.sh` (adb screencap / tap / type) driven by an agent or a person | before every release |
| Visual review | every screen in English, Sinhala, Tamil; light and dark; font scale 1.3× | screenshots from the emulator flow | before every release |
| Device | low-end Android (2–3 GB RAM): cold start, camera, 200+ expenses list, outdoor readability | manual, 30-minute checklist | Phase 1 and each major release |
| Data safety | export → import on a second device equals source; restore from a daily snapshot and from a multi-part full backup; corrupt a zip and confirm "damaged"; airplane-mode use for a whole day | manual | Phase 1, then monthly drill |

**The emulator flow test (steps and expected results)**

| # | Action | Expect |
|---|---|---|
| 1 | open app, empty database | Today onboarding state with "New project" |
| 2 | New project "Welimada School Block A", client, location, contract 12,500,000 | toast "Saved on phone"; Today shows the project; header pill shows it |
| 3 | + → New expense 4,500 Materials "Lanka Hardware"; second expense 1,250 Fuel | Expenses tab: day group with total Rs 5,750; month tile Rs 5,750 |
| 4 | tap an expense → back without changes | no change, no toast |
| 5 | Workers tab → Add worker "Sunil Perera", Mason, rate 3,500 | worker listed on this project, balance Settled |
| 6 | Today's work & pay: tick Sunil, 1 day, Pay now 3,500 → Save today | toast "Today saved"; Workers shows balance Settled; Today shows "Workers today 1 · Wages paid today Rs 3,500" |
| 7 | Give advance 1,000 | balance shows "Advance over Rs 1,000" (amber) |
| 8 | Tools → New tool "Concrete mixer" BM-T-01 → Issue to Sunil | tool shows Out on this project, with Sunil, today |
| 9 | Return the tool | In store; history has issue + return |
| 10 | Site note "Foundation concrete poured, 6 workers" | notes list shows it under today |
| 11 | More → Backup → Run now | green "Records backed up today"; one snapshot listed |
| 12 | Project hub → Export PDF | Android share sheet opens; back |
| 13 | More → Import PDF → pick the exported file | preview shows "Already up to date" for everything |
| 14 | Language → සිංහල, then தமிழ் | every screen renders, no boxes, no clipped letters |
| 15 | Appearance → Dark | all screens dark, no white leftovers, text readable |
| 16 | Report a problem | "No errors recorded" |

**Low-end device checklist (30 minutes):** cold start time · camera opens and photo attaches within 5 s · scroll a 200-row expense list without stutter · readability outdoors at 50 % brightness · font size 1.3× in phone settings · back button behaviour on every screen · rotate not required (portrait locked) · airplane mode for a whole flow.

**Pilot checklist (Phase 1):** backup green every day · 0 lines in the error log that are not explained · paper total = app total · supervisor can do every task without asking · Sinhala/Tamil reviewed.

**Pre-release checklist:** `npm run check` and `npm test` green · emulator flow passes · screenshots reviewed · `android.versionCode` bumped · CHANGELOG line added · APK installed on the owner's phone from the EAS link · restore of yesterday's snapshot works on the new build.

---

## 11. Release & distribution

- **Versioning:** `app.json` → `expo.version` (semver, shown in More → About) and `android.versionCode` (+1 per store/APK build). Tag releases in git (`v1.0.0`).
- **EAS build profiles** (`eas.json`): `preview` = installable APK by link (`npm run build:apk` = `eas build -p android --profile preview`); `production` = AAB for Play; `development` = dev client. Free plan: 15 Android builds/month, low-priority queue (https://docs.expo.dev/billing/plans/).
- **EAS Update** (Phase 2): add `expo-updates`, `runtimeVersion: { policy: "appVersion" }`; `eas update --branch production --message "..."` ships JS/UI fixes in minutes; native changes still need a build.
- **Install by link (staff):** open the EAS build link on the phone → Download → if Chrome asks, allow "install unknown apps" for Chrome → Install → Play Protect may say "unknown app": **Install anyway**. Updates: install the new APK over the old one (data is kept).
- **Android developer verification:** Google starts requiring verified developers for installs on certified devices from 30 September 2026 in Indonesia, Singapore and Thailand, expanding worldwide in 2027 (https://support.google.com/android-developer-console/answer/16561738?hl=en). Before it reaches Sri Lanka: either the $25 company developer account, or the free **limited distribution account** (no fee, no government ID, up to 20 devices) — enough for Phases 1–3.
- **Google Play internal testing (Phase 4):** D-U-N-S number → Play Console **organization** account ($25) → create app → Internal testing → upload the `production` AAB → add up to 100 tester Gmail addresses → share the opt-in link. Organization accounts are exempt from the "12 testers for 14 days" rule that applies to personal accounts created after 13 Nov 2023 (https://www.testerscommunity.com/blog/google-play-closed-testing-requirements-2026). Managed Google Play "private apps" were rejected: they need an EMM/MDM (https://support.google.com/googleplay/work/answer/9563481).
- **iOS (only if iPhones):** Apple Developer Program as an organization, $99/year, needs the same D-U-N-S, a working website on the company domain and a matching email (https://developer.apple.com/support/D-U-N-S/). Distribute as an **Unlisted App** (review once, link-only). TestFlight only as a 90-day stop-gap. Also required by both stores: a privacy policy URL and a demo login for reviewers.
- **D-U-N-S first:** free, can take days to weeks — apply at the start of Phase 2.

---

## 12. Operations & support

**Staff reporting a problem:** More → Report a problem → Share error log → send to the developer on WhatsApp with one line about what they were doing. The app also shows the recovery screen with "Try again" if anything fatal happens; records are never affected.

**Owner's Monday routine (10 minutes):**
1. Open Today: the line under the date must be green ("Records backed up today"). If red, tap it and send the error log.
2. More → Backup → **Back up now** (full backup with photos) → save to Google Drive folder `Bluemoon Site Backups/<year>`. Keep the last 8 weekly files; delete older ones yourself.
3. Projects: check each active project's cost vs contract; Workers: "To pay" total; Tools: tools out.
4. First Monday of the month: restore drill (section 9).

**Update routine (developer):** fix → `npm run check` + `npm test` → emulator flow → `npm run build:apk` (or `eas update` for JS-only fixes) → send the link to the owner → owner confirms on the phone → tag.

**Training materials (Phase 1–2):** one-page picture guides per language: *Record an expense*, *Today's work & pay*, *Issue/return a tool*, *Weekly backup*. A 20-minute hands-on session per site; week-one support on WhatsApp.

**One-page guide outlines (make one per language, with screenshots):**

*Record an expense* — 1 Tap the orange/blue **+**. 2 Tap **New expense**. 3 Type the amount. 4 Tap the category. 5 **Take photo** of the bill. 6 Check the project name at the top. 7 **Save**. You will see "Saved on phone". Works with no signal.

*Today's work & pay* — 1 Open **Workers**. 2 Tap **Today's work & pay**. 3 Tick everyone who worked; tap ½ or 1½ if not a full day. 4 The amount fills itself from the daily rate; change it if needed. 5 In **Pay now** type what you hand over today (leave 0 if paying later). 6 **Save today**. Open it again later the same day to correct anything.

*Issue or return a tool* — 1 Open **Tools**. 2 Tap the tool. 3 **Issue tool** → choose the worker → **Take photo** → **Save**. 4 When it comes back: **Return tool** → note the condition → **Save**.

*Weekly backup (owner)* — 1 Open **More → Backup**. 2 Tap **Back up now**. 3 Choose **Google Drive** → folder *Bluemoon Site Backups*. 4 Wait for "Backup ready". Do this every Monday.

**Who to call:** developer (repo owner, Riflan Mohamed) for app problems; the owner for data corrections; nobody else has access to the data.

---

## 13. Costs by phase

| Phase | Item | Cost (USD) | ≈ LKR at 300 |
|---|---|---|---|
| 1 Pilot | Expo Go, Metro, EAS free builds, Google Drive (15 GB free) | **0** | 0 |
| 2 Two phones | EAS free builds + updates, Drive | **0** (Google One 100 GB ≈ $2/month only if Drive fills) | 0–600/month |
| 3 Backend | Cloudflare Workers/D1/R2 free tier | **0**; Workers Paid $5/month when caps are near; R2 ≈ $0.015/GB-month beyond 10 GB | 0–1,500/month |
| 3 optional | AI reading of outside PDFs (Claude API) | ~$0.01–0.05 per document, pay-as-you-go | 3–15 per document |
| 4 Rollout | Google Play organization account | **$25 once** | 7,500 once |
| 4 Rollout | Apple Developer Program (only if iPhones) | **$99 / year** | 29,700 / year |
| 4 Rollout | D-U-N-S number | free | 0 |
| Any | EAS Starter (only if > 15 builds/month are ever needed) | $19/month | 5,700/month |

Year-one total at full rollout: **≈ $85** (Android only, Cloudflare paid) or **≈ $184** with iPhones. The Supabase route discussed earlier would have been ≈ $425/year and was not chosen.

---

## 14. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Phone lost or broken | records since the last Drive backup | daily snapshots + Auto Backup (APK) + weekly Drive full backup; every project PDF is a copy; Phase 3 sync |
| Wrong data entry (typo in amount) | wrong cost totals | amount shown large before save; records editable with audit trail; owner reviews weekly; deletes are soft and reversible |
| Sinhala/Tamil quality (machine drafts) | confusion on site | native-speaker review before pilot ends; strings live in one file per language; easy to patch via EAS Update |
| Expo SDK upgrades break native modules | lost dev time | pin versions (`~58.x`), upgrade one SDK at a time with `npx expo install --fix` and `expo-doctor`; keep the emulator flow test |
| Google policy changes (developer verification 2027) | staff cannot install the APK | register the company developer account or a limited distribution account before 2027; Play internal track in Phase 4 |
| Windows local build problems | cannot build on this PC | EAS cloud builds; optionally enable Windows long paths (`LongPathsEnabled`) and rebuild in `D:\bm` |
| Free-tier caps (Phase 3) | sync blocked until midnight UTC | usage is ~5 % of caps; Workers Paid $5/month if ever needed |
| Solo developer (bus factor) | nobody to maintain | this plan, README, AGENTS.md, design-system docs, plain TypeScript, no custom native code; repo access shared with the owner |
| Photo storage fills the phone | app cannot save | ~250 KB per photo (≈ 4,000 photos per GB); storage warning planned; old projects can be exported to PDF and photos pruned (Phase 5) |
| Google Drive quota | weekly backup fails | 15 GB free covers > 1 year; Google One $2/month |

---

## 15. Handover checklist

- [ ] Repo access for the owner (GitHub collaborator) and a ZIP of `main` in the Drive folder.
- [ ] `docs/PLAN.md` (this), `README.md`, `AGENTS.md`, `design-system/bluemoon-site/MASTER.md` and `FLOWS.md` up to date.
- [ ] Latest APK link from EAS, and the Expo account login in the owner's password list.
- [ ] Google Drive folder `Bluemoon Site Backups` shared with the owner, containing at least one full backup and the restore-drill log.
- [ ] Accounts & passwords list (owner-held): Expo, GitHub, Google (backups), later Cloudflare, Play Console, Apple.
- [ ] D-U-N-S applied / received; Play organization account status; Apple status.
- [ ] Privacy page live at bluemoonengineering.lk/privacy.
- [ ] Sinhala/Tamil reviewed and merged.
- [ ] Training done: each user can record an expense, run Today's work & pay, issue a tool, and do a backup.
- [ ] Error log empty of unexplained entries for 14 days.
- [ ] Monthly restore drill scheduled in the owner's calendar.

---

## 16. Decision log

- **2026-10-21** — Build a mobile app (not web) for site management: project expenses with bill photos, worker wages/advances, tool issue/return, site notes, project cost summaries, Sinhala/English/Tamil; it records payments, it does not collect money. *Why:* the company's everyday site work, "mobile-first simplicity, no ERP screens".
- **2026-10-21** — Mobile app only; no owner web dashboard for now. *Why:* keep it simple; the owner uses the phone.
- **2026-10-21** — Users: 10–15 eventually, mostly Android with 1–3 iPhones; start with 2–3, all Android; no Play Store needed yet. *Why:* cost and speed.
- **2026-10-21** — No paid backend. Rejected Supabase Pro ($25/month), Firebase (storage needs a card plan), office PC (unreliable). Cloudflare free tier chosen for the future sync. *Why:* Rs 0 to start; never pauses.
- **2026-10-21** — Start as **one phone, $0**: SQLite on the phone, no server; project **PDF hand-off** (data embedded in the PDF) when a second phone joins. *Why:* exactly the owner's workflow — one person exports, another imports — with no internet.
- **2026-10-21** — Repo github.com/RizAhd/Bluemoon-Engineering-App; commits only under the developer's own name.
- **2026-10-22** — Keep testing in **Expo Go** (chosen over fixing the PC build or a cloud build) after local Gradle builds failed on Windows path limits. *Why:* fastest way to test today; APK later via EAS.
- **2026-10-22** — Blue & white theme; **daily automatic backup kept 25 days** with older ones deleted automatically; smoother UI.
- **2026-10-22** — The first blue theme was judged "not professional": full redesign (bright white light theme, true dark theme, typography/alignment/spacing by the frontend rules), complete testing before handover, built with multiple agents.
- **2026-10-22** — **Projects as a bottom tab**; **workers per project** with per-project rates; **"after work, payment today"** sheet; everything per project; **error/exception handling everywhere**; research-based, easy UX.
- **2026-10-22** — Write and keep this plan (`docs/PLAN.md`) covering frontend, backend and operations.
- **2026-10-23** — APKs are built by GitHub Actions on an `apk-*` tag (debug-signed), with the result pushed to the `ci-result` branch; the workflow file is not changed without the owner. *Why:* no local Android build on Windows, no Expo account needed.
- **2026-10-23** — Backups also go to a **folder on the phone** the owner picks and to the owner's **Google Drive** (real Google sign-in, `drive.file` scope, OAuth client in the owner's Google Cloud project). *Why:* data must survive a lost phone or an uninstall, at no cost.
- **2026-10-23** — Smoother motion and depth (Reanimated), splash fixed, all text 15 % smaller; every screen audited on the owner's phone before fixes.
- **2026-10-24** — Today becomes a **dashboard**: Day / Week / Month summary with earlier periods, per-project lines for "All projects", day rolls over at midnight. Settings gets **Text size** (Small / Medium / Large).
- **2026-10-24** — Audit process: test everything on the phone and list every issue first, fix them all, then build **one** APK and re-check. *Why:* the owner did not want a new version after every fix.
- **2026-10-24** — "Pay all" and "unpaid for today" never pay more than a worker is owed (advances count). *Why:* the audit found a Rs 2,000 overpayment.
- **2026-10-28** — Handover documentation for the next developer or agent: `docs/HANDOVER.md`, project rules in `AGENTS.md` (read by Claude Code through `CLAUDE.md`), phone-testing helper `scripts/device/phone.py`.

---

## Appendix A — Screen map

**Bottom tabs (left to right)**
| Tab | Route | Shows |
|---|---|---|
| Today | `(tabs)/index` | date, data-safety line, today's spend, workers today & wages paid today, tools out, cost vs contract, quick actions, recent activity — for the current project or all projects |
| Projects | `(tabs)/projects` | full project list with status filters and search, total cost and contract progress per row; New project |
| Expenses | `(tabs)/expenses` | expenses of the current project grouped by day; month and total tiles |
| Workers | `(tabs)/workers` | workers on the current project with balances; **Today's work & pay**; Add worker to project |
| Tools | `(tabs)/tools` | out on this project / in store (available) / out elsewhere |

**Header:** project switcher pill (choose project or "All projects", + New project) and a menu button → More. **FAB (+):** quick-add sheet → New expense, Today's work & pay, Record work, Give advance, Issue tool, New note, Import PDF.

**Stack screens**
| Route | Purpose |
|---|---|
| `project/[id]` | project hub: overview, by-category bars, contract bar, sections into Expenses/Workers/Tools/Notes, workers on this project, tools out here, documents, Export PDF (with/without photos), edit |
| `project/form` | create/edit project |
| `expense/form` | create/edit expense with photos |
| `worker/[id]` | worker detail: overall balance, per-project balances, history, record work / advance / pay, remove from project, mark left |
| `worker/form` | create/edit worker |
| `worker/assign` | add an existing or new worker to a project with the rate for that project |
| `wage/today` | **Today's work & pay** sheet: worked toggle, 0.5/1/1.5/2 days, amount, pay now; Save today |
| `wage/form` | single wage entry editor (project required) |
| `tool/[id]`, `tool/form`, `tool/move` | tool detail/history, create/edit, issue/return with photo |
| `notes`, `note/form` | site notes list and editor |
| `import` | Import a project PDF (preview what changes, then merge) or attach a foreign PDF |
| `backup` | daily automatic backups (list, restore, share), full backup with photos, restore from file |
| `more` | Backup, Import PDF, Site notes, Report a problem, Language, Appearance, About |
| `problem` | error log viewer: share / clear |
| `add` | the quick-add sheet |

---

## Appendix B — Key files

| File | Why it matters |
|---|---|
| `src/db/schema.ts` | tables, views, migrations (append-only), `DATA_TABLES` order |
| `src/db/index.ts` | `getDb`, `tx`, `save`, `remove`, `mergeRow`, `classifyRow`, `useQuery`, `useFirst`, settings, `deviceId` |
| `src/db/repo.ts` | validated writes: projects, expenses, workers, project_workers, wages (`recordWorkDay`, `payWages`), tools, notes, delete |
| `src/hooks/data.ts` | `useProjects`, `useCurrentProjectId`/`setCurrentProject`, `useProjectWorkers`, `useWageDay`, `useWorkerProjects`, attachments |
| `src/hooks/form.ts` | `useRecordForm` (ids, validation messages, toasts, orphan photos) |
| `src/lib/money.ts` · `dates.ts` | cents parsing/formatting; `today`, `addDays`, `isValidDay`, `daysSince` |
| `src/lib/files.ts` | photo compression, attachments folder, SHA-256, orphan cleanup |
| `src/lib/bundle.ts` | collect/plan/apply bundles (merge rules, file verification) |
| `src/lib/pdf.ts` | export report + embedded data; import and verify |
| `src/lib/backup.ts` · `autoBackup.ts` | full backup parts, data snapshots, prune, verify, background task |
| `src/lib/errors.ts` | error log, friendly messages, `guard`, global handlers |
| `src/components/ProjectSwitcher.tsx` | `TabHeader` with the project switcher and menu |
| `src/theme/tokens.ts` · `design-system/bluemoon-site/MASTER.md` | colours/spacing/type; the design rules |
| `src/i18n/en.ts` `si.ts` `ta.ts` | every string, typed |
| `plugins/withBackupRules.js` | Android Auto Backup include rules |
| `app.json` · `eas.json` | app id `lk.bluemoonengineering.site`, permissions text, share-target, build profiles |

---

## Appendix C — Glossary (as used in the app)

| English | Sinhala | Tamil |
|---|---|---|
| Project | ව්‍යාපෘතිය | திட்டம் |
| Client | සේවාදායකයා | வாடிக்கையாளர் |
| Contract value | කොන්ත්‍රාත් වටිනාකම | ஒப்பந்த மதிப்பு |
| Expense | වියදම | செலவு |
| Materials | ද්‍රව්‍ය | பொருட்கள் |
| Transport | ප්‍රවාහනය | போக்குவரத்து |
| Fuel | ඉන්ධන | எரிபொருள் |
| Machine hire | යන්ත්‍ර කුලී | இயந்திர வாடகை |
| Food & tea | කෑම සහ තේ | உணவு & தேநீர் |
| Sub-contract | උප කොන්ත්‍රාත් | துணை ஒப்பந்தம் |
| Water & power | ජලය සහ විදුලිය | நீர் & மின்சாரம் |
| Cash / Bank / Cheque | මුදල් / බැංකුව / චෙක්පත | பணம் / வங்கி / காசோலை |
| Worker | කම්කරුවා | தொழிலாளி |
| Mason, carpenter, helper | මේසන්, වඩුවා, සහායක | கொத்தனார், தச்சர், உதவியாளர் |
| Daily rate | දෛනික වැටුප | நாள் கூலி |
| Work (day) | වැඩ | வேலை |
| Advance | අත්තිකාරම් | முன்பணம் |
| Payment | ගෙවීම | செலுத்துகை |
| To pay / Advance over / Settled | ගෙවිය යුතු / අත්තිකාරම් වැඩිය / ගෙවා අවසන් | செலுத்த வேண்டியது / முன்பணம் அதிகம் / தீர்க்கப்பட்டது |
| Today's work & pay *(draft)* | අද වැඩ සහ ගෙවීම් | இன்றைய வேலை & கூலி |
| Tool | උපකරණය | கருவி |
| Issue / Return | නිකුත් කරන්න / ආපසු | வழங்கு / திரும்பப் பெறு |
| In store / Out | ගබඩාවේ / පිටත | களஞ்சியத்தில் / வெளியே |
| Site note | සයිට් සටහන | தளக் குறிப்பு |
| Backup / Restore | උපස්ථය / ප්‍රතිසාධනය | காப்புப்பிரதி / மீட்டமை |
| Saved on phone | දුරකථනයේ සුරැකුණා | தொலைபேசியில் சேமிக்கப்பட்டது |

Sinhala and Tamil terms are drafts until a native speaker on site has reviewed them (Phase 1 acceptance criterion).

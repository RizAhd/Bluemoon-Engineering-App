# Bluemoon Site — engineering handover

The current state of the app for the next developer or coding agent. Read this first; it is kept up to
date, while [PLAN.md](PLAN.md) holds the longer roadmap and design reasoning.

**Handover build:** `apk-14`, commit `fb57f24` (2026-10-24), installed and checked on the developer's
test phone (Xiaomi Redmi Note 10S, MIUI). Status: ready for the client.

---

## 1. Start here (5 minutes)

1. Read [../AGENTS.md](../AGENTS.md) for the rules (commits, CI workflow, phone testing).
2. Skim the code map in section 4 of this file.
3. Run `npm install`, then `npm run check` (tsc + eslint) and `npx jest` (≈15 min, see section 8).
4. To get an APK, push a tag (section 7). Local Android builds do not work on the Windows PC.
5. Before you change a screen, read [.claude/skills/bluemoon-mobile-ui/SKILL.md](../.claude/skills/bluemoon-mobile-ui/SKILL.md).

## 2. What the app is

An **offline-first** Android app (Expo / React Native) for **Bluemoon Engineering (Pvt) Ltd**, Welimada,
Sri Lanka. All data lives in SQLite on the phone; there is no server and no running cost. English,
Sinhala and Tamil; light and dark themes; a Text size setting (Small / Medium / Large).

| Area | What it does |
|---|---|
| Today (home) | **Summary** card with Day / Week / Month and ‹ › to earlier periods (expenses, labour earned, total; one line per project when "All projects" is chosen). Wages to pay, tools out, project cost, Today's work & pay, quick actions, recent activity. Moves to the new day at midnight. |
| Projects | List with status / cost / contract progress, filters, a hub per project, PDF export (optionally on the company letterhead and with photos embedded). |
| Workers | Per-project roster and daily rate. Worker file with earned / advances / paid / balance ("To pay" or "Paid ahead"). |
| Today's work & pay | Tick who worked (½–2 days), wages fill from the rate, pay now or Pay all (never more than the worker is owed — advances count). |
| Expenses | Amount-first form, 9 categories, bill photos, filters and sort. |
| Tools | Register, issue / return with worker, condition and photo proof. |
| Site notes | Daily note, weather, photos. |
| Estimates | Client quotations: items (qty × rate), discount / tax, payment schedule (standard 30/40/30), bank details, terms, PDF in any of the 3 languages, statuses (draft → sent → accepted → project). See [ESTIMATES.md](ESTIMATES.md). |
| Backup | Daily snapshot + phone folder + Google Drive + password-protected full backup (section 6). |
| Security | Optional App lock (PIN, fingerprint). Error log under Settings → Report a problem. |

## 3. Stack

| | Version |
|---|---|
| Expo SDK | 58 (`expo ~58.0.17`), Expo Router ~58 |
| React Native / React | 0.88 / 19.3 |
| Reanimated | 4.7 (CSS transitions + layout animations) |
| UI | Own components in `src/components/ui` (Tamagui only in a few places) |
| Database | `expo-sqlite` |
| Google sign-in | `@react-native-google-signin/google-signin` 16 (Drive REST v3 over `fetch`) |
| Tests | Jest 30 + jest-expo, React Native Testing Library |
| TypeScript | 6.0 |

Expo changes a lot between SDKs: check the versioned docs, not memory (see AGENTS.md).

## 4. Code map

```
src/app/                 screens (Expo Router). (tabs)/ = Today, Projects, Expenses, Workers, Tools
  wage/today.tsx         Today's work & pay sheet (own FlatList; scrolls the tapped row above the footer)
  wage/form.tsx          record work / give advance / pay wages (shows "To pay" / "Paid ahead")
  estimate/              hub, form, item, payment
  backup.tsx, more.tsx   Backup screen; Settings & more (language, appearance, text size, app lock)
src/components/
  ui/form.tsx            Field, AmountField, SelectField, DateField, Chips, Segmented, PickerSheet
  ui/focusChain.tsx      the keyboard Next key: moves to the field below on screen
  ui/layout.tsx          Screen (keyboard inset, sticky footer), Card, ListRow, ListCard
  ui/Txt.tsx             all text (type scale × Text size setting)
  PeriodSummary.tsx      the Day / Week / Month card on Today
  BackupPlaces.tsx       "Where copies are kept" rows (phone folder, Google Drive)
src/db/                  schema.ts (tables, views, migrations), repo.ts (the single write path), index.ts
src/hooks/               data.ts (queries), form.ts (useRecordForm, useLeaveGuard), today.ts (useToday),
                         search.ts (the search box at the top of every list: useListSearch, useSearchBox)
src/lib/                 money, dates (incl. week / month ranges), wages (unpaid for a day), backup,
                         autoBackup, phoneFolder, drive, pdf / estimatePdf / reportHtml, share*, errors,
                         keyboard (app-wide keyboard behaviour), letterheadData (embedded JPEG),
                         pdfShell (page frame + print / letterhead / write for the printable lists)
  lib/reports/           the PDF row of the Share sheets: worker statement (3 languages), expense list,
                         workers list, day sheet, tools register, site notes (pure html builders +
                         load.ts from the views + export.ts); src/hooks/pdfShare.ts hands the file over
src/i18n/                en.ts (the key list), si.ts, ta.ts — every key in all three
src/theme/               tokens (colours, type scale, spacing, elevation), hooks (useColors, useTextScale…)
plugins/                 Expo config plugins (section 9)
scripts/                 embed-letterhead.py, device/phone.py (phone testing)
```

## 5. Data rules

- Money is stored as **integer cents**; days as local `yyyy-mm-dd` strings (`src/lib/dates.ts`).
- Every write goes through `src/db/repo.ts` inside a transaction and is recorded in `audit_log`.
- Nothing is hard-deleted: rows get `deleted_at` (soft delete). Restore and PDF import **merge**, never delete.
- Tables: `projects`, `expenses`, `workers`, `project_workers`, `wage_entries` (kind `work` / `advance` /
  `payment`), `tools`, `tool_movements`, `site_notes`, `attachments`, `estimates`, `estimate_items`,
  `estimate_payments`, `settings`, `audit_log`. Balances come from views (`v_project_cost`,
  `v_worker_balance`, `v_project_worker_balance`, `v_wage_day`, `v_tool_status`).
- A worker's balance = work − advances − payments. "Unpaid for today's work" is capped at what the worker is
  owed on the project (`src/lib/wages.ts`), so an advance is never paid twice.
- User preferences live in `settings` (e.g. `theme`, `lang`, `text_size`, `current_project`,
  `backup_folder_uri`, `drive_email`, `auto_backup_at`, list filters `list_*`).

## 6. Backups (the most important feature)

| Layer | When | Where | Kept |
|---|---|---|---|
| Daily snapshot (records only) | On app open, on return to the app, background task; redone the same day when records change | App storage | 25 days (`KEEP_DAYS`) |
| Phone folder copy | Right after each snapshot, and on Backup → Run now | Folder the owner picks once (Android folder picker, SAF); survives uninstall | 30 (`FOLDER_KEEP`) |
| Google Drive copy | Same, when online | "Bluemoon Site Backups" folder in the owner's Drive (`drive.file` scope: the app sees only its own files) | 30 (`DRIVE_KEEP`) |
| Full backup with photos | Backup → Back up now (by hand, weekly) | Phone folder + Drive, or the share sheet if neither is set up; optional password (encrypted) | Not deleted by the app |
| Android Auto Backup | By Android, about daily | Owner's Google account | Android's rules (`plugins/withBackupRules.js`) |

Full backups split into parts of at most ~40 MB; each part restores on its own. Restore asks first and merges.

### Google Drive sign-in setup (one time, in Google Cloud)

Drive sign-in only works for an app registered in the owner's Google Cloud project:
- Android OAuth client with package `lk.bluemoonengineering.site` and the signing key's SHA-1
  `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25` (the CI debug key).
- Drive API enabled; OAuth consent screen. While it is in **Testing**, only Gmail addresses listed under
  *Audience → Test users* can connect. **Publish app** lifts that (no Google review needed for `drive.file`).
- A build signed with a different key needs that key's SHA-1 added as another Android client.
- Not set up → Connect shows "not set up yet" (Google's DEVELOPER_ERROR, code 10).
- The google-signin config plugin is deliberately **not** in `app.json`: Android needs nothing from it (add it
  with `iosUrlScheme` only for an iOS build).

## 7. Building an APK

**Do not edit `.github/workflows/android-apk.yml`** unless the owner asks; it is the only working build route.

1. Commit and push to `main`.
2. Push a tag: `git tag apk-15 && git push origin apk-15` (next free number; `git tag | grep apk`).
3. GitHub Actions builds a release APK (≈15 min). It uploads the artifact **and** pushes the result to the
   `ci-result` branch: `status.txt` (job result, commit, run URL) and `Bluemoon-Site-<date>-<commit>.apk`.
4. Fetch without opening GitHub:
   ```bash
   git fetch origin ci-result
   git show origin/ci-result:status.txt          # check the commit line matches your commit
   git show "origin/ci-result:Bluemoon-Site-<date>-<commit>.apk" > ../Bluemoon-Site-test.apk
   ```
5. Install: `adb install -r ../Bluemoon-Site-test.apk` (keeps the app's data).

The APK is signed with the standard **debug key** (SHA-1 above). Switching to a release key later means
Android refuses to install over the old app: the phone must uninstall first, which **deletes its data**. Take a
full backup first, then restore after installing. Local Gradle builds on the Windows PC fail on the
260-character path limit; EAS (`npm run build:apk`) is the other option.

## 8. Tests and checks

```bash
npm run check        # tsc --noEmit && eslint src   (must be clean)
npx jest             # 74 suites, ~2,855 tests, ~15 minutes
npx jest path/to/file.test.tsx -t "name"   # one file / one test
```

- `src/__tests__/screens/` render real screens against a real SQLite (Node's `node:sqlite`, see
  `src/test-utils/sqliteShim.ts`) with mocked
  native modules (`src/test-utils/rnMocks.ts`, `screenKit.ts`). `src/lib/__tests__/` are pure unit tests.
- **Known flake:** under a full run, one or two screen tests (a different one each time, usually ones that open a
  sheet or picker) time out. They pass when their file is run alone. Always rerun the failing file before
  treating a failure as real.
- `usePreventRemove` is mocked, so the "Discard changes?" guard can only be checked on a phone.
- Unit tests cover money, dates and periods, wages, backup / restore / encryption, PDF and share text, Drive and
  phone-folder logic, estimates.

### Testing on a real phone

`scripts/device/phone.py` (adb + uiautomator): list what is on screen, tap by label, type, screenshot. It refuses
input unless Bluemoon is in front. Things learned the hard way:
- Use the **on-screen keyboard's Next key** to test Next; `key 66` (injected Enter) bypasses the keyboard and
  does not reproduce what users see.
- MIUI remembers the last share target, so the share sheet may jump straight to Print preview.
- A swipe from the top opens the notification shade; a locked screen shows as `NotificationShade` in front.
- If you change display size or font scale to test (`wm density`, `settings put system font_scale`), put the
  phone's own values back afterwards.
- Never use the owner's personal photos as test attachments.
- The web build is not supported (SQLite, secure store, file system and Google sign-in are native only).

## 9. Native config plugins (`plugins/`)

| Plugin | Why |
|---|---|
| `withBackupRules` | Android Auto Backup include / exclude rules |
| `withDialogTheme` | App-coloured native alerts and date picker (blue header with **white** text; MIUI drew it navy) |
| `withConfigChanges` | Changing display size / font scale must not recreate the activity (it crashed Expo Router) |
| `withSharingFix` | Patches `expo-sharing` at prebuild: a share whose result never came back no longer blocks every later share ("Another share request is being processed") |

## 10. Conventions that matter

- Every user-facing string goes in `src/i18n/en.ts` **and** `si.ts` and `ta.ts` (the `Dict` type makes
  `tsc` fail on a missing key; `i18n.test.ts` checks the screens).
- Text: always `Txt`. It never sends an undefined `fontVariant` (that crashed React Native with
  "Cannot read property 'split' of null").
- Forms: `useRecordForm` + `form.useLeaveGuard([...values])` gives "Discard changes?" on Back. Mark intentional
  leaves (`saved.current = true` / `allowLeave()`) before `router.back()`.
- Amounts: `AmountField` (groups thousands as typed; adding commas is not counted as an edit).
- Search: every list has a compact `SearchField` as the first thing in its header, always shown (no "from N rows"
  rule). Short lists use `useListSearch(rows, fields)` from `src/hooks/search.ts`; the paged / server-filtered ones
  (Expenses, Workers) pass `q` to the query instead (`ExpenseFilter.q`, `useWorkerList`) built with `likeQuery`.
  Both follow one rule (`matchesQuery`, `src/lib/search.ts`): every typed word must be in some field, in any order;
  digits match amounts with commas ignored. A search that finds nothing shows `NoResults` ("No results for …" + Clear).
  The text is plain state, never remembered.
- Keyboard: fields inside `Screen` join the Next chain automatically (`focusChain.tsx`); `src/lib/keyboard.ts`
  closes the keyboard before every Alert and blurs a field when the keyboard is put away.
- Errors: wrap risky actions in `guard()` / `showError()` from `src/lib/errors.ts`; they log to the in-app error log.
- Commits: author **Riflan Mohamed** only, no AI co-author lines (see AGENTS.md).

## 11. Audit history (live phone audits, 23–24 Oct 2026)

Each round: test every screen on the phone, list every issue, fix all of them, run the checks, build once,
re-check on the phone.

| # | Problem found | Fix | Checked on phone |
|---|---|---|---|
| — | Second share after a cancelled share failed | `withSharingFix` plugin | yes (apk-10) |
| — | Letterhead missing from PDFs in release builds | letterhead embedded as base64 (`letterheadData.ts`) | yes |
| — | Changing display size / font scale crashed navigation | `withConfigChanges` plugin | yes |
| A2 | Edit forms left without "Discard changes?" | `saved` no longer starts true for existing records | yes |
| A3/A4/A9 | Next lost focus when the keypad type changed | `keyboard.ts` only blurs the field that had focus | yes |
| A6 | Today's work & pay left with an unsaved Pay now amount | leave guard on the sheet | yes |
| A7 | Pay all / "unpaid today" ignored advances (overpaid by Rs 2,000) | `unpaidForDay` caps by the project balance (Today, Workers, sheet) | yes |
| A10 | Date picker header text dark on blue | white header text appearance | yes |
| A11 | Dashboard request: Day / Week / Month with history | `PeriodSummary` | yes |
| A12 | Today kept yesterday's date if left open overnight | `useToday` (midnight timer + app resume) | code |
| A13 | Project PDF "By category" left out wages | wages row added | yes |
| A14 | "Expenses" tab label cut at the largest display size | label shrinks to fit | yes |
| A15 | Text size request | Settings → Text size | yes |
| A16 | Header logo stayed navy in dark mode | image keyed by theme + white tint | yes |
| A17 | Crash while the owner was using the app ("split of null") | `Txt` never sends undefined `fontVariant` | yes (log empty since) |
| A18 | "Pay all · Rs 100" when nothing was owed | says "Pay Rs 100" | yes |
| A19 | Schedule buttons still shown at 100 % | hidden when fully scheduled | yes |
| A20/B1 | Next into a number field did not open the keypad | focus chain refocuses on a letters → numbers move | yes (keyboard Next key) |
| B2 | "Discard changes?" on an untouched form | adding commas to an amount is not an edit | yes |
| B3 | Field being typed hidden under the wage sheet footer | the row scrolls above the footer | yes |
| B4 | Backup → Run now did not copy to the folder / Drive | Run now also mirrors | yes |
| B5 | Pay wages / Give advance gave no idea what is owed | "To pay Rs …" / "Paid ahead Rs …" hint | yes |
| B6 | Unlabelled days box on Record work | "Or type the number of days" | code |

Also checked with no problems in the final round: add / edit / delete for expenses, notes, workers, advances,
estimates, projects; filters; tool issue and return; share sheets; PIN setup; restore picker; company details;
Tamil and Sinhala; light and dark.

## 12. Open items

**Before the client uses it**
- Settings → Company and bank details: bank name and account number are empty (estimates print without them).
- The developer's test phone holds test records (workers Loki and Sunil Perera, notes "Zzz", "Slab poured",
  expenses Nizam / Lanka Hardware, project Perera House). Delete them, or install fresh on the client's phone.
- Google Cloud: add the client's Gmail as a test user, or Publish the app, or their Drive sign-in fails.
- On the client's phone: set the App lock PIN, pick the backup folder, connect Google Drive, run a backup.

**Later**
- Native-speaker review of the Sinhala and Tamil text (machine drafts).
- Decide on a release signing key before the app is installed on many phones (see section 7).
- Make the occasional full-run test timeouts go away (longer `waitFor` timeouts in sheet tests, or `--maxWorkers`).
- Ideas the owner may like: a first-run guide; a weekly "pay everyone's balance" sheet; a daily WhatsApp summary
  from the dashboard numbers; reminders for unpaid estimate stages; an iOS build (needs the google-signin
  plugin with `iosUrlScheme`).

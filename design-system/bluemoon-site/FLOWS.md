# Bluemoon Site — information architecture and key flows (FLOWS)

Companion to MASTER.md (which defines every component named here). Each flow is a top-to-bottom layout with the exact interactions, data hooks and i18n keys to use. Hooks named here come from `src/hooks/data.ts` and `src/db` as described in the data contract; keys come from `src/i18n/en.ts` plus the new-key list. `pid` always means `useCurrentProjectId()` (null = "All projects"). `td` = `today()`.

## 0. Information architecture

**Bottom tabs** (`src/app/(tabs)/_layout.tsx`), in order: `index` Today (`Sun`, `tabToday`) · `projects` (`Building2`, `tabProjects`) · `expenses` (`Receipt`, `tabExpenses`) · `workers` (`HardHat`, `tabWorkers`) · `tools` (`Hammer`, `tabTools`). The old More tab is gone; `(tabs)/more.tsx` moves to `src/app/more.tsx`.

**Stack screens** (`src/app/_layout.tsx`, default `slide_from_right`): `add` (transparent modal, fade) · `more` (`settingsAndMore`) · `project/form` (`project`) · `project/[id]` (title set in-screen to the project name) · `expense/form` (`expense`) · `worker/form` (`worker`) · `worker/[id]` (name) · `worker/assign` (`addWorkerToProject`) · `wage/form` (`wages`) · `wage/today` (`todaysWork`, `animation: 'slide_from_bottom'`) · `tool/form`, `tool/[id]`, `tool/move` (`tool`) · `note/form`, `notes` (`siteNotes`) · `import` (`importPdf`) · `backup` (`backup`) · `problem` (`reportProblem`). The old `src/app/projects.tsx` is deleted (it becomes the tab).

**Header rule.** Every tab screen uses `TabHeader` (white; title; optional subtitle; project pill unless `showProject={false}`; right slot = optional screen action + the **menu button** `Menu` 24, label `menu`, which pushes `/more`). Every stack screen uses the native white header; `Screen` draws the hairline. Forms: Save lives in the sticky footer; Delete is a header-right `IconButton` `Trash2` in `danger` (44) that calls `form.confirmDelete(...)`; nothing else sits in a form header.

**Current-project rule.** The pill (`setCurrentProject`) is the single source of truth. Every tab except Projects is scoped by `pid`; every form defaults its project select to `pid`; a form never saves with a null project — the select is required and `errProject` shows inline. Screens that cannot work without a project (work & pay) show the **project chooser state**: `EmptyState icon={Building2} title={t('noProjectSelected')} hint={t('chooseProjectFirstHint')}` with a primary button `chooseProject` that opens `PickerSheet` (allowAll = false) → `setCurrentProject(id)`.

**FAB** (global, in the tabs layout): on `/projects` label `newProject` → `/project/form`; on every other tab label `quickAdd` → `/add`. Hidden while the keyboard is open.

**Delete / soft-delete** everywhere: native `Alert(confirmDelete, confirmDeleteBody)`, then `deleteRecord(...)`, toast `deleted`.

## 1. Today — `(tabs)/index.tsx`

Hooks: `useProjects()`, `pid`, `useFirst` for spent today (as now, scoped), `useProjectWorkers(pid)` (balances) or `v_worker_balance` when pid is null, `useWageDay(pid, td)`, `useQuery<ProjectCost>` (as now), the recent-activity union (as now), backup settings (as now).

**With a chosen project**, top to bottom:
1. `TabHeader title={t(greetingKey())} subtitle={formatDay(td)}` + pill. Right slot: menu only.
2. Backup line: `autoError && !autoToday` → tone card `dangerSoft` (`AlertTriangle`, `autoBackupFailed`, primary `runNow` → `/backup`); `photosStale` → tone card `warningSoft` (`CloudOff`, `photosOverdue {days}` or `fullBackup: never`, secondary `backupNow`); else a quiet 44-tall caption row `ShieldCheck` 18 `success` + `dataSafe · HH:MM` that opens `/backup`. Nothing when none applies.
3. Two `Stat` tiles: `spentToday` (value `formatLKR`, → Expenses tab) · `wagesToPay` (sum of positive `balance_cents` from `useProjectWorkers(pid)`; tone `danger` when > 0; → Workers tab).
4. Total-cost `Card`: eyebrow `totalCost`; `Txt variant="amount"` numeric (expense + labour of this project); `ContractBar` when `contract_cents`; `Badge warning` `{n} toolsOut` on the eyebrow row when tools are out here; 1 dp `divider`; compact ghost `costSummary` → `/project/${pid}`.
5. Work & pay entry `Card` (tappable, → `/wage/today`): `ListRow`-style content with `ClipboardCheck` in a `primary`/`primarySoft` slot, title `todaysWork`, subtitle from `useWageDay`: `${worked} ${t('worked')} · ${t('toPayToday')} ${formatLKR(toPay)}` where worked = rows with `days != null`, toPay = Σ max(0, work − paid); trailing `ChevronRight`. When no roster yet (`useProjectWorkers(pid).length === 0`) the subtitle is `noWorkersOnProject` and the row opens `/worker/assign`.
6. `SectionTitle recent` → one `ListCard inset` of up to 8 `ActivityRow`s (icons neutral; amounts right; expense → `/expense/form?id`, wage → `/worker/[id]`, tool → `/tool/[id]`, note → `/note/form?id`). Empty: `EmptyState compact icon={Receipt} title={t('noExpenses')} hint={t('noExpensesHint')}` (no button; the FAB is the action).
Scroll `paddingBottom 96`.

**With "All projects"** (pid null): same header with the pill reading `allProjects`; tiles across all projects (`wagesToPay` from `v_worker_balance`); total-cost card sums non-completed projects, shows the caption `${cost.length} ${t('projects')}` instead of a contract bar, and its ghost button is `projects` → Projects tab; the work & pay card shows title `todaysWork`, subtitle `noProjectSelected`, and tapping it opens the project chooser `PickerSheet` (allowAll false) then `/wage/today`; recent rows carry the project name in the subtitle.

**No projects at all**: header without pill; `EmptyState icon={Building2} noProjects / noProjectsHint` + primary `newProject` → `/project/form` (the FAB is hidden on this state).

## 2. Projects tab — `(tabs)/projects.tsx`

Hooks: `useQuery<ProjectCost & { location, client }>` (join projects; order active, on_hold, completed, then name), `pid`.
1. `TabHeader title={t('projects')} showProject={false}` (this tab *is* the list). Right: menu.
2. `SearchField` (placeholder `search`), shown when there are more than 5 projects; filters by name/client/location, case-insensitive.
3. Filter `Chips`: `all` · `status_active n` · `status_on_hold n` · `status_completed n` (counts in the label; a zero-count chip is disabled). Default `all`.
4. List. With `all`: one group per status that has rows — group label eyebrow `status_* (n)` with the group's total cost right-aligned — each a `ListCard inset`. With a status filter: one `ListCard`. Row: icon slot `Building2` (the current project's slot is `primarySoft` with the icon in `primary`, `accessibilityLabel` adds `thisProject`); title name; subtitle `client · location`; value total cost (`expense_cents + labour_cents`). Tap → `/project/[id]` (does **not** change the current project; the hub's actions do).
5. FAB `newProject`. Search with no match: `EmptyState icon={Search} title={`0 ${t('projects')}`} hint={`"${q}"`}` without a button. No projects: `noProjects / noProjectsHint` + primary `newProject` (FAB hidden).

## 3. Project hub — `project/[id].tsx`

Hooks: `useProject(id)`, `v_project_cost` first row, category totals (as now), `useProjectWorkers(id)`, tools out here: `SELECT s.*, w.name AS worker_name FROM v_tool_status s LEFT JOIN workers w ON w.id = s.worker_id WHERE s.is_out = 1 AND s.project_id = ?`, note count, attachment count for `projects`.
Header: title = project name; right `Pencil` (`editProject` → `/project/form?id`).
1. Status line: `Badge` (`status_*`: success / warning / slate) + caption `client · location`; when `pid !== id` a compact ghost `Star` `setCurrent` (→ `setCurrentProject(id)`; toast with the project name).
2. `SectionTitle overview`. Cost `Card`: eyebrow `totalCost`; `amountXl` numeric; `ContractBar`; caption `balanceToContract: Rs …` (`danger` when negative).
3. Tiles: `materialsAndOther` (→ `setCurrentProject(id)` + Expenses tab) · `labour` (→ `setCurrentProject(id)` + Workers tab); full-width `Stat labourPaid`.
4. `SectionTitle projectWorkers` with the count, action ghost compact `UserPlus` `add` → `/worker/assign?projectId=${id}`. `ListCard inset`: up to 5 rows from `useProjectWorkers(id)` (avatar, name, subtitle `trade · ${formatLKR(rate_cents)} / ${t('day')}`, value |balance| + badge `weOwe` / `workerOwes` / `settled`; tap → `/worker/[id]`); 6th row `seeAll` → `setCurrentProject(id)` + Workers tab. Empty: `EmptyState compact icon={HardHat} noWorkersOnProject / noWorkersOnProjectHint` + compact `addWorkerToProject`.
5. `SectionTitle outHere` with the count (hidden when 0). `ListCard inset` of up to 5 tools: `Hammer` slot tone `warning`, title name · code, subtitle `${t('outWith')} ${worker_name ?? taken_by} · ${formatDay(last_day)}`; `seeAll` row → `setCurrentProject(id)` + Tools tab.
6. `ListCard`: one row `siteNotes (n)` (`NotebookPen`, → `/notes?projectId=${id}`); when n = 0 the subtitle is `noNotes` and the row still opens the notes screen, which has its own empty state.
7. `byCategory` card with `CategoryBars` (when any expense).
8. `SectionTitle exportPdf`: card with `exportPdfHint`, `includePhotos` switch row, primary `exportPdf` (loading label `exporting`). Failure → `showError`.
9. `SectionTitle documents` → `PhotoStrip ownerTable="projects"` label `projectDocs`.

## 4. Workers tab — `(tabs)/workers.tsx`

**Per current project** (pid set). Hooks: `useProjectWorkers(pid)`, `useWageDay(pid, td)`.
1. `TabHeader title={t('workers')}` + pill; right: `UserPlus` (`addWorkerToProject` → `/worker/assign?projectId=${pid}`) + menu.
2. Work & pay entry card (same spec as Today §1.5).
3. Tiles: `weOwe` (Σ max(0, balance) — tone `danger` when > 0) · `workerOwes` (Σ max(0, −balance)).
4. Group label `projectWorkers (n)`. `ListCard inset`: active rows (avatar initials; name; subtitle `trade · ${formatLKR(rate_cents)} / ${t('day')}`; value |balance| with badge `weOwe` danger / `workerOwes` warning / `settled` success; tap → `/worker/[id]`). Then, if any, group label `inactive (n)` and a second `ListCard` with muted titles + `inactive` badge.
5. Empty roster: `EmptyState icon={HardHat} noWorkersOnProject / noWorkersOnProjectHint` + primary `addWorkerToProject`. Scroll `paddingBottom 96`.

**"All projects"** (pid null): header pill `allProjects`; right: `UserPlus` (`newWorker` → `/worker/form`) + menu; a caption row `balanceAllProjects`; the work & pay card in chooser mode (§1); tiles from `v_worker_balance`; group label `allWorkers (n)`; rows from `v_worker_balance` with subtitle `trade · Rs daily_rate / day` (the default rate). Empty: `noWorkers / noWorkersHint` + primary `newWorker`.

## 5. Add worker to project — `worker/assign.tsx`

Params: `projectId` (required; falls back to `pid`; when both null → project chooser state), optional `workerId` (edit mode).
Hooks: `useProject(projectId)`, `useWorkers(true)`, `useProjectWorkers(projectId)`; `useRecordForm('project_workers')`.
Header title `addWorkerToProject`; subtitle line inside the body: caption `${t('project')}: ${project.name}`.
1. `Segmented`: `existingWorker` · `newWorker` (hidden in edit mode).
2. Existing: `SelectField label={t('worker')}` listing active workers; a worker already on the project appears with subtitle `alreadyOnProject` and is skipped when picked (the sheet shows its `Check` but `onPick` is ignored, and a toast `alreadyOnProject` appears). When every worker is assigned the select is replaced by a caption `noneAvailable` and the segment flips to New. Picking a worker prefills the rate from `daily_rate_cents`.
3. New: `Field name` (autoFocus) · `Field trade optional hint tradeHint` · `Field phone optional phone-pad`.
4. `AmountField label={t('rateOnThisProject')}` (required; `rateRequired` when empty or 0; `errAmount` when unparsable). Hint under it: `perProject` → "Per project" caption explaining the rate applies here only.
5. Footer primary `save`: existing → `assignWorker({ project_id, worker_id, rate_cents })`; new → `saveWorker({...})` then `assignWorker` with the returned id; both inside `form.submit` (toast `savedOnPhone`, back).
Edit mode (`workerId` given): worker shown as a read-only `ListRow` (name, trade); rate field prefilled with the project rate; Save → `setProjectWorkerRate`; a danger outline button `removeFromProject` under the field → `Alert(removeFromProject, removeFromProjectBody)` → `unassignWorker(project_id, worker_id)`, toast `deleted`, back.

## 6. Worker detail — `worker/[id].tsx`

Hooks: `useFirst<Worker>`, `v_worker_balance` row, `useWorkerProjects(id)`, entries with project name (as now).
Header: name; right `Pencil` (`editWorker`).
1. Balance `Card` (tone `dangerSoft` / `warningSoft` / `successSoft`): eyebrow `balanceAllProjects`; `amount` 30/700 numeric in tone; `Badge` `weOwe` / `workerOwes` / `settled`; caption `trade · dailyRate Rs …`; compact ghost `Phone` with the number (`tel:`) when present.
2. Three tiles: `earned` · `advances` · `paid`.
3. Actions: primary `recordWork` → `/wage/form?workerId&kind=work`; row of two secondary: `giveAdvance`, `payWages` (`&amount=` balance when > 0).
4. `SectionTitle perProject`. `ListCard` of `useWorkerProjects(id)`: title `project_name`; subtitle `${formatLKR(rate_cents)} / ${t('day')} · ${t('daysCount', { n: days_total })}`; value |balance| + badge; tap → `/worker/assign?projectId=${project_id}&workerId=${id}` (edit rate / remove). When the worker is on no project the whole section is hidden (assignment starts from the Workers tab).
5. `SectionTitle history`: `ListCard inset` rows as now (icons `CalendarCheck` / `HandCoins` / `Banknote`, neutral slots; work values `+Rs`, others `−Rs` in `textMuted`; subtitle `day · project · note`); tap → `Alert` with `edit` (→ `/wage/form?id`) and `delete`. Empty: caption `recordWork · giveAdvance · payWages`.
6. Ghost `markInactive` / `markActive`; `inactive` badge when inactive.

**`wage/form.tsx` changes**: the project `SelectField` is required (no `allowNone`, placeholder `chooseProject`, default `pid`); the worker list prefers `useProjectWorkers(projectId)` (falls back to `useWorkers(true)` when the project has no roster); for `kind === 'work'` the auto amount uses the project rate (`rate_cents` from `useProjectWorkers`) and falls back to `daily_rate_cents`; the days `Chips` show ½ · 1 · 1½ · 2 numeric labels with accessibility labels `halfDay` … `twoDays`, plus the free `Field days`.

## 7. Today's work & pay — `wage/today.tsx`

Follows the researcher's recommended design. One screen handles today, yesterday, partial pay and re-opening. Work marks save immediately; **money moves only on an explicit tap**.

Params: `?day=YYYY-MM-DD` (default `td`). State: `day`; draft pay amounts `Map<worker_id, string>` (prefilled from the database, not persisted). Hooks: `pid` (null → project chooser state, §0), `useProject(pid)`, `roster = useProjectWorkers(pid)` (active rows, plus any inactive row that already has an entry this day), `dayRows = useWageDay(pid, day)` indexed by `worker_id`. Derived per worker: `worked = row?.days != null`, `wage = row?.work_cents ?? 0`, `paid = row?.paid_cents ?? 0`, `remaining = max(0, wage − paid)`.

Layout:
1. Header title `todaysWork`. Body top: `ProjectPill` (allowAll false, changes `pid`) and `DateField label={t('date')} maxDay={td}` (Today / Yesterday / calendar; `DateField` gains a `maxDay` prop that caps the native picker — no future days). When `dayRows` already existed when the screen opened for this day: caption row `Info` 18 + `dayAlreadyRecorded` (`textMuted`).
2. Summary `Card` (3 columns, eyebrow + title 20/700 numeric): `workersToday` → `${n} · ${t('daysCount', { n: Σ days })}` · `toPayToday` → Σ remaining (`danger` when > 0) · `wagesPaidToday` → Σ paid. Updates live.
3. Quick action (only when no row is worked yet and the roster is non-empty): compact secondary `markAllWorked` → `recordWorkDay({ project_id, worker_id, day, days: 1 })` for every active worker with `rate_cents > 0`; a worker with rate 0 is skipped and the toast says `rateRequired`.
4. Roster `ListCard` (no inset dividers; rows are the sheet's core, stable order: active first, then name):
   - **Not worked** (56): `Checkbox` unchecked · name 16/600 · caption `trade · ${formatLKR(rate_cents)} / ${t('day')}` plus `· ${t('weOwe')} Rs x` when the project balance > 0 · trailing caption `notWorked` in `textMuted`. **One tap anywhere on the row** = worked 1 day: `recordWorkDay({ project_id, worker_id, day, days: 1 })` (amount defaults to the project rate); the row expands and the pay draft is set to `remaining`. Rate 0: the caption shows `rateRequired` in `warning` and tapping opens `/worker/assign?projectId&workerId` instead.
   - **Worked** (expanded): line 1 = `Checkbox` checked · name · trailing wage `formatLKR(wage)` 16/600 numeric with badge `paid` (success, paid ≥ wage) / `paidToday` + amount (warning, 0 < paid < wage) / none. Line 2 = caption `days` + `Segmented` ½ · 1 · 1½ · 2 (labels `halfDay`, `fullDay`, `oneAndHalf`, `twoDays`) → `recordWorkDay` with the new `days` (one entry per worker/day; the amount is recomputed from the rate). Line 3 (when `remaining > 0`): caption `payNow` · compact `AmountField` prefilled with `remaining` · compact secondary `payNow` → `payWages({ project_id, worker_id, day, amount_cents })` → the row shows `paidToday Rs …` and the draft clears. Helper under the field when the typed amount > remaining: caption `warning` `payMore` (allowed, never blocking; the excess settles older balance). When `remaining === 0` and `paid > 0`: line 3 = `CheckCircle2` 18 `success` + caption `paidToday · Rs …`.
   - **Untick** (tap the checked row's checkbox): `removeWorkDay(project_id, worker_id, day)`; toast `deleted` with action `undo` → `recordWorkDay` with the same `days`. If `paid > 0` for that worker that day, confirm first with `Alert(confirmDelete, confirmDeleteBody)`; the payment entry stays.
   - Last row: `ListRow icon={UserPlus} title={t('addWorkerToProject')}` → `/worker/assign?projectId=${pid}`; the new worker appears unticked on return.
5. Sticky footer (`Screen footer`): caption line `${n} ${t('worked')} · ${t('wagesPaidToday')} ${formatLKR(Σ paid)}`; when Σ draft > 0: primary `${t('payAll')} · ${formatLKR(Σ draft)}` → `Alert(payAll, "Kamal — Rs 7,000\nNimal — Rs 4,500…")` with `cancel` / `payAll` → `payWages` per row in order (a failure stops the loop; already-written payments show as paid when the screen re-reads, so Retry only pays the rest) → toast `sheetSaved` → `router.back()`; plus a ghost compact `saveSheet` ("Save today" = done without paying; work stays recorded; toast `sheetSaved`, back). When Σ draft = 0: caption `nothingToPay` and a single primary `saveSheet`.
6. Empty roster: `EmptyState icon={HardHat} noWorkersOnProject / noWorkersOnProjectHint` + primary `addWorkerToProject`. Back gesture never asks to confirm — everything shown is already saved except untouched pay drafts.

## 8. Expenses — `(tabs)/expenses.tsx` and `expense/form.tsx`

**Tab.** Hooks as now (scoped by `pid`), `useAttachmentCounts('expenses')`.
1. `TabHeader title={t('expenses')}` + pill; right: menu.
2. Tiles `thisMonth` · `totalCost` (`all` when pid null).
3. `SectionList` grouped by day: group label eyebrow `today` / `yesterday` / `formatDay(day)` with the day total right; one `ListCard inset` per day; row: `Receipt` slot (neutral), title `paid_to || cat_*`, subtitle `cat_* · project_name (only when pid null) · method_*`, badge `Camera` + count when photos, value `formatLKR(amount)`; tap → `/expense/form?id`.
4. Empty: `EmptyState icon={Receipt} noExpenses / noExpensesHint` + primary `newExpense` (`/expense/form`). FAB `quickAdd`.

**Form** (`newExpense` / `editExpense`; header-right `Trash2` on edit). Order: `AmountField amount` (autoFocus on new) → `Chips category` (`cat_*`) → `PhotoStrip receiptPhotos` → `DateField date` → `SelectField project` (required, default `pid`, placeholder `chooseProject`, error `errProject`) → `Field paidTo optional hint paidToHint` → `Chips method` (`method_*`) → `Field note optional multiline`. Footer: single primary `save` → `form.submit(saveExpense)`; on `ValidationError` the field shows the error and the ScrollView scrolls to it; on any other error see §12.

## 9. Tools — `(tabs)/tools.tsx`

Hooks: `v_tool_status` joined with workers/projects (as now).
1. `TabHeader title={t('tools')}` + pill (allowAll); right: `Plus` (`newTool` → `/tool/form`) + menu.
2. Filter `Chips` with counts: `all` · `out n` · `inStore n` (zero disabled).
3. Groups (each an eyebrow label + `ListCard inset`): with a project chosen: `outHere (n)` (out AND `project_id = pid`) · `availableToIssue (n)` (in store) · `otherProjects (n)` (out elsewhere, titles `textMuted`); with "All projects": `out (n)` · `inStore (n)`. Row: `Hammer` slot `warning` tone when out, neutral when in store; title `name · code`; subtitle when out `${t('outWith')} ${worker_name ?? taken_by} · ${project_name} · ${formatDay(last_day)}`; badge `out` warning / `inStore` success; tap → `/tool/[id]`. Coloured borders are gone.
4. Empty: `EmptyState icon={Hammer} noTools / noToolsHint` + primary `newTool`. FAB `quickAdd` (quick-add has `issueTool`).

## 10. More — `more.tsx` · Report a problem — `problem.tsx`

**More** (stack, title `settingsAndMore`): `ListCard inset`: `siteNotes` (`NotebookPen`, → `/notes`) · `importPdf` (`FileDown`, subtitle `importPdfHint`) · `backup` (`ShieldCheck`, slot tone success/warning by `auto_backup_at`, subtitle `autoBackupLast: …`) · `reportProblem` (`Bug`, → `/problem`). `SectionTitle language` → `Chips` of `LANG_NAMES`. `SectionTitle appearance` → `Chips theme_system / theme_light / theme_dark`. Caption footer: company · `version` · device id (`numeric`).

**Problem** (stack, title `reportProblem`): 1. `Card`: eyebrow `errorLog`, caption `appCrashedBody`, caption `${n} ${t('records')}`. 2. List = `readErrorLog()` parsed per line, newest first, each a `ListRow` (title `context`, subtitle `message` 1 line, value time `HH:MM` numeric; tap → `Alert` with the full message and stack). Empty: `EmptyState icon={Bug} title={t('noErrors')} hint={t('appCrashedBody')}` without a button. Footer: primary `Share2` `shareLog` → builds text = app name + `Application.nativeApplicationVersion` + `Platform.OS Platform.Version` + language + the log, writes `errors-YYYY-MM-DD.txt` to cache and `Sharing.shareAsync` it; secondary danger `clearLog` → `Alert(confirmDelete)` → `clearErrorLog()` + toast `deleted`.

## 11. The header menu and the quick-add sheet

**Menu button**: `IconButton icon={Menu} label={t('menu')}` rightmost in every `TabHeader` → `router.push('/more')`. Screen-specific actions sit left of it; never more than two icons.

**Quick-add sheet** (`add.tsx`, transparent modal on `surface3`): header `whatToAdd` + close; caption under it `${t('project')}: ${currentProjectName ?? t('allProjects')}`; one `ListCard inset` of 56-tall rows (icon slots neutral except the first): `newExpense` (`Receipt`, slot `primary`/`primarySoft`, → `/expense/form`) · `todaysWork` (`ClipboardCheck`, → `/wage/today`) · `giveAdvance` (`HandCoins`, → `/wage/form?kind=advance`) · `issueTool` (`ArrowUpFromLine`, → `/tool/move?kind=issue`) · `newNote` (`NotebookPen`, → `/note/form`) · `newWorker` (`UserPlus`, → `/worker/form`). Rows use `router.replace`. Scrim tap, swipe-down and back close it.

## 12. Error states

1. **Friendly error screen**: `src/components/ErrorBoundary.tsx` (class component) wraps the `Stack` in `_layout.tsx`, and `setFatalErrorListener` feeds it uncaught fatals. It renders `ErrorScreen` (MASTER §5): `appCrashed` / `appCrashedBody`; `tryAgain` resets the boundary; `shareLog` builds and shares the log exactly as §10; `goHome` → `router.replace('/(tabs)')` then resets. Every render error is also `reportError(err, 'boundary', { route })`.
2. **Database cannot open** (boot): the existing branch in `_layout.tsx` restyled as `ErrorScreen` with title `errorTitle`, body `dbError`, buttons `tryAgain` (retry `getDb()`) and `shareLog`.
3. **Inline validation**: `useRecordForm.submit` catches `ValidationError` → the field shows caption `danger` + `AlertCircle` under it with the key text (`errName`, `errAmount`, `errProject`, `errDate`, `errDays`, `errNote`, `errWorker`, `rateRequired`), label colour unchanged, `accessibilityLiveRegion` polite, error haptic; the form scrolls to the first errored field. Validation runs on submit only; typing in a field clears its error (`form.clearError`).
4. **Save failures** (anything else thrown from a repo call): `reportError` + danger toast `friendlyMessage(err, t)` with action `tryAgain` (re-runs the same submit), `sticky`. The form stays open with every value. Replace the `Alert` in `useRecordForm.submit` with this.
5. **Camera / photos**: `cameraOff` as an `Alert` with buttons `settings` (`Linking.openSettings()`), `fromGallery` (opens the gallery picker), `cancel`. Storage full → danger toast `storageFull`.
6. **Long operations** (PDF, backup, restore, import, share): keep `guard()` / `showError()` (native `Alert` titled `errorTitle` with the friendly body). While running, the button shows its loading state and the rest of the screen stays usable.
7. **Toasts**: success `savedOnPhone` / `deleted` / `sheetSaved` (neutral, 2.5 s); reversible actions `deleted` + `undo` (6 s); failures danger + `tryAgain` (sticky, closable). One at a time, above the FAB, never covering a footer button.
8. **Tone**: plain words in all three languages, "we" for app faults, no codes, no exclamation marks; every message says what happened and what to do next; colour is always paired with an icon and words.

## 13. Empty states (every list)

| Where | Icon | Title / hint | Button |
|---|---|---|---|
| Today, no projects | `Building2` | `noProjects` / `noProjectsHint` | `newProject` |
| Today, recent list | `Receipt` | `noExpenses` / `noExpensesHint` (compact) | — (FAB) |
| Projects tab | `Building2` | `noProjects` / `noProjectsHint` | `newProject` |
| Projects search, no match | `Search` | `0 ${projects}` / `"q"` | — |
| Workers tab (project) · hub workers · work & pay roster | `HardHat` | `noWorkersOnProject` / `noWorkersOnProjectHint` | `addWorkerToProject` |
| Workers tab (all projects) | `HardHat` | `noWorkers` / `noWorkersHint` | `newWorker` |
| Work & pay, no project | `Building2` | `noProjectSelected` / `chooseProjectFirstHint` | `chooseProject` |
| Worker assign, nobody left | `UserPlus` | `noneAvailable` (caption only; segment flips to New) | — |
| Expenses tab | `Receipt` | `noExpenses` / `noExpensesHint` | `newExpense` |
| Tools tab | `Hammer` | `noTools` / `noToolsHint` | `newTool` |
| Notes | `NotebookPen` | `noNotes` / `noNotesHint` | `newNote` |
| Worker history · tool history | — | caption line (`recordWork · giveAdvance · payWages` / `issueTool`) | — |
| Problem log | `Bug` | `noErrors` / `appCrashedBody` | — |
| Picker sheet search | — | caption `search: "q"` | — |

Filtered lists never show an empty state: zero-count filter chips are disabled instead. Empty-state copy names the real first action, never sample data.

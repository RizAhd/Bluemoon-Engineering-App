# Estimates (quotations)

A client asks "how much for this job?". The supervisor or owner builds an **estimate** on the phone, with every price line and a payment schedule, and sends it as a PDF (WhatsApp, email). When the client agrees, the estimate becomes a project in one tap. Works fully offline, like the rest of the app.

Read first: [PLAN.md](PLAN.md), `design-system/bluemoon-site/FLOWS.md`, `.claude/skills/bluemoon-mobile-ui/SKILL.md`.

## 1. What the user can do

1. **Create** an estimate: client name (phone, address optional), what is being quoted (title), site location, date, how many days it stays valid.
2. **Add price lines** (bill of quantities): description, unit, quantity, rate. The amount is worked out.
3. **Discount** (a rupee amount) and **tax** (a percentage, 0 by default) on the whole estimate.
4. **Payment schedule**: stages with a share of the total, e.g. Advance 30 %, Progress 40 %, On completion 30 %. One tap fills the standard 30/40/30. The amounts are shown beside each stage.
5. **Payment details**: the company's bank name, account name, number and branch are printed on the PDF. Entered once in *Settings → Company & bank details*.
6. **Terms and notes**: free text. New estimates start with the default terms from Settings.
7. **Send**: *Share estimate PDF* with two choices, **On company letterhead** (tick box, off by default) and **language** of the labels (English, Sinhala, Tamil; English by default, because the client reads it). Opens the phone's share sheet.
8. **Track**: status Draft, Sent, Accepted, Declined. After sharing the app offers "Mark as sent".
9. **Accepted → project**: *Create project from this estimate* makes a project (name = title, client, location, contract value = estimate total) and links it. A linked estimate shows *Open project*.
10. **Duplicate** an estimate (a new draft with the same lines) and **delete** one (soft delete, confirmed).
11. **Hand-off**: the PDF carries the estimate data inside, exactly like the project PDF, so another staff phone can import it from *Import PDF*.

Not in scope: online payment, e-signatures, client portal, VAT registration logic, multiple currencies.

## 2. Data model (migration 5; append, never edit shipped migrations)

All three tables use the common columns (`id`, `created_at`, `updated_at`, `deleted_at`, `version`, `device_id`).

`estimates`: `number` (non-empty), `client_name` (non-empty), `client_phone`, `client_address`, `title` (non-empty), `location`, `issue_day` (YYYY-MM-DD), `valid_days` (1 to 365, default 30), `discount_cents` (>= 0), `tax_bp` (0 to 10000, basis points), `status` (draft, sent, accepted, declined; default draft), `terms`, `notes`, `project_id` (nullable, references projects).

`estimate_items`: `estimate_id`, `position`, `description` (non-empty), `unit`, `qty_milli` (integer, 1 to 1,000,000,000; 1000 = 1 unit, so 12.5 m² = 12500), `rate_cents` (0 to 5,000,000,000).

`estimate_payments`: `estimate_id`, `position`, `label` (non-empty), `percent_bp` (1 to 10000).

Money is whole cents. Quantities are integers in thousandths, so nothing is ever a float.

**Line amount** = `(qty_milli * rate_cents + 500) / 1000` (integer division, rounds half up).

**View `v_estimate_total`**, one row per live estimate (including ones with no items): `estimate_id`, `item_count`, `subtotal_cents` (sum of line amounts of live items), `discount_cents`, `tax_cents`, `total_cents`, `scheduled_bp` (sum of live payment `percent_bp`). `taxable = max(0, subtotal - discount)`; `tax = (taxable * tax_bp + 5000) / 10000`; `total = taxable + tax`. This matches the `EstimateTotal` type in `src/db/types.ts`.

**Payment amounts** are `total * percent_bp / 10000`, rounded half up, and when the stages add up to exactly 10000 bp the last stage takes the remainder so the amounts add up to the total to the cent. One pure function does this (`allocatePayments`, in `src/lib/estimate.ts`); screens and the PDF both call it. No other code does this arithmetic.

`DATA_TABLES` gains `estimates`, `estimate_items`, `estimate_payments` after `projects` (parents before children). They must be covered by the audit log, backups, restore, merge and the "every table" tests in `src/db/__tests__` and `src/lib/__tests__`.

## 3. Rules (enforced in the repo, with a `ValidationError(field, key)` and a message key)

- client name, title, number: required. Number defaults to `EST-<year>-<NNN>` from a counter kept per phone and year (settings key `estimate_seq_<year>`); the user may edit it. Two phones can produce the same number; that is accepted.
- valid_days 1 to 365; discount >= 0 and not more than the current subtotal (when the subtotal is 0, only 0 is allowed); tax 0 to 100 % (shown as a percentage with up to 2 decimals, stored in basis points).
- Item: description required, quantity > 0 (up to 3 decimals), rate >= 0. Max 200 items per estimate.
- Payment stage: label required, percent between 0.01 and 100 (up to 2 decimals); the stages of one estimate may not add up to more than 100 %. Fewer than 100 % is allowed and shown as a warning ("x % is not scheduled yet").
- **Locked when accepted**: items, stages, discount and tax of an `accepted` estimate cannot change (`ValidationError('estimate', 'errEstimateLocked')`). Reopening sets it back to `draft` (a status change is always allowed). A `declined` estimate may be edited.
- Status changes go through one function that writes the audit row; changing the status does not bump anything else.
- Creating a project from an estimate: allowed only when `accepted` and `project_id` is null; done in one transaction; the project gets `contract_cents = total_cents`, status `active`; the estimate's `project_id` is set. The contract value is a snapshot and does not follow later edits.
- Duplicate: a new draft with a new number and today's date, copying lines and stages; never copies `project_id`.
- Deleting an estimate soft-deletes its lines and stages in the same transaction. A linked project is left alone.

## 4. Files and who owns them

| Area | Files |
|---|---|
| Data layer | `src/db/schema.ts` (migration 5), `src/db/types.ts` (already has the types; add only if needed), `src/db/estimates.ts` (repo functions, `loadEstimate`), `src/db/index.ts`, `src/hooks/data.ts` (hooks), `src/lib/estimate.ts` (pure helpers), `src/lib/company.ts` (profile in settings), `src/lib/bundle.ts` (bundle support), `src/lib/demoData.ts`, validation keys in `src/i18n/{en,si,ta}.ts`, tests in `src/db/__tests__` and `src/lib/__tests__` |
| PDF | `src/lib/estimateHtml.ts`, `src/lib/estimatePdf.ts`, `src/lib/estimateLabels.ts` (the printed labels in English, Sinhala and Tamil; self-contained, not part of the app's i18n files), `src/lib/numberToWords.ts`, reading the new bundle kind in `src/lib/pdf.ts`, tests in `src/lib/__tests__` |
| Screens | `src/app/estimate/*`, `src/app/company.tsx`, `src/app/more.tsx`, `src/app/add.tsx`, `src/app/_layout.tsx`, `src/app/import.tsx`, a link from `src/app/project/[id].tsx`, `src/i18n/*`, screen tests in `src/__tests__/screens` |

## 5. Contracts between the parts

```ts
// src/db/estimates.ts
export interface LoadedEstimate { estimate: Estimate; items: EstimateItem[]; payments: EstimatePayment[]; total: EstimateTotal }
export function loadEstimate(id: string): LoadedEstimate | null;     // live rows, position order; null if missing or deleted

// src/lib/company.ts
export function getCompanyProfile(): CompanyProfile;                  // settings keys company_*; falls back to COMPANY_DEFAULTS
export function saveCompanyProfile(p: Partial<CompanyProfile>): void;
export function useCompanyProfile(): CompanyProfile;                  // reactive

// src/lib/estimate.ts (pure, no database)
export function parseQty(input: string): number | null;               // "12.5" -> 12500, up to 3 decimals, comma or dot, null if invalid
export function formatQty(milli: number): string;                     // 12500 -> "12.5", 3000 -> "3"
export function parsePercent(input: string): number | null;          // "18" or "12.5" -> basis points (1800, 1250); up to 2 decimals
export function formatPercent(bp: number): string;                    // 1800 -> "18", 1250 -> "12.5"
export function lineAmount(qtyMilli: number, rateCents: number): number;
export function allocatePayments(totalCents: number, percentsBp: number[]): number[]; // see section 2
export function validUntil(issueDay: string, validDays: number): string;
export function nextEstimateNumber(year: number, seq: number): string;           // EST-2026-001

// src/lib/estimatePdf.ts
export async function exportEstimatePdf(estimateId: string, opts: EstimatePdfOptions): Promise<File>;

// src/db/estimates.ts also exports (data engineer decides exact shapes and reports them):
//   saveEstimate, saveEstimateItem, removeEstimateItem, saveEstimatePayment, removeEstimatePayment,
//   useStandardSchedule(estimateId) / applyStandardSchedule (30/40/30), setEstimateStatus,
//   duplicateEstimate, deleteEstimate, createProjectFromEstimate
// src/hooks/data.ts: useEstimates(), useEstimate(id), useEstimateItems(id), useEstimatePayments(id), useEstimateTotal(id)
```

## 6. Screens

Follow the mobile UI skill: tokens only, 4 pt grid, 56 dp primary targets, 48 minimum, light and dark, English / Sinhala / Tamil, nothing breaks at font scale 1.3, long client names truncate or wrap, every list has an empty state, every save has error handling through `guard`/`useRecordForm`. New copy goes through `src/i18n` in all three languages.

- **Entry points**: *Settings and more → Estimates* (first row), *Quick-add sheet → New estimate*, and on a project that came from an estimate, a row linking back.
- **`estimate/index`**: list, newest first. Row: number, client, title, total (numeric), status badge (colour plus word). Filter chips by status when more than 5 estimates. Search by client or title when more than 8. Empty state with a *New estimate* button. FAB-style primary button at the bottom: *New estimate*.
- **`estimate/form`**: create and edit the header fields. On create, saves and goes to the hub. One screen in three titled sections: **Client** (name, phone with the WhatsApp hint, address), **Job and site** (title, site location), **Date and validity** (date, valid-for chips with a live "Valid until …"). Number, discount, tax, notes and terms sit under "More details". Every field shows a concrete example as its placeholder (e.g. "e.g. Mr. Nimal Perera", "e.g. 225 mm brick wall in cement mortar 1:5").
- **`estimate/[id]`** (hub, one scroll): summary card (number, status badge, client, title, issue date, valid until); **Total card** with subtotal, discount, tax, and the total large; **Items** list with *Add item* (tap a row to edit; swipe is not required); **Payment schedule** list with amounts, a warning row when not 100 %, *Add stage*, *Use standard schedule (30/40/30)*; **Payment details** preview of the bank block with a link to Settings when it is empty; **Terms**; actions: primary *Share estimate PDF* (opens a bottom sheet with the *On company letterhead* tick box, the language chips, and *Share*; afterwards a toast/Alert offering *Mark as sent*), then *Edit details*, *Duplicate*, status actions that make sense for the current status (Mark as sent / Accepted / Declined / Reopen as draft), *Create project* (accepted and not yet linked) or *Open project*, and *Delete* at the bottom (danger, confirmed). When locked (accepted) the add/edit buttons for lines and stages are hidden and a caption says why.
- **`estimate/item`**: description (multi-line, example placeholder), unit (chips in Sri Lankan BOQ order: sq.m, cu.m, sq.ft, cube, lin.m, rft, nos, kg, L.S., perch, day, plus free text), quantity, rate; the line amount updates as the user types; *Save* and *Save and add another*; delete when editing. Items are entered quickly, so the keyboard and tab order must work.
- **`estimate/payment`**: label (chips: Advance, Progress payment, On completion, Retention, plus free text) and percent; shows the amount; remaining unscheduled percent is shown as a hint.
- **`company`**: company details and bank details, default valid days, default terms. Saved per phone.

## 7. The PDF

A4 portrait, built as HTML for `expo-print` (like `reportHtml.ts`: study it and `letterhead.ts` and reuse the spacer technique, margins and `applyLetterhead`). Two layouts exactly as for the project report: **plain** (logo and company details at the top, 16 mm margins) and **letterhead** (the company letterhead supplies logo and contact details; keep inside `LETTERHEAD_MARGIN_MM`; same white wash). Labels come from `estimateLabels.ts` in the chosen language; names, descriptions and notes are printed as typed. Sinhala and Tamil must shape correctly (no letter-spacing, enough line height).

Content, top to bottom: title **ESTIMATE**; number, date, valid until; **Prepared for** (client name, phone, address) and **Project** (title, location); items table (No., Description, Unit, Qty, Rate, Amount) with the header repeated on each page and no row split across a page; totals block right-aligned (Subtotal, Discount if any, Tax x % if any, **Total (LKR)**); *Amount in words* in English (e.g. "Rupees One Hundred and Twenty Five Thousand Only"; `numberToWords.ts`, tested, handles cents as "and Fifty Cents"); payment schedule table (No., Stage, %, Amount) and a note when it is not 100 %; **Payment details** (bank block, only the filled lines); **Terms and conditions** and notes; a signature block with "Authorised signature" for the company and "Accepted by client (name, signature, date)"; a small footer line "Prices are in Sri Lankan Rupees (LKR). Valid until <date>.". Page numbers if the engine allows.

The PDF carries the estimate data like the project PDF does (`bluemoon-data.json` plus `bluemoon-data.sha256`), with bundle `kind: 'estimate'`, so *Import PDF* can add it on another phone. File name: `Estimate-<number>-<client>.pdf` with unsafe characters removed.

## 8. Tests (all required; a regression test must fail without the code it covers)

- Data: migration 5 on an empty database and as an upgrade from version 4 with data (no row lost); the view with many combinations (no items, discount over subtotal, tax rounding, half-cent rounding, deleted lines ignored); every validation rule; locked-when-accepted; status changes; duplicate; delete cascade; create project from estimate (including refusing twice); number sequence; settings-backed company profile; audit rows written for every write; backup and restore keep estimates; merge of the same estimate edited on two phones (newer version wins per row); bundle export and import of an estimate on a second phone; `collectProject` carries a linked estimate.
- Pure helpers: parse/format round trips, rounding, `allocatePayments` always sums to the total when the stages sum to 10000.
- PDF: HTML escaping, totals and schedule printed exactly as the view reports, empty optional blocks omitted, the three languages, `numberToWords`, A4 page size and embedded data readable by `readProjectPdf`, letterhead layout margins, fallback when the letterhead cannot load.
- Screens: every new screen renders in light and dark and in English, Sinhala and Tamil with the existing smoke-test harness, plus flow tests: create → add items → add stages → share → mark sent → accepted → create project; validation messages; locked state; empty states; double tap on Save.
- Whole project: `npx tsc --noEmit`, `npx eslint src`, `npx jest --ci --runInBand` all green.

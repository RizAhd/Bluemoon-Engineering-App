/**
 * The text people send from the app (WhatsApp, SMS, e-mail, any app on the phone's share sheet).
 *
 * Pure on purpose: no database, no React, no phone. Every builder takes plain data and a language and
 * returns one string, so it runs on Node for tests. The loaders in shareLoad.ts fetch exactly the data
 * each builder takes; share.ts hands the string to the phone.
 *
 * Shape of every message:
 *   *Title*                       WhatsApp bold; the first line, so it is also the chat preview
 *   Label: value                  short lines, a label whose value is empty is left out
 *   (blank line between groups)
 *   lines of a list               capped, with a last line "… and 12 more" when there are more
 *   Developed with Bluemoon Site · 22 Oct 2026
 *
 * Rules that hold for all of them:
 *  - Typed text (names, notes, shops) is cleaned: asterisks and back-ticks are removed (they are
 *    WhatsApp's bold and code), line breaks and control characters become spaces, and long text is cut
 *    with an ellipsis. So typed text can never break the formatting or the layout.
 *  - Amounts are formatLKR ("Rs 1,250,000"), dates formatDay ("22 Oct 2026"), always Western digits.
 *  - No emoji, no tables, nothing is ever printed as "undefined", "null" or "NaN": a missing or
 *    unusable number is 0 (or the line is left out), an unusable date is left out.
 *  - A message is at most SHARE_LIMITS.message characters. When it would be longer the lists give way
 *    (last list first, last line first); the totals and headings never do.
 *
 * Money is not worked out here beyond adding a few whole-cent figures: the estimate prints the numbers
 * of v_estimate_total as given (stage amounts come from allocatePayments), the project message the
 * numbers of v_project_cost, the statement those of v_worker_balance / v_project_worker_balance.
 */
import type { CompanyProfile, Estimate, EstimatePayment, EstimateTotal, Project, ProjectCost } from '@/db/types';
import type { Lang } from '@/i18n';

import { formatDay, isValidDay } from './dates';
import { allocatePayments, formatPercent, formatQty, validUntil } from './estimate';
import { formatLKR } from './money';
import { fill, shareLabels, type ShareLabels } from './shareLabels';

/** How much a message may hold, and why. */
export const SHARE_LIMITS = {
  /** A whole message, in characters (WhatsApp takes far more; this keeps it a message and not a document). */
  message: 3500,
  /** A title, name or other typed value on a line of its own. */
  value: 100,
  /** A name inside a list line (a worker, a shop, a tool). */
  item: 60,
  /** One note inside a list (the project message). */
  note: 160,
  /** A single site note shared on its own is sent whole, up to this. */
  noteFull: 2500,
  /** Expenses in the expenses message. */
  expenses: 30,
  /** Tools in the tools-out message. */
  tools: 40,
  /** Notes in the project message. */
  notes: 3,
  /** Notes in the notes-list message. */
  notesList: 15,
  /** Worker lines in the work-and-pay message. */
  workers: 40,
  /** Expense categories in the project message. */
  categories: 5,
  /** Project lines in a worker statement. */
  projects: 15,
  /** Payments and advances in a worker statement. */
  payments: 5,
  /** Payment stages in an estimate. */
  stages: 10,
} as const;

const ELLIPSIS = '…';
const SEP = ' — ';

// ---------------------------------------------------------------- the input of each message

/** Every message carries the day it is made, "YYYY-MM-DD", for its footer (so the builders do not read the clock). */
interface Dated {
  today: string;
}

export interface ProjectShareInput extends Dated {
  project: Pick<Project, 'name' | 'client' | 'location' | 'status' | 'contract_cents'>;
  /** v_project_cost: the total cost is expenses + labour, as on the project screen. */
  cost: Pick<ProjectCost, 'expense_cents' | 'labour_cents' | 'labour_paid_cents'>;
  /** Expenses per category, biggest first (the project screen's "By category"). */
  categories: { category: string; cents: number }[];
  /** Workers on the project who still work there (the project screen's list). */
  workerCount: number;
  /** Tools out on this project. */
  toolsOutCount: number;
  /** The newest notes, newest first. */
  notes: { day: string; body: string }[];
  /** How many notes the project has in all. */
  noteCount: number;
}

export interface EstimateShareInput extends Dated {
  estimate: Pick<Estimate, 'number' | 'title' | 'client_name' | 'location' | 'issue_day' | 'valid_days' | 'tax_bp'>;
  /** The payment stages in position order. */
  payments: Pick<EstimatePayment, 'label' | 'percent_bp'>[];
  /** The row of v_estimate_total, printed as it is. */
  total: EstimateTotal;
  company: Pick<CompanyProfile, 'name' | 'phone'>;
}

/** One row of v_wage_day with the worker's name. */
export interface DaySheetRow {
  name: string;
  /** null when nothing was worked that day (only a payment or an advance). */
  days: number | null;
  work_cents: number;
  paid_cents: number;
  advance_cents: number;
}

export interface DaySheetShareInput extends Dated {
  projectName: string;
  /** The day of the sheet, "YYYY-MM-DD". */
  day: string;
  rows: DaySheetRow[];
}

export interface WorkerStatementShareInput extends Dated {
  worker: { name: string; trade: string | null; daily_rate_cents: number };
  /** The project the statement is for, or null for all projects. */
  projectName: string | null;
  /** v_worker_balance for all projects; that project's figures for one project. */
  totals: { earned_cents: number; advance_cents: number; paid_cents: number; balance_cents: number };
  /** One line per project (all-projects statement), in the worker screen's order. */
  projects: { name: string; days_total: number; balance_cents: number }[];
  /** The latest payments and advances, newest first. */
  recent: { day: string; kind: 'payment' | 'advance'; amount_cents: number; project_name: string | null }[];
  /** How many payments and advances the worker has in all. */
  recentCount: number;
}

export interface ExpenseRow {
  day: string;
  category: string;
  amount_cents: number;
  paid_to: string | null;
  project_name: string | null;
}

export interface ExpensesShareInput extends Dated {
  /** The project, or null for all projects. */
  projectName: string | null;
  /** The newest expenses, newest first. */
  rows: ExpenseRow[];
  /** The total and the number of all the expenses in scope, not only the rows (the Expenses tab's "Total cost"). */
  totalCents: number;
  totalCount: number;
}

/** One holder of a tool or material: who has how much of it, where, since when (a row of v_tool_holders). */
export interface ToolOutRow {
  name: string;
  code: string | null;
  /** The worker, or the name typed for someone outside the company. */
  with_name: string | null;
  /** The day it went out, "YYYY-MM-DD". */
  since: string | null;
  project_name: string | null;
  /** How much this person has (thousandths: 1000 = one piece). Left out by older callers: one piece. */
  qty_milli?: number | null;
  /** The tool's total, so one of ten pieces reads "1 out" while a single piece says nothing. */
  quantity_milli?: number | null;
  /** "bags", "kg"... printed after the count; null for a plain number. */
  unit?: string | null;
  /** 1 for a material (issued and used up), 0 for a tool. */
  is_material?: number | null;
}

export interface ToolsOutShareInput extends Dated {
  /** The project, or null for all projects. */
  projectName: string | null;
  tools: ToolOutRow[];
}

export interface NoteShareInput extends Dated {
  projectName: string;
  day: string;
  body: string;
  /** 'sunny' | 'cloudy' | 'rain'; anything else is not shown. */
  weather: string | null;
}

/** One row of the Workers tab: the balance on the project, or the worker's own with "All projects". */
export interface WorkerListShareRow {
  name: string;
  trade: string | null;
  balance_cents: number;
  active: number;
}

export interface WorkersListShareInput extends Dated {
  /** The project, or null for all projects. */
  projectName: string | null;
  /** Working first, then those who left; by name (the Workers tab's order). */
  rows: WorkerListShareRow[];
}

export interface NotesListShareInput extends Dated {
  /** The project, or null for all projects. */
  projectName: string | null;
  /** The newest notes, newest first. */
  notes: { day: string; body: string; weather: string | null; project_name: string | null }[];
  /** How many notes there are in all. */
  noteCount: number;
}

// ---------------------------------------------------------------- cleaning typed text

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Cut `text` to at most `max` characters, the last one the ellipsis. Never splits an emoji, and never
 * leaves a Sinhala or Tamil letter without its vowel sign or a joiner hanging at the end.
 */
export function ellipsize(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = Math.max(1, max - 1);
  if (isHighSurrogate(text.charCodeAt(end - 1))) end--;
  while (end > 1 && /[\p{M}\u{200c}\u{200d}]/u.test(text.charAt(end))) end--;
  return text.slice(0, end).replace(/[\u{200c}\u{200d}]+$/u, '').trimEnd() + ELLIPSIS;
}

/**
 * Typed text with what could disturb a message taken out: asterisks and back-ticks (WhatsApp bold and
 * code; "150*150" keeps its meaning as "150×150"), control characters and lone surrogates. Line breaks
 * stay only when asked for.
 */
function scrub(text: string, keepBreaks: boolean): string {
  const joined = text.replace(/\r\n?/g, '\n').replace(/(\d)[ \t]*\*+[ \t]*(?=\d)/g, '$1×');
  let out = '';
  for (const ch of joined) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '*' || ch === '`' || code === 0xfeff) continue;
    if (code >= 0xd800 && code <= 0xdfff) continue;
    if (ch === '\n') {
      out += keepBreaks ? '\n' : ' ';
    } else if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) {
      out += ' ';
    } else {
      out += ch;
    }
  }
  return out;
}

/** Typed text for one line: cleaned, single spaces, cut after `max` characters. Anything that is not text is ''. */
export function singleLine(value: unknown, max: number = SHARE_LIMITS.value): string {
  if (typeof value !== 'string') return '';
  return ellipsize(scrub(value, false).replace(/\s+/g, ' ').trim(), max);
}

/** Typed text that keeps its paragraphs (a site note shared on its own). */
function paragraphs(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const text = scrub(value, true)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return ellipsize(text, max);
}

// ---------------------------------------------------------------- numbers and dates

/** Whole cents, or null for anything that is not a usable amount. */
function cents(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? Math.round(value) : null;
}

/** "Rs 1,250"; an unusable amount is "Rs 0". */
const money = (value: unknown): string => formatLKR(cents(value) ?? 0);

/** A count: a whole number, 0 or more. */
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), Number.MAX_SAFE_INTEGER) : 0;
}

/** Days of work: at most two decimals, no trailing zeros ("1", "0.5", "1.25"). */
function dayCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 10_000_000 ? Math.round(value * 100) / 100 : 0;
}

/** Basis points (a percentage times 100) as stored: a whole number from 0 to 100,000, else null. */
function basisPoints(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100_000 ? value : null;
}

/** A count in thousandths (1000 = one piece) as stored: a whole number, 0 or more, else null. */
function milli(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** "22 Oct 2026", or '' when the day is not a real "YYYY-MM-DD". */
function dayText(value: unknown): string {
  return typeof value === 'string' && isValidDay(value) ? formatDay(value) : '';
}

// ---------------------------------------------------------------- reading loose input

type Loose = Record<string, unknown>;
const loose = (value: unknown): Loose => (value && typeof value === 'object' ? (value as Loose) : {});
const rowsOf = (value: unknown): Loose[] => (Array.isArray(value) ? value.map(loose) : []);

// ---------------------------------------------------------------- lines and groups

/** "Label: value", or '' when there is no value. */
const kv = (label: string, value: string): string => (value ? `${label}: ${value}` : '');
/** Parts joined with " — ", the empty ones left out. */
const dashed = (...parts: string[]): string => parts.filter(Boolean).join(SEP);

interface ListGroup {
  head?: string;
  /** The lines that may be shown, already capped. */
  items: string[];
  /** How many there are in all (more than `items` when the list was capped). */
  total: number;
}

/** A fixed group is plain lines; a list group gives way when the message gets too long. */
type Group = string[] | ListGroup;

function listGroup(head: string | undefined, lines: string[], total: number, cap: number): ListGroup {
  // a row with nothing to say makes no line (and is not counted as one of the "more")
  const kept = lines.filter(Boolean);
  return { head, items: kept.slice(0, cap), total: Math.max(total - (lines.length - kept.length), kept.length) };
}

function footerLine(L: ShareLabels, today: unknown): string {
  const day = dayText(today);
  return day ? `${L.footer} · ${day}` : L.footer;
}

/**
 * Put a message together: the title and its `header` lines, then the groups with a blank line between
 * them, then the footer. When it is longer than SHARE_LIMITS.message, lines are taken off the end of the
 * last list, then the one before, and so on. Fixed groups are never cut.
 */
function assemble(L: ShareLabels, title: string, header: string[], groups: Group[], today: unknown): string {
  const footer = footerLine(L, today);
  const shown = groups.map((g) => (Array.isArray(g) ? 0 : g.items.length));
  const top = [`*${title}*`, ...header.filter(Boolean)];
  // With no heading lines of its own the first group sits right under the title.
  const first = groups[0];
  const joined = top.length === 1 && Array.isArray(first);
  if (joined) top.push(...first.filter(Boolean));

  const build = (): string => {
    const blocks: string[] = [top.join('\n')];
    groups.forEach((g, i) => {
      if (i === 0 && joined) return;
      if (Array.isArray(g)) {
        const lines = g.filter(Boolean);
        if (lines.length) blocks.push(lines.join('\n'));
        return;
      }
      const n = shown[i];
      if (n <= 0) return;
      const lines = [...(g.head ? [g.head] : []), ...g.items.slice(0, n)];
      if (g.total > n) lines.push(fill(L.more, { n: g.total - n }));
      blocks.push(lines.join('\n'));
    });
    blocks.push(footer);
    return blocks.join('\n\n');
  };

  let text = build();
  while (text.length > SHARE_LIMITS.message) {
    let last = -1;
    for (let i = groups.length - 1; i >= 0; i--) {
      if (!Array.isArray(groups[i]) && shown[i] > 0) {
        last = i;
        break;
      }
    }
    if (last < 0) break;
    shown[last]--;
    text = build();
  }
  // Cannot happen with the caps above (the fixed parts are short); the message limit still holds.
  return text.length > SHARE_LIMITS.message ? ellipsize(text, SHARE_LIMITS.message) : text;
}

/** The title: typed text, never empty (an empty bold marker would show as two asterisks). */
const titleOf = (text: string, fallback: string): string => text || fallback;

// ---------------------------------------------------------------- words for stored values

const STATUS_KEYS = { active: 'status_active', on_hold: 'status_on_hold', completed: 'status_completed' } as const;
const CATEGORY_KEYS = {
  materials: 'cat_materials',
  transport: 'cat_transport',
  fuel: 'cat_fuel',
  machinery: 'cat_machinery',
  food: 'cat_food',
  tools: 'cat_tools',
  subcontract: 'cat_subcontract',
  utilities: 'cat_utilities',
  other: 'cat_other',
} as const;
const WEATHER_KEYS = { sunny: 'weather_sunny', cloudy: 'weather_cloudy', rain: 'weather_rain' } as const;

const has = (table: object, key: string): boolean => Object.prototype.hasOwnProperty.call(table, key);

function statusText(L: ShareLabels, status: unknown): string {
  return typeof status === 'string' && has(STATUS_KEYS, status) ? L[STATUS_KEYS[status as keyof typeof STATUS_KEYS]] : '';
}

/** The category in the reader's language; a category this version does not know is shown as typed. */
function categoryText(L: ShareLabels, category: unknown): string {
  const key = typeof category === 'string' ? category.trim() : '';
  if (has(CATEGORY_KEYS, key)) return L[CATEGORY_KEYS[key as keyof typeof CATEGORY_KEYS]];
  return singleLine(key, SHARE_LIMITS.item) || L.cat_other;
}

function weatherText(L: ShareLabels, weather: unknown): string {
  return typeof weather === 'string' && has(WEATHER_KEYS, weather) ? L[WEATHER_KEYS[weather as keyof typeof WEATHER_KEYS]] : '';
}

/** "1 day", "1.5 days" (Sinhala and Tamil have one form). */
const daysText = (L: ShareLabels, days: number): string => fill(days === 1 ? L.dayOne : L.dayMany, { n: days });

/** What a worker is owed, as a phrase inside a line: "to pay Rs 3,500", "advance over Rs 500" or "settled". */
function balancePhrase(L: ShareLabels, balance: number): string {
  if (balance > 0) return fill(L.balToPay, { amount: money(balance) });
  if (balance < 0) return fill(L.balAdvanceOver, { amount: money(-balance) });
  return L.balSettled;
}

/** The "Label: value" line of what is owed, worded as on the worker screen. */
function balanceLine(L: ShareLabels, balance: number): string {
  if (balance > 0) return kv(L.toPay, money(balance));
  if (balance < 0) return kv(L.advanceOver, money(-balance));
  return kv(L.balance, L.settled);
}

// ---------------------------------------------------------------- project

/** A project as the project screen shows it: who, where, the money and how much of the contract is used, what is on site. */
export function projectMessage(input: ProjectShareInput, lang: Lang): string {
  const L = shareLabels(lang);
  const root = loose(input);
  const project = loose(root.project);
  const cost = loose(root.cost);

  const expense = cents(cost.expense_cents) ?? 0;
  const labour = cents(cost.labour_cents) ?? 0;
  const labourPaid = cents(cost.labour_paid_cents) ?? 0;
  const spent = expense + labour;
  const contract = cents(project.contract_cents) ?? 0;
  const hasContract = contract > 0;
  const left = contract - spent;

  const header = [
    kv(L.client, singleLine(project.client)),
    kv(L.location, singleLine(project.location)),
    kv(L.status, statusText(L, project.status)),
  ];

  const moneyLines = [
    hasContract ? kv(L.contractValue, money(contract)) : '',
    kv(L.totalCost, money(spent)),
    kv(L.expenses, money(expense)),
    kv(L.labour, money(labour)),
    kv(L.labourPaid, money(labourPaid)),
    hasContract ? kv(L.contractUsed, `${Math.max(0, Math.round((spent / contract) * 100))}%`) : '',
    hasContract ? (left >= 0 ? kv(L.leftInContract, money(left)) : kv(L.overContract, money(-left))) : '',
  ];

  const categories = rowsOf(root.categories)
    .map((r) => ({ label: categoryText(L, r.category), amount: cents(r.cents) ?? 0 }))
    .filter((r) => r.amount > 0)
    .map((r) => kv(r.label, money(r.amount)));

  const onSite = [kv(L.workers, String(count(root.workerCount))), count(root.toolsOutCount) > 0 ? kv(L.toolsOut, String(count(root.toolsOutCount))) : ''];

  const notes = rowsOf(root.notes)
    .map((n) => dashed(dayText(n.day), singleLine(n.body, SHARE_LIMITS.note)))
    .filter(Boolean);

  return assemble(
    L,
    titleOf(singleLine(project.name), L.project),
    header,
    [
      moneyLines,
      listGroup(L.byCategory, categories, categories.length, SHARE_LIMITS.categories),
      onSite,
      listGroup(L.latestNotes, notes, Math.max(count(root.noteCount), notes.length), SHARE_LIMITS.notes),
    ],
    root.today,
  );
}

// ---------------------------------------------------------------- estimate

/**
 * An estimate (quotation) for the client: what it is for, the figures of v_estimate_total as they are,
 * the payment schedule and who to call. The stage amounts come from allocatePayments, so they add up to
 * the total to the cent.
 */
export function estimateMessage(input: EstimateShareInput, lang: Lang): string {
  const L = shareLabels(lang);
  const root = loose(input);
  const e = loose(root.estimate);
  const total = loose(root.total);
  const company = loose(root.company);

  const number = singleLine(e.number, 40);
  const validDays = typeof e.valid_days === 'number' && Number.isSafeInteger(e.valid_days) && e.valid_days >= 1 ? e.valid_days : 0;
  const issueDay = typeof e.issue_day === 'string' ? e.issue_day : '';
  const taxBp = basisPoints(e.tax_bp) ?? 0;

  const header = [
    kv(L.project, singleLine(e.title)),
    kv(L.client, singleLine(e.client_name)),
    kv(L.location, singleLine(e.location)),
    kv(L.date, dayText(issueDay)),
    kv(L.validUntil, validDays > 0 ? dayText(validUntil(issueDay, validDays)) : ''),
  ];

  const discount = cents(total.discount_cents) ?? 0;
  const figures = [
    kv(L.items, String(count(total.item_count))),
    kv(L.subtotal, money(total.subtotal_cents)),
    discount > 0 ? kv(L.discount, `-${money(discount)}`) : '',
    taxBp > 0 ? kv(`${L.tax} (${formatPercent(taxBp)}%)`, money(total.tax_cents)) : '',
    `*${L.grandTotal}: ${money(total.total_cents)}*`,
  ];

  const stages = rowsOf(root.payments);
  const percents = stages.map((s) => basisPoints(s.percent_bp));
  let amounts: number[] = [];
  try {
    amounts = allocatePayments(Math.max(0, cents(total.total_cents) ?? 0), percents.map((p) => p ?? 0));
  } catch {
    amounts = [];
  }
  const schedule = stages.map((s, i) => {
    const label = singleLine(s.label, SHARE_LIMITS.item) || String(i + 1);
    const bp = percents[i];
    const named = bp == null ? label : `${label} (${formatPercent(bp)}%)`;
    return i < amounts.length ? `${named}: ${money(amounts[i])}` : named;
  });

  const sender = [singleLine(company.name), kv(L.phone, singleLine(company.phone, 40))];

  return assemble(
    L,
    number ? `${L.estimate} ${number}` : L.estimate,
    header,
    [figures, listGroup(L.paymentSchedule, schedule, schedule.length, SHARE_LIMITS.stages), sender],
    root.today,
  );
}

// ---------------------------------------------------------------- work and pay of one day

/**
 * The work and pay of one project on one day, as the "Today's work & pay" screen adds it up: workers who
 * worked, their wages, what was paid that day (also to people who did not work) and what is still to pay.
 */
export function daySheetMessage(input: DaySheetShareInput, lang: Lang): string {
  const L = shareLabels(lang);
  const root = loose(input);

  const people = rowsOf(root.rows).map((r) => ({
    name: singleLine(r.name, SHARE_LIMITS.item) || '—',
    days: typeof r.days === 'number' && Number.isFinite(r.days) ? dayCount(r.days) : null,
    work: cents(r.work_cents) ?? 0,
    paid: cents(r.paid_cents) ?? 0,
    advance: cents(r.advance_cents) ?? 0,
  }));
  const worked = people.filter((p) => p.days != null);
  const others = people.filter((p) => p.days == null && (p.paid > 0 || p.advance > 0));

  const sum = (f: (p: (typeof people)[number]) => number, of = people) => of.reduce((s, p) => s + f(p), 0);
  const days = Math.round(sum((p) => p.days ?? 0, worked) * 100) / 100;
  // like the screen: what was paid counts for everybody, what is left to pay is worked out per worker
  const toPay = sum((p) => Math.max(0, p.work - p.paid), worked);
  const advances = sum((p) => p.advance);

  const workerLines = worked.map((p) => {
    const paid = p.paid > 0 ? fill(L.paidInline, { amount: money(p.paid) }) : L.notPaidInline;
    const advance = p.advance > 0 ? fill(L.advanceInline, { amount: money(p.advance) }) : '';
    return `${dashed(p.name, daysText(L, p.days ?? 0), money(p.work))} (${[paid, advance].filter(Boolean).join(', ')})`;
  });
  const otherLines = others.map((p) =>
    dashed(p.name, p.paid > 0 ? fill(L.paidInline, { amount: money(p.paid) }) : '', p.advance > 0 ? fill(L.advanceInline, { amount: money(p.advance) }) : ''),
  );

  const empty = worked.length === 0 && others.length === 0;
  const totals = [
    kv(L.workers, String(worked.length)),
    kv(L.days, String(days)),
    kv(L.wages, money(sum((p) => p.work, worked))),
    kv(L.paid, money(sum((p) => p.paid))),
    advances > 0 ? kv(L.advances, money(advances)) : '',
    kv(L.toPay, money(toPay)),
  ];

  return assemble(
    L,
    dashed(L.daySheet, singleLine(root.projectName)),
    [kv(L.date, dayText(root.day))],
    empty
      ? [[L.noWork]]
      : [listGroup(undefined, workerLines, workerLines.length, SHARE_LIMITS.workers), listGroup(L.otherPayments, otherLines, otherLines.length, SHARE_LIMITS.workers), totals],
    root.today,
  );
}

// ---------------------------------------------------------------- one worker

/**
 * What one worker has earned, been given and is owed, as the worker screen shows it: for all projects
 * (with a line per project) or for one project, with the latest payments and advances.
 */
export function workerStatementMessage(input: WorkerStatementShareInput, lang: Lang): string {
  const L = shareLabels(lang);
  const root = loose(input);
  const worker = loose(root.worker);
  const totals = loose(root.totals);
  const projectName = singleLine(root.projectName);
  const oneProject = projectName !== '';

  const rate = cents(worker.daily_rate_cents) ?? 0;
  const header = [kv(L.trade, singleLine(worker.trade)), kv(L.project, projectName), rate > 0 ? kv(L.dailyRate, money(rate)) : ''];

  const balance = cents(totals.balance_cents) ?? 0;
  const sums = [kv(L.earned, money(totals.earned_cents)), kv(L.advances, money(totals.advance_cents)), kv(L.paid, money(totals.paid_cents)), balanceLine(L, balance)];

  const perProject = oneProject
    ? []
    : rowsOf(root.projects).map((p) => {
        const dayTotal = dayCount(p.days_total);
        return dashed(singleLine(p.name, SHARE_LIMITS.item), dayTotal > 0 ? daysText(L, dayTotal) : '', balancePhrase(L, cents(p.balance_cents) ?? 0));
      });

  const recentRows = rowsOf(root.recent);
  const recent = recentRows.map((r) =>
    dashed(
      dayText(r.day),
      r.kind === 'advance' ? L.wage_advance : L.wage_payment,
      money(r.amount_cents),
      oneProject ? '' : singleLine(r.project_name, SHARE_LIMITS.item),
    ),
  );

  return assemble(
    L,
    titleOf(singleLine(worker.name), L.workers),
    header,
    [
      sums,
      listGroup(L.byProject, perProject, perProject.length, SHARE_LIMITS.projects),
      listGroup(L.lastPayments, recent, Math.max(count(root.recentCount), recent.length), SHARE_LIMITS.payments),
    ],
    root.today,
  );
}

// ---------------------------------------------------------------- expenses

/** The newest expenses of a project (or of all projects) and the total, as the Expenses tab shows it. */
export function expensesMessage(input: ExpensesShareInput, lang: Lang): string {
  const L = shareLabels(lang);
  const root = loose(input);
  const projectName = singleLine(root.projectName);
  const allProjects = projectName === '';

  const rows = rowsOf(root.rows);
  const totalCount = Math.max(count(root.totalCount), rows.length);
  const lines = rows.map((r) =>
    dashed(
      dayText(r.day),
      categoryText(L, r.category),
      singleLine(r.paid_to, SHARE_LIMITS.item),
      money(r.amount_cents),
      allProjects ? singleLine(r.project_name, SHARE_LIMITS.item) : '',
    ),
  );
  const how = fill(totalCount === 1 ? L.expenseOne : L.expenseMany, { n: totalCount });

  return assemble(
    L,
    dashed(L.expenses, allProjects ? L.allProjects : projectName),
    [kv(L.total, totalCount > 0 ? `${money(root.totalCents)} (${how})` : money(root.totalCents))],
    totalCount === 0 ? [[L.noExpenses]] : [listGroup(undefined, lines, totalCount, SHARE_LIMITS.expenses)],
    root.today,
  );
}

// ---------------------------------------------------------------- tools out

/**
 * "3 out" for a tool that has several pieces, "20 bags issued" for a material, and nothing for a single
 * piece (or a row that carries no count), so a tool kept as one piece reads exactly as it always did.
 */
function qtyPhrase(L: ShareLabels, row: Loose): string {
  const qty = milli(row.qty_milli);
  if (qty == null) return '';
  const material = row.is_material === 1 || row.is_material === true;
  const total = milli(row.quantity_milli);
  if (!material && (total ?? qty) === 1000) return '';
  const unit = singleLine(row.unit, 20);
  return fill(material ? L.issuedCount : L.outCount, { n: `${formatQty(qty)}${unit ? ` ${unit}` : ''}` });
}

/** What is out now: which tool or material, how much, with whom, since when and on which project, as the Tools tab shows it. */
export function toolsOutMessage(input: ToolsOutShareInput, lang: Lang): string {
  const L = shareLabels(lang);
  const root = loose(input);
  const projectName = singleLine(root.projectName);
  const allProjects = projectName === '';

  const tools = rowsOf(root.tools);
  const lines = tools.map((t) => {
    const name = singleLine(t.name, SHARE_LIMITS.item);
    const code = singleLine(t.code, 30);
    const who = singleLine(t.with_name, SHARE_LIMITS.item);
    const since = dayText(t.since);
    return dashed(
      [name, code ? `(${code})` : ''].filter(Boolean).join(' '),
      qtyPhrase(L, t),
      who ? fill(L.withWho, { name: who }) : '',
      since ? fill(L.since, { date: since }) : '',
      allProjects ? singleLine(t.project_name, SHARE_LIMITS.item) : '',
    );
  });

  return assemble(
    L,
    dashed(L.toolsOut, allProjects ? L.allProjects : projectName),
    tools.length ? [kv(L.toolsOut, String(tools.length))] : [],
    tools.length ? [listGroup(undefined, lines, lines.length, SHARE_LIMITS.tools)] : [[L.noToolsOut]],
    root.today,
  );
}

// ---------------------------------------------------------------- a site note

/** One site note, whole (up to SHARE_LIMITS.noteFull characters), with its project, day and weather. */
export function noteMessage(input: NoteShareInput, lang: Lang): string {
  const L = shareLabels(lang);
  const root = loose(input);
  const body = paragraphs(root.body, SHARE_LIMITS.noteFull);

  return assemble(
    L,
    dashed(L.siteNote, singleLine(root.projectName)),
    [kv(L.date, dayText(root.day)), kv(L.weather, weatherText(L, root.weather))],
    body ? [[body]] : [],
    root.today,
  );
}

// ---------------------------------------------------------------- the workers list

/** The Workers tab as a message: who is on the roster (or every worker), what each is owed, and the two totals. */
export function workersListMessage(input: WorkersListShareInput, lang: Lang): string {
  const L = shareLabels(lang);
  const root = loose(input);
  const projectName = singleLine(root.projectName);
  const allProjects = projectName === '';

  const rows = rowsOf(root.rows).map((r) => ({
    name: singleLine(r.name, SHARE_LIMITS.item) || '—',
    trade: singleLine(r.trade, SHARE_LIMITS.item),
    balance: cents(r.balance_cents) ?? 0,
    active: r.active !== 0 && r.active !== false,
  }));
  const weOwe = rows.reduce((s, r) => s + Math.max(0, r.balance), 0);
  const paidAhead = rows.reduce((s, r) => s + Math.max(0, -r.balance), 0);

  const lines = rows.map((r) => dashed(r.name, r.trade, balancePhrase(L, r.balance), r.active ? '' : L.left));
  const totals = [kv(L.workers, String(rows.length)), kv(L.toPay, money(weOwe)), paidAhead > 0 ? kv(L.advanceOver, money(paidAhead)) : ''];

  return assemble(
    L,
    dashed(L.workers, allProjects ? L.allProjects : projectName),
    rows.length ? totals : [],
    rows.length ? [listGroup(undefined, lines, lines.length, SHARE_LIMITS.workers)] : [[L.noWorkers]],
    root.today,
  );
}

// ---------------------------------------------------------------- the notes list

/** A project's site notes (or every project's) as a message: the newest first, each cut to one line. */
export function notesListMessage(input: NotesListShareInput, lang: Lang): string {
  const L = shareLabels(lang);
  const root = loose(input);
  const projectName = singleLine(root.projectName);
  const allProjects = projectName === '';

  const notes = rowsOf(root.notes)
    .map((n) => dashed(dayText(n.day), allProjects ? singleLine(n.project_name, SHARE_LIMITS.item) : '', weatherText(L, n.weather), singleLine(n.body, SHARE_LIMITS.note)))
    .filter(Boolean);
  const total = Math.max(count(root.noteCount), notes.length);

  return assemble(
    L,
    dashed(L.siteNotes, allProjects ? L.allProjects : projectName),
    total ? [kv(L.siteNotes, String(total))] : [],
    total ? [listGroup(undefined, notes, total, SHARE_LIMITS.notesList)] : [[L.noNotes]],
    root.today,
  );
}

// ---------------------------------------------------------------- the title of a message

/** The first line of a message without its bold marks: a subject for e-mail and the title of the share sheet. */
export function messageTitle(message: string): string {
  return (message.split('\n', 1)[0] ?? '').replace(/\*/g, '').trim();
}

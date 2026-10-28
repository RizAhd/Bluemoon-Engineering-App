/**
 * A worker's statement as HTML, for expo-print (pdfShell.ts). Pure: the worker screen's figures
 * (v_worker_balance, one line per project from v_project_worker_balance, the whole history of
 * wage_entries) are passed in and printed as they are; nothing is added up here beyond the day count.
 *
 * The labels come from shareLabels.ts, so the statement can be printed in the worker's language
 * (English, Sinhala or Tamil) whatever the app speaks, like the estimate PDF.
 */
import type { WageKind } from '@/db/types';
import type { Lang } from '@/i18n';

import { formatDay } from '../dates';
import { formatLKR } from '../money';
import { boxes, esc, h2, pageHtml, remark, table } from '../pdfShell';
import { fill, shareLabels, type ShareLabels } from '../shareLabels';

export interface StatementProjectLine {
  name: string;
  rate_cents: number;
  days_total: number;
  earned_cents: number;
  advance_cents: number;
  paid_cents: number;
  balance_cents: number;
}

export interface StatementEntry {
  day: string;
  kind: WageKind;
  /** Days worked, for a 'work' entry. */
  days: number | null;
  amount_cents: number;
  note: string | null;
  project_name: string | null;
}

export interface WorkerStatementInput {
  worker: { name: string; trade: string | null; daily_rate_cents: number; active: number };
  /** The project the statement is for, or null for all projects. */
  projectName: string | null;
  /** v_worker_balance for all projects; that project's figures for one project. */
  totals: { earned_cents: number; advance_cents: number; paid_cents: number; balance_cents: number };
  /** One line per project (all-projects statement), in the worker screen's order. */
  projects: StatementProjectLine[];
  /** Every live wage entry in scope, newest first. */
  history: StatementEntry[];
  lang: Lang;
  letterhead: boolean;
  /** Local calendar day printed on the statement, "YYYY-MM-DD". */
  day: string;
}

/** Days of work: at most two decimals, no trailing zeros ("1", "0.5", "1.25"). */
export function daysText(days: number | null | undefined): string {
  if (typeof days !== 'number' || !Number.isFinite(days) || days <= 0) return '';
  return String(Math.round(days * 100) / 100);
}

/** "To pay Rs 3,500" / "Paid ahead Rs 500" / "Settled", as the worker screen words it. */
function balanceText(L: ShareLabels, balance: number): string {
  if (balance > 0) return `${L.toPay} ${formatLKR(balance)}`;
  if (balance < 0) return `${L.advanceOver} ${formatLKR(-balance)}`;
  return L.settled;
}

export function buildWorkerStatementHtml(input: WorkerStatementInput): string {
  const { worker, totals, projects, history, lang, letterhead, day } = input;
  const L = shareLabels(lang);
  const t = (key: keyof ShareLabels) => esc(L[key]);
  const money = (cents: number) => esc(formatLKR(cents));
  const oneProject = input.projectName != null;

  const subtitle = [worker.trade, worker.daily_rate_cents > 0 ? `${L.dailyRate} ${formatLKR(worker.daily_rate_cents)}` : '', worker.active ? '' : L.left]
    .filter(Boolean)
    .join(' · ');

  const sections: string[] = [];
  sections.push(
    boxes([
      [t('earned'), money(totals.earned_cents)],
      [t('advances'), money(totals.advance_cents)],
      [t('paid'), money(totals.paid_cents)],
      [esc(totals.balance_cents > 0 ? L.toPay : totals.balance_cents < 0 ? L.advanceOver : L.balance), totals.balance_cents === 0 ? t('settled') : money(Math.abs(totals.balance_cents))],
    ]),
  );
  sections.push(remark(`${t('project')}: ${esc(input.projectName ?? L.allProjects)}`));

  if (!oneProject && projects.length) {
    sections.push(h2(L.byProject, projects.length));
    sections.push(
      table(
        [
          { label: t('project') },
          { label: t('dailyRate'), num: true, width: '13%' },
          { label: t('days'), num: true, width: '9%' },
          { label: t('earned'), num: true, width: '15%' },
          { label: t('advances'), num: true, width: '15%' },
          { label: t('paid'), num: true, width: '15%' },
          { label: t('balance'), num: true, width: '16%' },
        ],
        projects.map((p) => [
          esc(p.name),
          money(p.rate_cents),
          esc(daysText(p.days_total)),
          money(p.earned_cents),
          money(p.advance_cents),
          money(p.paid_cents),
          esc(balanceText(L, p.balance_cents)),
        ]),
      ),
    );
  }

  sections.push(h2(L.history, history.length));
  if (history.length) {
    const kindLabel: Record<WageKind, string> = { work: L.wage_work, advance: L.wage_advance, payment: L.wage_payment };
    sections.push(
      table(
        [
          { label: t('date'), width: '16%' },
          { label: t('kind'), width: '13%' },
          { label: t('days'), num: true, width: '8%' },
          ...(oneProject ? [] : [{ label: t('project'), width: '22%' }]),
          { label: t('note') },
          { label: t('amount'), num: true, width: '18%' },
        ],
        history.map((e) => [
          esc(formatDay(e.day)),
          esc(kindLabel[e.kind] ?? e.kind),
          e.kind === 'work' ? esc(daysText(e.days)) : '',
          ...(oneProject ? [] : [esc(e.project_name ?? '')]),
          esc(e.note ?? ''),
          `${e.kind === 'work' ? '+' : '−'}${money(e.amount_cents)}`,
        ]),
      ),
    );
  } else {
    sections.push(remark(t('noHistory')));
  }

  return pageHtml({
    title: worker.name,
    subtitle,
    kicker: `${L.statement} · ${formatDay(day)}`,
    letterhead,
    lang,
    body: sections.join('\n      '),
    footer: `${L.footer} · ${fill(L.printedOn, { date: formatDay(day) })}`,
  });
}

/**
 * The Workers tab as HTML, for expo-print (pdfShell.ts): a project's roster with the rate, days and
 * balance of each worker there (v_project_worker_balance), or every worker with their own rate and
 * overall balance (v_worker_balance), and a totals row. Pure: the rows are printed as they are, only
 * the totals row adds the columns up.
 */
import type { TKey } from '@/i18n';

import { formatDay } from '../dates';
import { formatLKR } from '../money';
import { boxes, esc, h2, pageHtml, remark, table } from '../pdfShell';
import { daysText } from './workerStatementHtml';

export interface WorkerLine {
  name: string;
  trade: string | null;
  /** The rate on the project, or the worker's own daily rate with "All projects". */
  rate_cents: number;
  days_total: number;
  earned_cents: number;
  advance_cents: number;
  paid_cents: number;
  balance_cents: number;
  active: number;
}

export interface WorkersListInput {
  /** The project, or null for all projects. */
  projectName: string | null;
  /** Working first, then those who left; by name. */
  rows: WorkerLine[];
  letterhead: boolean;
  t: (key: TKey, vars?: Record<string, string | number>) => string;
  /** Local calendar day printed on the page, "YYYY-MM-DD". */
  day: string;
}

export function buildWorkersListHtml(input: WorkersListInput): string {
  const { rows, letterhead, day } = input;
  const t = (k: TKey) => esc(input.t(k));
  const money = (cents: number) => esc(formatLKR(cents));
  const sum = (f: (r: WorkerLine) => number) => rows.reduce((s, r) => s + f(r), 0);
  const weOwe = sum((r) => Math.max(0, r.balance_cents));
  const paidAhead = sum((r) => Math.max(0, -r.balance_cents));

  const balanceCell = (b: number) => (b > 0 ? `${money(b)} <span class="tag out">${t('weOwe')}</span>` : b < 0 ? `${money(-b)} <span class="tag">${t('workerOwes')}</span>` : t('settled'));

  const sections: string[] = [];
  sections.push(
    boxes([
      [t('workers'), String(rows.length)],
      [t('weOwe'), money(weOwe)],
      [t('workerOwes'), money(paidAhead)],
    ]),
  );

  sections.push(h2(input.projectName ? t('projectWorkers') : t('allWorkers'), rows.length));
  if (rows.length) {
    sections.push(
      table(
        [
          { label: t('name') },
          { label: t('dailyRate'), num: true, width: '12%' },
          { label: t('days'), num: true, width: '8%' },
          { label: t('earned'), num: true, width: '14%' },
          { label: t('advances'), num: true, width: '13%' },
          { label: t('paid'), num: true, width: '14%' },
          { label: t('balance'), num: true, width: '19%' },
        ],
        rows.map((r) => [
          `${esc(r.name)}${r.active ? '' : ` <span class="tag">${t('workerLeft')}</span>`}${r.trade ? `<div class="muted small">${esc(r.trade)}</div>` : ''}`,
          money(r.rate_cents),
          esc(daysText(r.days_total)),
          money(r.earned_cents),
          money(r.advance_cents),
          money(r.paid_cents),
          balanceCell(r.balance_cents),
        ]),
        '',
        [t('total'), '', esc(daysText(sum((r) => r.days_total))), money(sum((r) => r.earned_cents)), money(sum((r) => r.advance_cents)), money(sum((r) => r.paid_cents)), money(sum((r) => r.balance_cents))],
      ),
    );
  } else {
    sections.push(remark(t('noWorkers')));
  }

  return pageHtml({
    title: input.t('workers'),
    subtitle: input.projectName ?? input.t('allProjects'),
    kicker: `${input.t('pdfWorkersList')} · ${formatDay(day)}`,
    letterhead,
    body: sections.join('\n      '),
    footer: `${input.t('pdfFooter')} · ${input.t('printedOn', { date: formatDay(day) })}`,
  });
}

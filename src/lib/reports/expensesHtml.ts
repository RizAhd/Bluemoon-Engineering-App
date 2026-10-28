/**
 * The Expenses tab as HTML, for expo-print (pdfShell.ts): every expense that matches the tab's filters
 * (not only the page the list shows), in the tab's order, with the total and the count the tab shows.
 * Pure: the rows, the total and the filter labels are passed in and printed as they are.
 */
import type { Expense } from '@/db/types';
import type { TKey } from '@/i18n';

import { formatDay } from '../dates';
import { formatLKR } from '../money';
import { boxes, esc, h2, metaLine, pageHtml, remark, table } from '../pdfShell';

export type ExpenseLine = Pick<Expense, 'day' | 'category' | 'amount_cents' | 'paid_to' | 'method' | 'note'> & { project_name: string | null };

export interface ExpensesHtmlInput {
  /** The project, or null for all projects. */
  projectName: string | null;
  /** The rows in the order chosen on the tab. */
  rows: ExpenseLine[];
  /** The total and number of the rows (the tab's "Total" tile), from the database. */
  totalCents: number;
  count: number;
  /** The filters the list was made with, as the tab labels them: period, categories, methods, amounts, order. */
  filters: { label: string; value: string }[];
  letterhead: boolean;
  t: (key: TKey, vars?: Record<string, string | number>) => string;
  /** Local calendar day printed on the page, "YYYY-MM-DD". */
  day: string;
}

export function buildExpensesHtml(input: ExpensesHtmlInput): string {
  const { rows, letterhead, day } = input;
  const t = (k: TKey) => esc(input.t(k));
  const allProjects = input.projectName == null;

  const sections: string[] = [];
  sections.push(boxes([[t('total'), esc(formatLKR(input.totalCents))], [t('entries'), String(input.count)]]));
  sections.push(metaLine(input.filters.map((f) => [esc(f.label), esc(f.value)])));

  sections.push(h2(t('expenses'), rows.length));
  if (rows.length) {
    sections.push(
      table(
        [
          { label: t('date'), width: '15%' },
          { label: t('category'), width: '15%' },
          { label: t('paidTo') },
          ...(allProjects ? [{ label: t('project'), width: '20%' }] : []),
          { label: t('method'), width: '11%' },
          { label: t('amount'), num: true, width: '17%' },
        ],
        rows.map((e) => [
          esc(formatDay(e.day)),
          t(`cat_${e.category}` as TKey),
          `${esc(e.paid_to ?? '')}${e.note ? `<div class="muted small">${esc(e.note)}</div>` : ''}`,
          ...(allProjects ? [esc(e.project_name ?? '')] : []),
          t(`method_${e.method}` as TKey),
          esc(formatLKR(e.amount_cents)),
        ]),
        '',
        [t('total'), '', '', ...(allProjects ? [''] : []), '', esc(formatLKR(input.totalCents))],
      ),
    );
  } else {
    sections.push(remark(t('noMatches')));
  }

  return pageHtml({
    title: input.t('expenses'),
    subtitle: input.projectName ?? input.t('allProjects'),
    kicker: `${input.t('pdfExpenses')} · ${formatDay(day)}`,
    letterhead,
    body: sections.join('\n      '),
    footer: `${input.t('pdfFooter')} · ${input.t('printedOn', { date: formatDay(day) })}`,
  });
}

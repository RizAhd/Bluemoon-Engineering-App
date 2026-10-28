/**
 * One day's work and pay on one project as HTML, for expo-print (pdfShell.ts): the rows of v_wage_day
 * with the workers' names, what was paid that day and what is still unpaid, totals, and two signature
 * lines so the sheet can be signed on site. Pure: the unpaid figure per worker is worked out by the
 * loader with unpaidForWorker (src/lib/wages.ts), the same rule as the Today card and the wage sheet.
 */
import type { TKey } from '@/i18n';

import { formatDay } from '../dates';
import { formatLKR } from '../money';
import { boxes, esc, h2, pageHtml, remark, signatures, table } from '../pdfShell';
import { daysText } from './workerStatementHtml';

export interface DaySheetLine {
  name: string;
  /** null when nothing was worked that day (only a payment or an advance). */
  days: number | null;
  work_cents: number;
  paid_cents: number;
  advance_cents: number;
  /** Still owed for this day's work: unpaidForWorker, 0 for a worker who is off the roster. */
  unpaid_cents: number;
}

export interface DaySheetInput {
  projectName: string;
  /** The day of the sheet, "YYYY-MM-DD". */
  sheetDay: string;
  rows: DaySheetLine[];
  letterhead: boolean;
  t: (key: TKey, vars?: Record<string, string | number>) => string;
  /** Local calendar day printed on the page, "YYYY-MM-DD". */
  day: string;
}

export function buildDaySheetHtml(input: DaySheetInput): string {
  const { rows, letterhead, day } = input;
  const t = (k: TKey) => esc(input.t(k));
  const money = (cents: number) => esc(formatLKR(cents));
  const sum = (f: (r: DaySheetLine) => number) => rows.reduce((s, r) => s + f(r), 0);
  const worked = rows.filter((r) => r.days != null);
  const totalDays = Math.round(sum((r) => r.days ?? 0) * 100) / 100;
  const advances = sum((r) => r.advance_cents);

  const sections: string[] = [];
  // The sheet can be printed for any day, so the words are "paid" and "unpaid", not the screen's "paid today".
  sections.push(
    boxes([
      [t('workers'), String(worked.length)],
      [t('wages'), money(sum((r) => r.work_cents))],
      [t('paid'), money(sum((r) => r.paid_cents))],
      [t('unpaid'), money(sum((r) => r.unpaid_cents))],
    ]),
  );

  sections.push(h2(t('todaysWork'), rows.length));
  if (rows.length) {
    sections.push(
      table(
        [
          { label: t('name') },
          { label: t('days'), num: true, width: '9%' },
          { label: t('wages'), num: true, width: '16%' },
          { label: t('paid'), num: true, width: '16%' },
          ...(advances > 0 ? [{ label: t('advances'), num: true, width: '15%' }] : []),
          { label: t('unpaid'), num: true, width: '16%' },
        ],
        rows.map((r) => [
          esc(r.name),
          r.days == null ? esc(input.t('notWorked')) : esc(daysText(r.days)),
          money(r.work_cents),
          money(r.paid_cents),
          ...(advances > 0 ? [money(r.advance_cents)] : []),
          money(r.unpaid_cents),
        ]),
        '',
        [t('total'), esc(daysText(totalDays)), money(sum((r) => r.work_cents)), money(sum((r) => r.paid_cents)), ...(advances > 0 ? [money(advances)] : []), money(sum((r) => r.unpaid_cents))],
      ),
    );
  } else {
    sections.push(remark(t('noWorkRecorded')));
  }
  sections.push(signatures([t('supervisor'), t('checkedBy')]));

  return pageHtml({
    title: input.projectName,
    subtitle: `${input.t('date')}: ${formatDay(input.sheetDay)}`,
    kicker: `${input.t('pdfDaySheet')} · ${formatDay(input.sheetDay)}`,
    letterhead,
    body: sections.join('\n      '),
    footer: `${input.t('pdfFooter')} · ${input.t('printedOn', { date: formatDay(day) })}`,
  });
}

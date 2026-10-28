/**
 * The tools register as HTML, for expo-print (pdfShell.ts): every live tool from v_tool_status with
 * whether it is out or in store, who has it, on which project and since when. Pure: the rows are
 * printed as they are; the counts are those of the Tools tab.
 */
import type { TKey } from '@/i18n';

import { formatDay } from '../dates';
import { boxes, esc, h2, pageHtml, remark, table } from '../pdfShell';

export interface ToolLine {
  name: string;
  code: string | null;
  is_out: number;
  /** The worker, or the name typed for someone outside the company. */
  with_name: string | null;
  project_name: string | null;
  /** The day of the last movement, "YYYY-MM-DD". */
  last_day: string | null;
  condition: string | null;
}

export interface ToolsRegisterInput {
  /** Out first, then in store; by name. */
  rows: ToolLine[];
  letterhead: boolean;
  t: (key: TKey, vars?: Record<string, string | number>) => string;
  /** Local calendar day printed on the page, "YYYY-MM-DD". */
  day: string;
}

export function buildToolsRegisterHtml(input: ToolsRegisterInput): string {
  const { rows, letterhead, day } = input;
  const t = (k: TKey) => esc(input.t(k));
  const out = rows.filter((r) => r.is_out);
  const inStore = rows.filter((r) => !r.is_out);

  const sections: string[] = [];
  sections.push(
    boxes([
      [t('tools'), String(rows.length)],
      [t('out'), String(out.length)],
      [t('inStore'), String(inStore.length)],
    ]),
  );

  sections.push(h2(t('tools'), rows.length));
  if (rows.length) {
    sections.push(
      table(
        [
          { label: t('tool') },
          { label: t('code'), width: '14%' },
          { label: t('status'), width: '13%' },
          { label: t('outWith'), width: '20%' },
          { label: t('project'), width: '20%' },
          { label: t('date'), width: '14%' },
        ],
        rows.map((r) => [
          esc(r.name),
          esc(r.code ?? ''),
          r.is_out ? `<span class="tag out">${t('out')}</span>` : `<span class="tag in">${t('inStore')}</span>`,
          r.is_out ? `${esc(r.with_name ?? '')}${r.condition ? `<div class="muted small">${esc(r.condition)}</div>` : ''}` : '',
          r.is_out ? esc(r.project_name ?? '') : '',
          r.last_day ? esc(formatDay(r.last_day)) : '',
        ]),
      ),
    );
  } else {
    sections.push(remark(t('noTools')));
  }

  return pageHtml({
    title: input.t('tools'),
    subtitle: input.t('toolsRegisterHint'),
    kicker: `${input.t('pdfToolsRegister')} · ${formatDay(day)}`,
    letterhead,
    body: sections.join('\n      '),
    footer: `${input.t('pdfFooter')} · ${input.t('printedOn', { date: formatDay(day) })}`,
  });
}

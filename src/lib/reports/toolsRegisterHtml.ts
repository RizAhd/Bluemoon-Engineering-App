/**
 * The tools register as HTML, for expo-print (pdfShell.ts): every live tool and material (v_tool_stock) with how many
 * are in store and out, and who has them (v_tool_holders), on which project and since when. A tool kept as one piece
 * reads as it always has (a tag "Out" or "In store"); one with several pieces says "7 of 10 in store" and "3 out", a
 * material "80 bags left" and "20 bags issued". Pure: the rows are printed as they are; the counts are those of the
 * Tools tab.
 */
import type { TKey } from '@/i18n';

import { formatDay } from '../dates';
import { boxes, esc, h2, pageHtml, remark, table } from '../pdfShell';
import { isSinglePiece, qtyText } from '../toolStock';

/** Who has some of a tool: one line of v_tool_holders. */
export interface ToolHolderLine {
  /** The worker, or the name typed for someone outside the company. */
  with_name: string | null;
  project_name: string | null;
  /** How much they have (thousandths). */
  qty_milli: number;
  /** The day of the last issue to them, "YYYY-MM-DD". */
  since: string | null;
}

export interface ToolLine {
  name: string;
  code: string | null;
  /** "bags", "kg" ... or null for plain pieces. */
  unit: string | null;
  /** 1 for a material (issued and used up). */
  is_material: number;
  /** The total (thousandths: 1000 = one piece). */
  quantity_milli: number;
  out_milli: number;
  in_store_milli: number;
  /** The last condition noted on a movement ("Good", "One rung loose"). */
  condition: string | null;
  holders: ToolHolderLine[];
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
  // the Tools tab's chips count tools the same way: a tool with some out and some in store is in both
  const out = rows.filter((r) => r.out_milli > 0);
  const inStore = rows.filter((r) => r.in_store_milli > 0);

  /** The "in store" cell: a tag for one piece, else the count in words. */
  const inStoreCell = (r: ToolLine): string => {
    if (isSinglePiece(r)) return r.out_milli > 0 ? '' : `<span class="tag in">${t('inStore')}</span>`;
    if (r.is_material) return esc(r.in_store_milli > 0 ? input.t('leftCount', { n: qtyText(r.in_store_milli, r.unit) }) : input.t('outOfStock'));
    return esc(input.t('inStoreOf', { n: qtyText(r.in_store_milli), total: qtyText(r.quantity_milli, r.unit) }));
  };
  /** The "out" cell: a tag for one piece, else how many are out. */
  const outCell = (r: ToolLine): string => {
    if (r.out_milli <= 0) return '';
    if (isSinglePiece(r)) return `<span class="tag out">${t('out')}</span>`;
    return esc(input.t(r.is_material ? 'issuedCount' : 'outCount', { n: qtyText(r.out_milli, r.unit) }));
  };
  /** Who has them: a line each with the project and the day; with several pieces the count they have. */
  const holdersCell = (r: ToolLine): string => {
    if (r.out_milli <= 0) return '';
    const single = isSinglePiece(r);
    const lines = r.holders.map((h) => {
      const parts = [h.with_name, h.project_name, h.since ? formatDay(h.since) : null, single ? null : qtyText(h.qty_milli, r.unit)].filter(Boolean) as string[];
      return `<div>${parts.map(esc).join(' · ')}</div>`;
    });
    const condition = r.condition ? `<div class="muted small">${esc(r.condition)}</div>` : '';
    return `${lines.join('')}${condition}`;
  };

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
          { label: t('tool'), width: '26%' },
          { label: t('inStore'), width: '18%' },
          { label: t('out'), width: '14%' },
          { label: t('heldBy') },
        ],
        rows.map((r) => [
          `${esc(r.name)}${r.code ? `<div class="muted small">${esc(r.code)}</div>` : ''}`,
          inStoreCell(r),
          outCell(r),
          holdersCell(r),
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

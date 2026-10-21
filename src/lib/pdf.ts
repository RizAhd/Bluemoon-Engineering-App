/**
 * Project PDF hand-off.
 *
 * Export: expo-print renders a readable report from HTML (the phone's own fonts
 * shape Sinhala and Tamil correctly). pdf-lib then embeds the project data as
 * `bluemoon-data.json`, its SHA-256, and every photo, as PDF file attachments
 * (the same mechanism e-invoices use). Any PDF viewer shows the report; the
 * Bluemoon app reads the attachments back.
 *
 * Import: no internet, no AI. Read the attachments, check the hash, merge rows.
 */
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFString,
  type PDFObject,
} from 'pdf-lib';

import { deviceId, first } from '@/db';
import type { Expense, Project, ProjectCost, SiteNote, ToolMovement, WageEntry } from '@/db/types';
import { tNow, type TKey } from '@/i18n';
import { formatDay, nowIso } from '@/lib/dates';
import { formatLKR } from '@/lib/money';

import { BUNDLE_FORMAT, BUNDLE_VERSION, collectProject, filesOf, readFileBytes, sha256Hex, type Bundle } from './bundle';
import { decodeUtf8, encodeUtf8 } from './utf8';

const DATA_NAME = 'bluemoon-data.json';
const HASH_NAME = 'bluemoon-data.sha256';

// ---------------------------------------------------------------- export

export async function exportProjectPdf(projectId: string, opts: { includePhotos: boolean }): Promise<File> {
  const project = first<Project>('SELECT * FROM projects WHERE id = ?', [projectId]);
  if (!project) throw new Error('Project not found');

  const tables = collectProject(projectId);
  const bundle: Bundle = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    kind: 'project',
    exported_at: nowIso(),
    device_id: deviceId(),
    project_id: projectId,
    project_name: project.name,
    tables,
  };

  const html = reportHtml(project, tables);
  const printed = await Print.printToFileAsync({ html, base64: false });
  const doc = await PDFDocument.load(new File(printed.uri).bytesSync());

  const json = encodeUtf8(JSON.stringify(bundle));
  const hash = await sha256Hex(json);
  const now = new Date();
  doc.setTitle(`${project.name} — Bluemoon Engineering`);
  doc.setCreator('Bluemoon Engineering site app');
  doc.setSubject(`${BUNDLE_FORMAT} v${BUNDLE_VERSION}`);
  await doc.attach(json, DATA_NAME, { mimeType: 'application/json', description: 'Bluemoon project data', creationDate: now, modificationDate: now });
  await doc.attach(encodeUtf8(hash), HASH_NAME, { mimeType: 'text/plain', creationDate: now, modificationDate: now });

  if (opts.includePhotos) {
    for (const att of filesOf(tables)) {
      await doc.attach(readFileBytes(att), att.file_name, { mimeType: att.mime, creationDate: now, modificationDate: now });
    }
  }

  const bytes = await doc.save({ useObjectStreams: true });
  new File(printed.uri).delete();

  const safe = project.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project';
  const out = new File(Paths.cache, `Bluemoon-${safe}-${now.toISOString().slice(0, 10)}.pdf`);
  if (out.exists) out.delete();
  out.create();
  out.writeSync(bytes);
  return out;
}

// ---------------------------------------------------------------- import

export type PdfReadResult =
  | { status: 'ok'; bundle: Bundle; files: Map<string, Uint8Array> }
  | { status: 'not-ours' }
  | { status: 'damaged' }
  | { status: 'newer' };

export async function readProjectPdf(bytes: Uint8Array): Promise<PdfReadResult> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  } catch {
    return { status: 'not-ours' };
  }
  const files = embeddedFiles(doc);
  const data = files.get(DATA_NAME);
  if (!data) return { status: 'not-ours' };

  const expected = files.get(HASH_NAME);
  const actual = await sha256Hex(data);
  if (!expected || decodeUtf8(expected).trim() !== actual) return { status: 'damaged' };

  let bundle: Bundle;
  try {
    bundle = JSON.parse(decodeUtf8(data));
  } catch {
    return { status: 'damaged' };
  }
  if (bundle.format !== BUNDLE_FORMAT) return { status: 'not-ours' };
  if (bundle.version > BUNDLE_VERSION) return { status: 'newer' };

  files.delete(DATA_NAME);
  files.delete(HASH_NAME);
  return { status: 'ok', bundle, files };
}

/** Walk the PDF's EmbeddedFiles name tree and return name → bytes. */
function embeddedFiles(doc: PDFDocument): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  const tree = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
  if (tree) walk(tree, out);
  return out;
}

function walk(node: PDFDict, out: Map<string, Uint8Array>) {
  const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray);
  if (kids) for (let i = 0; i < kids.size(); i++) walk(kids.lookup(i, PDFDict), out);

  const arr = node.lookupMaybe(PDFName.of('Names'), PDFArray);
  if (!arr) return;
  for (let i = 0; i + 1 < arr.size(); i += 2) {
    const name = decodeName(arr.lookup(i));
    const spec = arr.lookup(i + 1, PDFDict);
    const ef = spec.lookupMaybe(PDFName.of('EF'), PDFDict);
    const stream = ef?.lookup(PDFName.of('F'));
    if (name && stream instanceof PDFRawStream) out.set(name, decodePDFRawStream(stream).decode());
  }
}

function decodeName(obj: PDFObject | undefined): string | null {
  if (obj instanceof PDFString || obj instanceof PDFHexString) return obj.decodeText();
  return null;
}

// ---------------------------------------------------------------- readable report

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] as string);
}

function reportHtml(p: Project, tables: Bundle['tables']): string {
  const t = (k: TKey) => esc(tNow(k));
  const live = <T extends { deleted_at: string | null }>(rows: unknown[] | undefined) =>
    ((rows ?? []) as T[]).filter((r) => !r.deleted_at);
  const expenses = live<Expense>(tables.expenses).sort((a, b) => a.day.localeCompare(b.day));
  const wages = live<WageEntry>(tables.wage_entries);
  const moves = live<ToolMovement>(tables.tool_movements).sort((a, b) => a.day.localeCompare(b.day));
  const notes = live<SiteNote>(tables.site_notes).sort((a, b) => a.day.localeCompare(b.day));
  const workerName = new Map(((tables.workers ?? []) as { id: string; name: string }[]).map((w) => [w.id, w.name]));
  const toolName = new Map(((tables.tools ?? []) as { id: string; name: string }[]).map((w) => [w.id, w.name]));
  const cost = first<ProjectCost>('SELECT * FROM v_project_cost WHERE project_id = ?', [p.id]);
  const photoCount = filesOf(tables).length;

  const byCat = new Map<string, number>();
  expenses.forEach((e) => byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount_cents));

  const byWorker = new Map<string, { work: number; given: number; days: number }>();
  wages.forEach((w) => {
    const r = byWorker.get(w.worker_id) ?? { work: 0, given: 0, days: 0 };
    if (w.kind === 'work') {
      r.work += w.amount_cents;
      r.days += w.days ?? 0;
    } else r.given += w.amount_cents;
    byWorker.set(w.worker_id, r);
  });

  const total = (cost?.expense_cents ?? 0) + (cost?.labour_cents ?? 0);
  const rows = (cells: string[][]) => cells.map((c) => `<tr>${c.map((x) => `<td>${x}</td>`).join('')}</tr>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { margin: 18mm 14mm; }
  body { font-family: 'Noto Sans', 'Noto Sans Sinhala', 'Noto Sans Tamil', sans-serif; color: #0F172A; font-size: 11pt; }
  .brand { display:flex; justify-content:space-between; align-items:flex-end; border-bottom: 3px solid #C2410C; padding-bottom: 8px; }
  .brand h1 { margin:0; font-size: 20pt; }
  .brand small { color:#475569; }
  h2 { font-size: 13pt; margin: 22px 0 8px; color:#334155; }
  table { width:100%; border-collapse: collapse; }
  td { padding: 5px 6px; border-bottom: 1px solid #E2E8F0; vertical-align: top; }
  tr:first-child td { font-weight: 700; background:#F1F5F9; }
  td.n, .n { text-align:right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .grid { display:flex; gap:10px; margin-top: 12px; }
  .box { flex:1; border:1px solid #E2E8F0; border-radius:8px; padding:8px 10px; }
  .box b { display:block; font-size: 14pt; }
  .muted { color:#475569; }
  table.plain tr:first-child td { font-weight: 400; background: none; }
  .foot { margin-top: 24px; font-size: 8.5pt; color:#64748B; }
  </style></head><body>
  <div class="brand"><div><small>Bluemoon Engineering (Pvt) Ltd</small><h1>${esc(p.name)}</h1>
  <div class="muted">${[p.client, p.location].filter(Boolean).map(esc).join(' · ')}</div></div>
  <small>${esc(formatDay(new Date().toISOString().slice(0, 10)))}</small></div>

  <div class="grid">
    <div class="box">${t('totalCost')}<b class="n">${esc(formatLKR(total))}</b></div>
    <div class="box">${t('materialsAndOther')}<b class="n">${esc(formatLKR(cost?.expense_cents ?? 0))}</b></div>
    <div class="box">${t('labour')}<b class="n">${esc(formatLKR(cost?.labour_cents ?? 0))}</b></div>
    ${p.contract_cents ? `<div class="box">${t('contract')}<b class="n">${esc(formatLKR(p.contract_cents))}</b></div>` : ''}
  </div>

  <h2>${t('byCategory')}</h2>
  <table>${rows([[t('category'), `<span class="n">${t('amount')}</span>`]])}
  ${[...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([c, v]) => `<tr><td>${t(`cat_${c}` as TKey)}</td><td class="n">${esc(formatLKR(v))}</td></tr>`).join('')}</table>

  <h2>${t('expenses')} (${expenses.length})</h2>
  <table>${rows([[t('date'), t('category'), t('paidTo'), t('method'), `<span class="n">${t('amount')}</span>`]])}
  ${expenses.map((e) => `<tr><td>${esc(formatDay(e.day))}</td><td>${t(`cat_${e.category}` as TKey)}</td><td>${esc(e.paid_to ?? '')}${e.note ? `<div class="muted">${esc(e.note)}</div>` : ''}</td><td>${t(`method_${e.method}` as TKey)}</td><td class="n">${esc(formatLKR(e.amount_cents))}</td></tr>`).join('')}</table>

  ${byWorker.size ? `<h2>${t('workers')}</h2><table>${rows([[t('name'), `<span class="n">${t('days')}</span>`, `<span class="n">${t('earned')}</span>`, `<span class="n">${t('paid')}</span>`]])}
  ${[...byWorker.entries()].map(([id, r]) => `<tr><td>${esc(workerName.get(id) ?? '')}</td><td class="n">${r.days}</td><td class="n">${esc(formatLKR(r.work))}</td><td class="n">${esc(formatLKR(r.given))}</td></tr>`).join('')}</table>` : ''}

  ${moves.length ? `<h2>${t('tools')}</h2><table>${rows([[t('date'), t('tool'), '', t('takenBy')]])}
  ${moves.map((m) => `<tr><td>${esc(formatDay(m.day))}</td><td>${esc(toolName.get(m.tool_id) ?? '')}</td><td>${t(m.kind === 'issue' ? 'issue' : 'return')}</td><td>${esc(m.worker_id ? workerName.get(m.worker_id) ?? '' : m.taken_by ?? '')}</td></tr>`).join('')}</table>` : ''}

  ${notes.length ? `<h2>${t('siteNotes')}</h2><table class="plain">${notes.map((n) => `<tr><td style="width:22%">${esc(formatDay(n.day))}</td><td>${esc(n.body)}</td></tr>`).join('')}</table>` : ''}

  <div class="foot">${photoCount} photos · Made with the Bluemoon Engineering site app. Open this PDF in the app (Import PDF) to load all records.</div>
  </body></html>`;
}

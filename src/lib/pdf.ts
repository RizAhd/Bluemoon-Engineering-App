/**
 * Project PDF hand-off.
 *
 * Export: expo-print renders a readable report from HTML (the phone's own fonts
 * shape Sinhala and Tamil correctly). With the letterhead option every page is then
 * placed on the company letterhead. pdf-lib embeds the project data as
 * `bluemoon-data.json`, its SHA-256, and every photo, as PDF file attachments
 * (the same mechanism e-invoices use). Any PDF viewer shows the report; the
 * Bluemoon app reads the attachments back.
 *
 * Import: no internet, no AI. Read the attachments, check the hash, merge rows.
 */
import { Asset } from 'expo-asset';
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
import type { Attachment, Project, ProjectCost } from '@/db/types';
import { tNow } from '@/i18n';
import { nowIso, today } from '@/lib/dates';
import { reportError } from '@/lib/errors';

import { BUNDLE_FORMAT, BUNDLE_VERSION, collectProject, filesOf, readFileBytes, sha256Hex, type Bundle } from './bundle';
import { A4_H, A4_W, applyLetterhead } from './letterhead';
import { buildReportHtml } from './reportHtml';
import { decodeUtf8, encodeUtf8 } from './utf8';

const DATA_NAME = 'bluemoon-data.json';
const HASH_NAME = 'bluemoon-data.sha256';
/** Every photo is held in memory while the PDF is built; more than this risks an out-of-memory kill. */
export const MAX_PDF_PHOTOS = 60;

// ---------------------------------------------------------------- export

export interface ExportOptions {
  includePhotos: boolean;
  /** Print every page on the company letterhead. */
  letterhead?: boolean;
  /** Told when something optional could not be done, so the UI can say so. */
  onNotice?: (notice: 'letterhead-unavailable') => void;
}

let letterheadCache: Uint8Array | null = null;

/** The letterhead picture (bundled with the app). Cached after the first load. */
async function loadLetterhead(): Promise<Uint8Array> {
  if (letterheadCache) return letterheadCache;
  const asset = Asset.fromModule(require('../../assets/brand/letterhead.jpeg'));
  await asset.downloadAsync();
  const uri = asset.localUri;
  if (!uri) throw new Error('letterhead asset has no local file');
  const bytes = await new File(uri).bytes();
  if (bytes.byteLength < 1000) throw new Error('letterhead asset is empty');
  letterheadCache = bytes;
  return bytes;
}

export async function exportProjectPdf(projectId: string, opts: ExportOptions): Promise<File> {
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

  const photos = opts.includePhotos ? filesOf(tables).slice(0, MAX_PDF_PHOTOS) : [];
  const skipped = opts.includePhotos ? Math.max(0, filesOf(tables).length - photos.length) : 0;

  // The letterhead is optional: if its picture cannot be read, export the plain report and say so.
  let letterhead: Uint8Array | null = null;
  if (opts.letterhead) {
    try {
      letterhead = await loadLetterhead();
    } catch (e) {
      reportError(e, 'pdf.letterhead.load');
      opts.onNotice?.('letterhead-unavailable');
    }
  }

  const html = buildReportHtml({
    project,
    tables,
    cost: first<ProjectCost>('SELECT * FROM v_project_cost WHERE project_id = ?', [project.id]),
    photoCount: photos.length,
    skippedPhotos: skipped,
    letterhead: letterhead != null,
    t: tNow,
    day: today(),
  });
  // A4 explicitly: expo-print defaults to US Letter.
  const printed = await Print.printToFileAsync({ html, base64: false, width: Math.round(A4_W), height: Math.round(A4_H) });
  try {
    return await buildPdf(printed.uri, project, bundle, photos, letterhead, opts.onNotice);
  } finally {
    try {
      const tmp = new File(printed.uri);
      if (tmp.exists) tmp.delete();
    } catch {
      // temp file already gone
    }
  }
}

async function buildPdf(
  printedUri: string,
  project: Project,
  bundle: Bundle,
  photos: Attachment[],
  letterhead: Uint8Array | null,
  onNotice?: ExportOptions['onNotice'],
): Promise<File> {
  let report = new File(printedUri).bytesSync();
  if (letterhead) {
    try {
      report = await applyLetterhead(report, letterhead);
    } catch (e) {
      // keep the plain pages rather than failing the whole export
      reportError(e, 'pdf.letterhead.apply');
      onNotice?.('letterhead-unavailable');
    }
  }
  const doc = await PDFDocument.load(report);

  const json = encodeUtf8(JSON.stringify(bundle));
  const hash = await sha256Hex(json);
  const now = new Date();
  doc.setTitle(`${project.name} — Bluemoon Engineering`);
  doc.setCreator('Bluemoon Engineering site app');
  doc.setSubject(`${BUNDLE_FORMAT} v${BUNDLE_VERSION}`);
  await doc.attach(json, DATA_NAME, { mimeType: 'application/json', description: 'Bluemoon project data', creationDate: now, modificationDate: now });
  await doc.attach(encodeUtf8(hash), HASH_NAME, { mimeType: 'text/plain', creationDate: now, modificationDate: now });

  for (const att of photos) {
    await doc.attach(readFileBytes(att), att.file_name, { mimeType: att.mime, creationDate: now, modificationDate: now });
  }

  const bytes = await doc.save({ useObjectStreams: true });

  const safe = project.name.replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project';
  const out = new File(Paths.cache, `Bluemoon-${safe}-${today()}.pdf`);
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
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
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
  } catch {
    // a foreign or encrypted PDF is simply not ours
    return { status: 'not-ours' };
  }
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
  if (kids) {
    for (let i = 0; i < kids.size(); i++) {
      const kid = kids.lookupMaybe(i, PDFDict);
      if (kid) walk(kid, out);
    }
  }

  const arr = node.lookupMaybe(PDFName.of('Names'), PDFArray);
  if (!arr) return;
  for (let i = 0; i + 1 < arr.size(); i += 2) {
    try {
      const name = decodeName(arr.lookup(i));
      const spec = arr.lookupMaybe(i + 1, PDFDict);
      const ef = spec?.lookupMaybe(PDFName.of('EF'), PDFDict);
      const stream = ef?.lookup(PDFName.of('F'));
      if (name && stream instanceof PDFRawStream) out.set(name, decodePDFRawStream(stream).decode());
    } catch {
      // skip an entry we cannot read
    }
  }
}

function decodeName(obj: PDFObject | undefined): string | null {
  if (obj instanceof PDFString || obj instanceof PDFHexString) return obj.decodeText();
  return null;
}

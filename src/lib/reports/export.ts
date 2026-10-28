/**
 * The PDF of each list, made and written in one call for a screen's Share sheet: load (load.ts), build
 * (the html builders), print and write (pdfShell.ts). Each returns the file in the cache folder, ready
 * for Sharing.shareAsync, and throws when what it was asked for is gone or the PDF cannot be made.
 * The labels are in the app's language (tNow); the worker statement takes the worker's language.
 */
import type { File } from 'expo-file-system';

import type { ExpenseFilter, ExpenseSort } from '@/hooks/data';
import { tNow, type Lang } from '@/i18n';

import { today } from '../dates';
import { exportHtmlPdf, pdfFileName } from '../pdfShell';
import { buildDaySheetHtml } from './daySheetHtml';
import { buildExpensesHtml } from './expensesHtml';
import { loadDaySheet, loadExpenses, loadNotes, loadToolsRegister, loadWorkersList, loadWorkerStatement } from './load';
import { buildNotesHtml } from './notesHtml';
import { buildToolsRegisterHtml } from './toolsRegisterHtml';
import { buildWorkerStatementHtml } from './workerStatementHtml';
import { buildWorkersListHtml } from './workersListHtml';

export interface ListPdfOptions {
  /** Print on the company letterhead. */
  letterhead: boolean;
  onNotice?: (notice: 'letterhead-unavailable') => void;
}

/** A worker's statement, for all projects or one, in `lang`. */
export async function exportWorkerStatementPdf(workerId: string, projectId: string | null, opts: ListPdfOptions & { lang: Lang }): Promise<File> {
  const data = loadWorkerStatement(workerId, projectId);
  if (!data) throw new Error('Worker not found');
  const day = today();
  return exportHtmlPdf({
    html: (letterhead) => buildWorkerStatementHtml({ ...data, lang: opts.lang, letterhead, day }),
    fileName: pdfFileName('Statement', [data.worker.name, data.projectName], day),
    letterhead: opts.letterhead,
    onNotice: opts.onNotice,
    tag: 'worker.statementPdf',
  });
}

/** Every expense the tab's filter matches, in its order; `filters` are the labels the tab shows for the filter. */
export async function exportExpensesPdf(filter: ExpenseFilter, sort: ExpenseSort, opts: ListPdfOptions & { filters: { label: string; value: string }[] }): Promise<File> {
  const data = loadExpenses(filter, sort);
  if (!data) throw new Error('Project not found');
  const day = today();
  return exportHtmlPdf({
    html: (letterhead) => buildExpensesHtml({ ...data, filters: opts.filters, letterhead, t: tNow, day }),
    fileName: pdfFileName('Expenses', [data.projectName], day),
    letterhead: opts.letterhead,
    onNotice: opts.onNotice,
    tag: 'expenses.pdf',
  });
}

/** The roster of a project, or every worker (null). */
export async function exportWorkersListPdf(projectId: string | null, opts: ListPdfOptions): Promise<File> {
  const data = loadWorkersList(projectId);
  if (!data) throw new Error('Project not found');
  const day = today();
  return exportHtmlPdf({
    html: (letterhead) => buildWorkersListHtml({ ...data, letterhead, t: tNow, day }),
    fileName: pdfFileName('Workers', [data.projectName], day),
    letterhead: opts.letterhead,
    onNotice: opts.onNotice,
    tag: 'workers.pdf',
  });
}

/** One day's work and pay on one project, with signature lines. */
export async function exportDaySheetPdf(projectId: string, sheetDay: string, opts: ListPdfOptions): Promise<File> {
  const data = loadDaySheet(projectId, sheetDay);
  if (!data) throw new Error('Project not found');
  return exportHtmlPdf({
    html: (letterhead) => buildDaySheetHtml({ ...data, letterhead, t: tNow, day: today() }),
    fileName: pdfFileName('Day-sheet', [data.projectName], sheetDay),
    letterhead: opts.letterhead,
    onNotice: opts.onNotice,
    tag: 'wage.daySheetPdf',
  });
}

/** Every tool, out or in store. */
export async function exportToolsRegisterPdf(opts: ListPdfOptions): Promise<File> {
  const rows = loadToolsRegister();
  const day = today();
  return exportHtmlPdf({
    html: (letterhead) => buildToolsRegisterHtml({ rows, letterhead, t: tNow, day }),
    fileName: pdfFileName('Tools', [], day),
    letterhead: opts.letterhead,
    onNotice: opts.onNotice,
    tag: 'tools.pdf',
  });
}

/** A project's site notes, or every project's (null). */
export async function exportNotesPdf(projectId: string | null, opts: ListPdfOptions): Promise<File> {
  const data = loadNotes(projectId);
  if (!data) throw new Error('Project not found');
  const day = today();
  return exportHtmlPdf({
    html: (letterhead) => buildNotesHtml({ ...data, letterhead, t: tNow, day }),
    fileName: pdfFileName('Notes', [data.projectName], day),
    letterhead: opts.letterhead,
    onNotice: opts.onNotice,
    tag: 'notes.pdf',
  });
}

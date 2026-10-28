/**
 * Loads, from the phone database, exactly what each printable list is built from (the builders beside
 * this file). The numbers are the ones the screens show, taken from the same views and queries:
 * v_worker_balance and v_project_worker_balance of the worker screen and the Workers tab, v_wage_day of
 * "Today's work & pay", the Expenses tab's filter (expenseWhere), v_tool_status of the Tools tab.
 * Nothing here adds up money that a view already adds up.
 *
 * Live rows only, and a loader returns null when the thing it was asked for is missing or deleted.
 */
import { all, first } from '@/db';
import type { ProjectWorkerBalance, WageDay, WorkerBalance } from '@/db/types';
import { EXPENSE_ORDER, expenseWhere, type ExpenseFilter, type ExpenseSort } from '@/hooks/data';

import { isValidDay } from '../dates';
import { unpaidForWorker } from '../wages';
import type { DaySheetLine } from './daySheetHtml';
import type { ExpenseLine } from './expensesHtml';
import type { NoteLine } from './notesHtml';
import type { ToolHolderLine, ToolLine } from './toolsRegisterHtml';
import type { StatementEntry, StatementProjectLine } from './workerStatementHtml';
import type { WorkerLine } from './workersListHtml';

/** The name of a live project, or null when it is missing or deleted. */
export function liveProjectName(projectId: string): string | null {
  return first<{ name: string }>('SELECT name FROM projects WHERE id = ? AND deleted_at IS NULL', [projectId])?.name ?? null;
}

// ---------------------------------------------------------------- one worker

export interface WorkerStatementData {
  worker: { name: string; trade: string | null; daily_rate_cents: number; active: number };
  projectName: string | null;
  totals: { earned_cents: number; advance_cents: number; paid_cents: number; balance_cents: number };
  projects: StatementProjectLine[];
  history: StatementEntry[];
}

/**
 * The worker screen's figures (v_worker_balance, a line per project from v_project_worker_balance) and the
 * whole history, newest first; or, for one project, that project's figures and history (added up the way
 * the view adds them, so they are there even for wages on a project the worker is not assigned to).
 * null for a worker who is gone, or a project that is.
 */
export function loadWorkerStatement(workerId: string, projectId: string | null = null): WorkerStatementData | null {
  const balance = first<WorkerBalance>('SELECT * FROM v_worker_balance WHERE worker_id = ?', [workerId]);
  if (!balance) return null;
  const projectName = projectId == null ? null : liveProjectName(projectId);
  if (projectId != null && projectName == null) return null;

  const scope = projectId == null ? '' : ' AND w.project_id = ?';
  const scopeArgs = projectId == null ? [workerId] : [workerId, projectId];

  let totals = { earned_cents: balance.earned_cents, advance_cents: balance.advance_cents, paid_cents: balance.paid_cents, balance_cents: balance.balance_cents };
  let rate = balance.daily_rate_cents;
  if (projectId != null) {
    totals =
      first<typeof totals>(
        `SELECT COALESCE(SUM(CASE WHEN w.kind = 'work' THEN w.amount_cents END), 0) AS earned_cents,
                COALESCE(SUM(CASE WHEN w.kind = 'advance' THEN w.amount_cents END), 0) AS advance_cents,
                COALESCE(SUM(CASE WHEN w.kind = 'payment' THEN w.amount_cents END), 0) AS paid_cents,
                COALESCE(SUM(CASE WHEN w.kind = 'work' THEN w.amount_cents ELSE -w.amount_cents END), 0) AS balance_cents
         FROM wage_entries w WHERE w.worker_id = ? AND w.deleted_at IS NULL${scope}`,
        scopeArgs,
      ) ?? totals;
    rate = first<{ rate_cents: number }>('SELECT rate_cents FROM v_project_worker_balance WHERE project_id = ? AND worker_id = ?', [projectId, workerId])?.rate_cents ?? rate;
  }

  const projects =
    projectId == null
      ? all<StatementProjectLine>(
          `SELECT p.name AS name, b.rate_cents, b.days_total, b.earned_cents, b.advance_cents, b.paid_cents, b.balance_cents
           FROM v_project_worker_balance b JOIN projects p ON p.id = b.project_id AND p.deleted_at IS NULL
           WHERE b.worker_id = ?
           ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'on_hold' THEN 1 ELSE 2 END, b.active DESC, p.name COLLATE NOCASE, b.project_id`,
          [workerId],
        )
      : [];

  const history = all<StatementEntry>(
    `SELECT w.day AS day, w.kind AS kind, w.days AS days, w.amount_cents AS amount_cents, w.note AS note, p.name AS project_name
     FROM wage_entries w LEFT JOIN projects p ON p.id = w.project_id AND p.deleted_at IS NULL
     WHERE w.worker_id = ? AND w.deleted_at IS NULL${scope}
     ORDER BY w.day DESC, w.created_at DESC, w.id`,
    scopeArgs,
  );

  return {
    worker: { name: balance.name, trade: balance.trade, daily_rate_cents: rate, active: balance.active },
    projectName,
    totals,
    projects,
    history,
  };
}

// ---------------------------------------------------------------- the expenses tab

export interface ExpensesData {
  projectName: string | null;
  rows: ExpenseLine[];
  totalCents: number;
  count: number;
}

/** Every expense the Expenses tab's filter matches (no page cap), in the tab's order, with the tab's total and count. null for a project that is gone. */
export function loadExpenses(filter: ExpenseFilter, sort: ExpenseSort): ExpensesData | null {
  const projectName = filter.projectId == null ? null : liveProjectName(filter.projectId);
  if (filter.projectId != null && projectName == null) return null;
  const w = expenseWhere(filter);
  const rows = all<ExpenseLine>(
    `SELECT e.day, e.category, e.amount_cents, e.paid_to, e.method, e.note, p.name AS project_name
     FROM expenses e JOIN projects p ON p.id = e.project_id
     WHERE ${w.sql} ORDER BY ${EXPENSE_ORDER[sort] ?? EXPENSE_ORDER.newest}`,
    w.args,
  );
  const sum = first<{ total: number; count: number }>(`SELECT COALESCE(SUM(e.amount_cents), 0) AS total, COUNT(*) AS count FROM expenses e WHERE ${w.sql}`, w.args);
  return { projectName, rows, totalCents: sum?.total ?? 0, count: sum?.count ?? 0 };
}

// ---------------------------------------------------------------- the workers tab

export interface WorkersListData {
  projectName: string | null;
  rows: WorkerLine[];
}

/** A project's whole roster (v_project_worker_balance) or every worker (v_worker_balance): working first, then by name. null for a project that is gone. */
export function loadWorkersList(projectId: string | null): WorkersListData | null {
  const projectName = projectId == null ? null : liveProjectName(projectId);
  if (projectId != null && projectName == null) return null;
  const rows = projectId
    ? all<WorkerLine>(
        `SELECT name, trade, rate_cents, days_total, earned_cents, advance_cents, paid_cents, balance_cents, active
         FROM v_project_worker_balance WHERE project_id = ? ORDER BY active DESC, name COLLATE NOCASE, worker_id`,
        [projectId],
      )
    : all<WorkerLine>(
        `SELECT v.name, v.trade, v.daily_rate_cents AS rate_cents,
                COALESCE((SELECT SUM(we.days) FROM wage_entries we WHERE we.worker_id = v.worker_id AND we.kind = 'work' AND we.deleted_at IS NULL), 0) AS days_total,
                v.earned_cents, v.advance_cents, v.paid_cents, v.balance_cents, v.active
         FROM v_worker_balance v ORDER BY v.active DESC, v.name COLLATE NOCASE, v.worker_id`,
      );
  return { projectName, rows };
}

// ---------------------------------------------------------------- one day on one project

export interface DaySheetData {
  projectName: string;
  sheetDay: string;
  rows: DaySheetLine[];
}

/**
 * v_wage_day of one project and day with the workers' names, and per worker what is still unpaid for the day
 * (unpaidForWorker against the project balance; 0 for a worker who is off the roster, as on the Today card).
 * null for a project that is gone or a day that is not "YYYY-MM-DD".
 */
export function loadDaySheet(projectId: string, day: string): DaySheetData | null {
  if (!isValidDay(day)) return null;
  const projectName = liveProjectName(projectId);
  if (projectName == null) return null;
  const roster = all<ProjectWorkerBalance>('SELECT * FROM v_project_worker_balance WHERE project_id = ?', [projectId]);
  const owed = new Map(roster.map((r) => [r.worker_id, Math.max(0, r.balance_cents)]));
  const dayRows = all<WageDay & { name: string }>(
    `SELECT d.*, w.name AS name FROM v_wage_day d JOIN workers w ON w.id = d.worker_id AND w.deleted_at IS NULL
     WHERE d.project_id = ? AND d.day = ? ORDER BY w.name COLLATE NOCASE, d.worker_id`,
    [projectId, day],
  );
  const rows = dayRows.map((r) => ({
    name: r.name,
    days: r.days,
    work_cents: r.work_cents,
    paid_cents: r.paid_cents,
    advance_cents: r.advance_cents,
    unpaid_cents: owed.has(r.worker_id) ? unpaidForWorker(r.work_cents, r.paid_cents, owed.get(r.worker_id) ?? 0) : 0,
  }));
  return { projectName, sheetDay: day, rows };
}

// ---------------------------------------------------------------- the tools register

/**
 * Every live tool and material (v_tool_stock: how many in store and out) with who has them (v_tool_holders: one
 * line per person and project, with the day of the last issue to them): what is out first, then by name.
 */
export function loadToolsRegister(): ToolLine[] {
  const tools = all<Omit<ToolLine, 'holders'> & { tool_id: string }>(
    `SELECT s.tool_id, s.name, s.code, s.unit, s.is_material, s.quantity_milli, s.out_milli, s.in_store_milli,
            (SELECT m.condition FROM tool_movements m WHERE m.tool_id = s.tool_id AND m.deleted_at IS NULL ORDER BY m.day DESC, m.created_at DESC LIMIT 1) AS condition
     FROM v_tool_stock s
     ORDER BY (s.out_milli > 0) DESC, s.name COLLATE NOCASE, s.tool_id`,
  );
  const holders = all<ToolHolderLine & { tool_id: string }>(
    `SELECT h.tool_id, COALESCE(w.name, h.taken_by) AS with_name, p.name AS project_name, h.qty_milli,
            (SELECT MAX(m.day) FROM tool_movements m
             WHERE m.tool_id = h.tool_id AND m.kind = 'issue' AND m.deleted_at IS NULL
               AND m.project_id IS h.project_id AND m.worker_id IS h.worker_id AND m.taken_by IS h.taken_by) AS since
     FROM v_tool_holders h
     LEFT JOIN workers w ON w.id = h.worker_id
     LEFT JOIN projects p ON p.id = h.project_id
     ORDER BY h.tool_id, since, with_name COLLATE NOCASE`,
  );
  const byTool = new Map<string, ToolHolderLine[]>();
  for (const { tool_id, ...line } of holders) byTool.set(tool_id, [...(byTool.get(tool_id) ?? []), line]);
  return tools.map(({ tool_id, ...tool }) => ({ ...tool, holders: byTool.get(tool_id) ?? [] }));
}

// ---------------------------------------------------------------- site notes

export interface NotesData {
  projectName: string | null;
  notes: NoteLine[];
}

/** A project's live notes (or every live project's), newest day first, as the Site notes screen lists them. null for a project that is gone. */
export function loadNotes(projectId: string | null): NotesData | null {
  const projectName = projectId == null ? null : liveProjectName(projectId);
  if (projectId != null && projectName == null) return null;
  const notes = all<NoteLine>(
    `SELECT n.day, n.weather, n.body, p.name AS project_name FROM site_notes n JOIN projects p ON p.id = n.project_id
     WHERE n.deleted_at IS NULL AND p.deleted_at IS NULL ${projectId ? 'AND n.project_id = ?' : ''} ORDER BY n.day DESC, n.created_at DESC, n.id`,
    projectId ? [projectId] : [],
  );
  return { projectName, notes };
}

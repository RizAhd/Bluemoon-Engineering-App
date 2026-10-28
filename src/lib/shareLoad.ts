/**
 * Loads, from the phone database, exactly the data each shared message is built from (shareText.ts).
 *
 * The numbers are the ones the screens show, taken from the same views and queries: v_project_cost and
 * the category query of the project screen, v_estimate_total (through loadEstimate), v_wage_day and
 * v_project_worker_balance of "Today's work & pay", v_worker_balance of the worker screen, the Expenses
 * tab's query, v_tool_status of the Tools tab. Nothing here adds up money that a view already adds up.
 *
 * Live rows only: a deleted row is never read, and a loader returns null when the thing it was asked for
 * is missing or deleted (or, for a message about a project, when that project is). All reads are
 * synchronous and small.
 *
 * `buildShareMessage` loads and builds in one call; it is what a Share button calls.
 */
import { all, first } from '@/db';
import { loadEstimate } from '@/db/estimates';
import type { Project, ProjectCost, WorkerBalance } from '@/db/types';
import { currentLang, type Lang } from '@/i18n';

import { getCompanyProfile } from './company';
import { isValidDay, today } from './dates';
import {
  daySheetMessage,
  estimateMessage,
  expensesMessage,
  noteMessage,
  notesListMessage,
  projectMessage,
  SHARE_LIMITS,
  toolsOutMessage,
  workersListMessage,
  workerStatementMessage,
  type DaySheetRow,
  type DaySheetShareInput,
  type EstimateShareInput,
  type ExpenseRow,
  type ExpensesShareInput,
  type NoteShareInput,
  type NotesListShareInput,
  type ProjectShareInput,
  type ToolOutRow,
  type ToolsOutShareInput,
  type WorkerListShareRow,
  type WorkersListShareInput,
  type WorkerStatementShareInput,
} from './shareText';

/** The name of a live project, or null when it is missing or deleted. */
function liveProjectName(projectId: string): string | null {
  return first<{ name: string }>('SELECT name FROM projects WHERE id = ? AND deleted_at IS NULL', [projectId])?.name ?? null;
}

// ---------------------------------------------------------------- project

/** What the project screen shows: v_project_cost, the spend by category, workers still working, tools out, the newest notes. */
export function loadProjectShare(projectId: string): ProjectShareInput | null {
  const project = first<Project>('SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL', [projectId]);
  const cost = project ? first<ProjectCost>('SELECT * FROM v_project_cost WHERE project_id = ?', [projectId]) : null;
  if (!project || !cost) return null;

  const categories = all<{ category: string; cents: number }>(
    `SELECT category, SUM(amount_cents) AS cents FROM expenses
     WHERE project_id = ? AND deleted_at IS NULL GROUP BY category ORDER BY cents DESC, category`,
    [projectId],
  );
  // The project screen's list: assigned and still working (a worker marked as left is off every roster).
  const workerCount =
    first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM v_project_worker_balance
       WHERE project_id = ? AND active = 1
         AND worker_id NOT IN (SELECT id FROM workers WHERE active = 0 AND deleted_at IS NULL)`,
      [projectId],
    )?.n ?? 0;
  const toolsOutCount = first<{ n: number }>('SELECT COUNT(*) AS n FROM v_tool_status WHERE is_out = 1 AND project_id = ?', [projectId])?.n ?? 0;
  const notes = all<{ day: string; body: string }>(
    'SELECT day, body FROM site_notes WHERE project_id = ? AND deleted_at IS NULL ORDER BY day DESC, created_at DESC, id LIMIT ?',
    [projectId, SHARE_LIMITS.notes],
  );
  const noteCount = first<{ n: number }>('SELECT COUNT(*) AS n FROM site_notes WHERE project_id = ? AND deleted_at IS NULL', [projectId])?.n ?? 0;

  return { today: today(), project, cost, categories, workerCount, toolsOutCount, notes, noteCount };
}

// ---------------------------------------------------------------- estimate

/** The estimate with its stages, the totals of v_estimate_total as they are, and the company's name and phone. */
export function loadEstimateShare(estimateId: string): EstimateShareInput | null {
  const loaded = loadEstimate(estimateId);
  if (!loaded) return null;
  return { today: today(), estimate: loaded.estimate, payments: loaded.payments, total: loaded.total, company: getCompanyProfile() };
}

// ---------------------------------------------------------------- work and pay of a day

/** v_wage_day of one project and day, with the workers' names. null for a project that is gone or a day that is not "YYYY-MM-DD". */
export function loadDaySheetShare(projectId: string, day: string): DaySheetShareInput | null {
  if (!isValidDay(day)) return null;
  const projectName = liveProjectName(projectId);
  if (projectName == null) return null;
  const rows = all<DaySheetRow>(
    `SELECT w.name AS name, d.days AS days, d.work_cents AS work_cents, d.paid_cents AS paid_cents, d.advance_cents AS advance_cents
     FROM v_wage_day d JOIN workers w ON w.id = d.worker_id AND w.deleted_at IS NULL
     WHERE d.project_id = ? AND d.day = ?
     ORDER BY w.name COLLATE NOCASE, d.worker_id`,
    [projectId, day],
  );
  return { today: today(), projectName, day, rows };
}

// ---------------------------------------------------------------- one worker

/**
 * The worker screen's figures: v_worker_balance (all projects) with a line per project from
 * v_project_worker_balance, or, for one project, that project's figures (added up the way the view
 * adds them, so they are there even for wages on a project the worker is not assigned to). Also the
 * newest payments and advances. null for a worker who is gone, or a project that is.
 */
export function loadWorkerStatementShare(workerId: string, projectId: string | null = null): WorkerStatementShareInput | null {
  const balance = first<WorkerBalance>('SELECT * FROM v_worker_balance WHERE worker_id = ?', [workerId]);
  if (!balance) return null;

  const projectName = projectId == null ? null : liveProjectName(projectId);
  if (projectId != null && projectName == null) return null;

  const scope = projectId == null ? '' : ' AND w.project_id = ?';
  const scopeArgs = projectId == null ? [workerId] : [workerId, projectId];

  let totals = {
    earned_cents: balance.earned_cents,
    advance_cents: balance.advance_cents,
    paid_cents: balance.paid_cents,
    balance_cents: balance.balance_cents,
  };
  let rate = balance.daily_rate_cents;
  if (projectId != null) {
    totals = first<typeof totals>(
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
      ? all<{ name: string; days_total: number; balance_cents: number }>(
          `SELECT p.name AS name, b.days_total AS days_total, b.balance_cents AS balance_cents
           FROM v_project_worker_balance b JOIN projects p ON p.id = b.project_id AND p.deleted_at IS NULL
           WHERE b.worker_id = ?
           ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'on_hold' THEN 1 ELSE 2 END, b.active DESC, p.name COLLATE NOCASE, b.project_id`,
          [workerId],
        )
      : [];

  const given = `w.worker_id = ? AND w.deleted_at IS NULL AND w.kind IN ('payment', 'advance')${scope}`;
  const recent = all<WorkerStatementShareInput['recent'][number]>(
    `SELECT w.day AS day, w.kind AS kind, w.amount_cents AS amount_cents, p.name AS project_name
     FROM wage_entries w LEFT JOIN projects p ON p.id = w.project_id AND p.deleted_at IS NULL
     WHERE ${given}
     ORDER BY w.day DESC, w.created_at DESC, w.id LIMIT ?`,
    [...scopeArgs, SHARE_LIMITS.payments],
  );
  const recentCount = first<{ n: number }>(`SELECT COUNT(*) AS n FROM wage_entries w WHERE ${given}`, scopeArgs)?.n ?? 0;

  return {
    today: today(),
    worker: { name: balance.name, trade: balance.trade, daily_rate_cents: rate },
    projectName,
    totals,
    projects,
    recent,
    recentCount,
  };
}

// ---------------------------------------------------------------- expenses

/**
 * The newest `limit` expenses of a project (null: all projects) as the Expenses tab lists them, and the
 * total and number of all of them, which is the tab's "Total cost". null for a project that is gone.
 */
export function loadExpensesShare(projectId: string | null, limit: number = SHARE_LIMITS.expenses): ExpensesShareInput | null {
  const projectName = projectId == null ? null : liveProjectName(projectId);
  if (projectId != null && projectName == null) return null;
  const rowLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 500) : SHARE_LIMITS.expenses;

  const scope = projectId == null ? '' : 'AND e.project_id = ?';
  const scopeArgs = projectId == null ? [] : [projectId];
  const rows = all<ExpenseRow>(
    `SELECT e.day AS day, e.category AS category, e.amount_cents AS amount_cents, e.paid_to AS paid_to, p.name AS project_name
     FROM expenses e JOIN projects p ON p.id = e.project_id
     WHERE e.deleted_at IS NULL ${scope}
     ORDER BY e.day DESC, e.created_at DESC, e.id LIMIT ?`,
    [...scopeArgs, rowLimit],
  );
  const sum = first<{ s: number; n: number }>(`SELECT COALESCE(SUM(e.amount_cents), 0) AS s, COUNT(*) AS n FROM expenses e WHERE e.deleted_at IS NULL ${scope}`, scopeArgs);

  return { today: today(), projectName, rows, totalCents: sum?.s ?? 0, totalCount: sum?.n ?? 0 };
}

// ---------------------------------------------------------------- tools

/** The tools that are out now (v_tool_status), in the Tools tab's order, for a project or (null) for all. null for a project that is gone. */
export function loadToolsOutShare(projectId: string | null): ToolsOutShareInput | null {
  const projectName = projectId == null ? null : liveProjectName(projectId);
  if (projectId != null && projectName == null) return null;

  const scope = projectId == null ? '' : 'AND s.project_id = ?';
  const tools = all<ToolOutRow>(
    `SELECT s.name AS name, s.code AS code, COALESCE(w.name, s.taken_by) AS with_name, s.last_day AS since, p.name AS project_name
     FROM v_tool_status s
     LEFT JOIN workers w ON w.id = s.worker_id
     LEFT JOIN projects p ON p.id = s.project_id
     WHERE s.is_out = 1 ${scope}
     ORDER BY s.name COLLATE NOCASE, s.tool_id`,
    projectId == null ? [] : [projectId],
  );
  return { today: today(), projectName, tools };
}

// ---------------------------------------------------------------- one note

/** A site note with its project's name. null when the note is gone, or its project is. */
export function loadNoteShare(noteId: string): NoteShareInput | null {
  const row = first<{ project_name: string; day: string; body: string; weather: string | null }>(
    `SELECT p.name AS project_name, n.day AS day, n.body AS body, n.weather AS weather
     FROM site_notes n JOIN projects p ON p.id = n.project_id
     WHERE n.id = ? AND n.deleted_at IS NULL AND p.deleted_at IS NULL`,
    [noteId],
  );
  return row ? { today: today(), projectName: row.project_name, day: row.day, body: row.body, weather: row.weather } : null;
}

// ---------------------------------------------------------------- the workers list

/** The Workers tab's roster (v_project_worker_balance) or every worker (v_worker_balance), working first, then by name. null for a project that is gone. */
export function loadWorkersListShare(projectId: string | null): WorkersListShareInput | null {
  const projectName = projectId == null ? null : liveProjectName(projectId);
  if (projectId != null && projectName == null) return null;
  const rows = projectId
    ? all<WorkerListShareRow>('SELECT name, trade, balance_cents, active FROM v_project_worker_balance WHERE project_id = ? ORDER BY active DESC, name COLLATE NOCASE, worker_id', [projectId])
    : all<WorkerListShareRow>('SELECT name, trade, balance_cents, active FROM v_worker_balance ORDER BY active DESC, name COLLATE NOCASE, worker_id');
  return { today: today(), projectName, rows };
}

// ---------------------------------------------------------------- the notes list

/** The newest notes of a project (or of every live project), newest first, and how many there are. null for a project that is gone. */
export function loadNotesListShare(projectId: string | null): NotesListShareInput | null {
  const projectName = projectId == null ? null : liveProjectName(projectId);
  if (projectId != null && projectName == null) return null;
  const scope = projectId ? 'AND n.project_id = ?' : '';
  const args = projectId ? [projectId] : [];
  const notes = all<NotesListShareInput['notes'][number]>(
    `SELECT n.day AS day, n.body AS body, n.weather AS weather, p.name AS project_name
     FROM site_notes n JOIN projects p ON p.id = n.project_id AND p.deleted_at IS NULL
     WHERE n.deleted_at IS NULL ${scope} ORDER BY n.day DESC, n.created_at DESC, n.id LIMIT ?`,
    [...args, SHARE_LIMITS.notesList],
  );
  const noteCount =
    first<{ n: number }>(`SELECT COUNT(*) AS n FROM site_notes n JOIN projects p ON p.id = n.project_id AND p.deleted_at IS NULL WHERE n.deleted_at IS NULL ${scope}`, args)?.n ?? 0;
  return { today: today(), projectName, notes, noteCount };
}

// ---------------------------------------------------------------- load and build in one call

export const SHARE_KINDS = ['project', 'estimate', 'daySheet', 'workerStatement', 'expenses', 'toolsOut', 'note', 'workersList', 'notesList'] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];

export interface ShareOptions {
  /** daySheet: the day of the sheet, "YYYY-MM-DD" (today when left out). */
  day?: string;
  /** workerStatement: only this project (all projects when left out or null). */
  projectId?: string | null;
  /** expenses: how many of the newest expenses to list (30 when left out). */
  limit?: number;
}

/**
 * The finished message for a Share button, in `lang` (the app's language when left out), or null when
 * what it is about is missing or deleted. `id` is:
 *   project         the project's id            daySheet    the project's id (day in options, default today)
 *   estimate        the estimate's id           expenses    the project's id, or null for all projects
 *   note            the note's id               toolsOut    the project's id, or null for all projects
 *   workersList     the project's id, or null   notesList   the project's id, or null for all projects
 *   workerStatement the worker's id (options.projectId limits it to one project)
 */
export function buildShareMessage(kind: ShareKind, id: string | null, lang: Lang = currentLang(), options: ShareOptions = {}): string | null {
  switch (kind) {
    case 'project': {
      const data = id == null ? null : loadProjectShare(id);
      return data && projectMessage(data, lang);
    }
    case 'estimate': {
      const data = id == null ? null : loadEstimateShare(id);
      return data && estimateMessage(data, lang);
    }
    case 'daySheet': {
      const data = id == null ? null : loadDaySheetShare(id, options.day ?? today());
      return data && daySheetMessage(data, lang);
    }
    case 'workerStatement': {
      const data = id == null ? null : loadWorkerStatementShare(id, options.projectId ?? null);
      return data && workerStatementMessage(data, lang);
    }
    case 'expenses': {
      const data = loadExpensesShare(id, options.limit);
      return data && expensesMessage(data, lang);
    }
    case 'toolsOut': {
      const data = loadToolsOutShare(id);
      return data && toolsOutMessage(data, lang);
    }
    case 'note': {
      const data = id == null ? null : loadNoteShare(id);
      return data && noteMessage(data, lang);
    }
    case 'workersList': {
      const data = loadWorkersListShare(id);
      return data && workersListMessage(data, lang);
    }
    case 'notesList': {
      const data = loadNotesListShare(id);
      return data && notesListMessage(data, lang);
    }
    default:
      return null;
  }
}

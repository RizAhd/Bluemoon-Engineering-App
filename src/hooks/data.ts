import { setSetting, useFirst, useQuery, useSetting } from '@/db';
import type {
  Attachment,
  Estimate,
  EstimateItem,
  EstimateListRow,
  EstimatePayment,
  EstimateTotal,
  Expense,
  Project,
  ProjectCost,
  ProjectWorkerBalance,
  Tool,
  WageDay,
  Worker,
} from '@/db/types';

export function useProjects(includeCompleted = true) {
  return useQuery<Project>(
    `SELECT * FROM projects WHERE deleted_at IS NULL ${includeCompleted ? '' : "AND status != 'completed'"}
     ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'on_hold' THEN 1 ELSE 2 END, name COLLATE NOCASE`,
  );
}

export function useProject(id: string | null | undefined) {
  return useFirst<Project>('SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL', [id ?? '']);
}

/** The project the user is working on. `null` means "all projects". */
export function useCurrentProjectId(): string | null {
  const id = useSetting('current_project');
  const exists = useFirst<{ ok: number }>('SELECT 1 AS ok FROM projects WHERE id = ? AND deleted_at IS NULL', [id ?? '']);
  return id && exists ? id : null;
}

export function setCurrentProject(id: string | null) {
  setSetting('current_project', id);
}

export function useWorkers(activeOnly = false) {
  return useQuery<Worker>(
    `SELECT * FROM workers WHERE deleted_at IS NULL ${activeOnly ? 'AND active = 1' : ''} ORDER BY active DESC, name COLLATE NOCASE`,
  );
}

const EMPTY_PROJECT = '';

/** Workers assigned to a project with their balance there. `[]` when no project is chosen. Active first, then name. */
export function useProjectWorkers(projectId: string | null): ProjectWorkerBalance[] {
  const rows = useQuery<ProjectWorkerBalance>(
    'SELECT * FROM v_project_worker_balance WHERE project_id = ? ORDER BY active DESC, name COLLATE NOCASE',
    [projectId ?? EMPTY_PROJECT],
  );
  return projectId ? rows : [];
}

/** Work and pay per worker on one project for one day. `[]` when no project is chosen. */
export function useWageDay(projectId: string | null, day: string): WageDay[] {
  const rows = useQuery<WageDay>('SELECT * FROM v_wage_day WHERE project_id = ? AND day = ?', [projectId ?? EMPTY_PROJECT, day]);
  return projectId ? rows : [];
}

/** The projects a worker is assigned to, with their balance on each. */
export function useWorkerProjects(workerId: string): (ProjectWorkerBalance & { project_name: string })[] {
  return useQuery<ProjectWorkerBalance & { project_name: string }>(
    `SELECT b.*, p.name AS project_name
     FROM v_project_worker_balance b
     JOIN projects p ON p.id = b.project_id AND p.deleted_at IS NULL
     WHERE b.worker_id = ?
     ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'on_hold' THEN 1 ELSE 2 END, b.active DESC, p.name COLLATE NOCASE`,
    [workerId],
  );
}

export function useTools() {
  return useQuery<Tool>('SELECT * FROM tools WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE');
}

export function useAttachments(ownerTable: string, ownerId: string | null | undefined) {
  return useQuery<Attachment>(
    'SELECT * FROM attachments WHERE owner_table = ? AND owner_id = ? AND deleted_at IS NULL ORDER BY created_at',
    [ownerTable, ownerId ?? ''],
  );
}

export function useAttachmentCounts(ownerTable: string) {
  const rows = useQuery<{ owner_id: string; n: number }>(
    'SELECT owner_id, COUNT(*) AS n FROM attachments WHERE owner_table = ? AND deleted_at IS NULL GROUP BY owner_id',
    [ownerTable],
  );
  return new Map(rows.map((r) => [r.owner_id, r.n]));
}

// ---------------------------------------------------------------- estimates

/** Every live estimate with its total and number of lines, newest first. */
export function useEstimates(): EstimateListRow[] {
  return useQuery<EstimateListRow>(
    `SELECT e.*, t.total_cents, t.item_count
     FROM estimates e JOIN v_estimate_total t ON t.estimate_id = e.id
     WHERE e.deleted_at IS NULL
     ORDER BY e.issue_day DESC, e.created_at DESC, e.id`,
  );
}

export function useEstimate(id: string | null | undefined) {
  return useFirst<Estimate>('SELECT * FROM estimates WHERE id = ? AND deleted_at IS NULL', [id ?? '']);
}

/** The estimates that were turned into this project (normally none or one). */
export function useProjectEstimates(projectId: string | null | undefined) {
  return useQuery<Estimate>('SELECT * FROM estimates WHERE project_id = ? AND deleted_at IS NULL ORDER BY issue_day DESC, created_at DESC', [projectId ?? '']);
}

/** The price lines of an estimate in position order. */
export function useEstimateItems(estimateId: string | null | undefined) {
  return useQuery<EstimateItem>('SELECT * FROM estimate_items WHERE estimate_id = ? AND deleted_at IS NULL ORDER BY position, created_at, id', [estimateId ?? '']);
}

/** The payment stages of an estimate in position order. */
export function useEstimatePayments(estimateId: string | null | undefined) {
  return useQuery<EstimatePayment>('SELECT * FROM estimate_payments WHERE estimate_id = ? AND deleted_at IS NULL ORDER BY position, created_at, id', [estimateId ?? '']);
}

/** Subtotal, discount, tax, total and the scheduled share, worked out by the database. null when the estimate is missing or deleted. */
export function useEstimateTotal(estimateId: string | null | undefined) {
  return useFirst<EstimateTotal>('SELECT * FROM v_estimate_total WHERE estimate_id = ?', [estimateId ?? '']);
}

// ---------------------------------------------------------------- filtered and sorted lists (src/components/ListControls.tsx)

/** A day range: `day >= from AND day < to`. */
export interface DayRange {
  from: string;
  to: string;
}

/** A month that has records, with their total and number. */
export interface MonthTotalRow {
  month: string;
  total: number;
  count: number;
}

type Bind = string | number;

export const EXPENSE_SORTS = ['newest', 'oldest', 'highest', 'lowest'] as const;
export type ExpenseSort = (typeof EXPENSE_SORTS)[number];

export interface ExpenseFilter {
  projectId: string | null;
  /** null = all time. */
  range: DayRange | null;
  /** Empty = every category. */
  categories: string[];
  /** Empty = every payment method. */
  methods: string[];
  minCents: number | null;
  maxCents: number | null;
}

/** The WHERE clause (table alias `e`) and its bound values for an expense filter. Nothing from the filter is pasted into the SQL. */
export function expenseWhere(f: ExpenseFilter, opts: { withPeriod?: boolean } = {}): { sql: string; args: Bind[] } {
  const parts = ['e.deleted_at IS NULL'];
  const args: Bind[] = [];
  if (f.projectId) {
    parts.push('e.project_id = ?');
    args.push(f.projectId);
  }
  if (f.range && opts.withPeriod !== false) {
    parts.push('e.day >= ? AND e.day < ?');
    args.push(f.range.from, f.range.to);
  }
  if (f.categories.length) {
    parts.push(`e.category IN (${f.categories.map(() => '?').join(', ')})`);
    args.push(...f.categories);
  }
  if (f.methods.length) {
    parts.push(`e.method IN (${f.methods.map(() => '?').join(', ')})`);
    args.push(...f.methods);
  }
  if (f.minCents != null) {
    parts.push('e.amount_cents >= ?');
    args.push(f.minCents);
  }
  if (f.maxCents != null) {
    parts.push('e.amount_cents <= ?');
    args.push(f.maxCents);
  }
  return { sql: parts.join(' AND '), args };
}

/** ORDER BY (table alias `e`) for each order of the Expenses tab; shared with the expense list PDF. */
export const EXPENSE_ORDER: Record<ExpenseSort, string> = {
  newest: 'e.day DESC, e.created_at DESC, e.id',
  oldest: 'e.day ASC, e.created_at ASC, e.id',
  highest: 'e.amount_cents DESC, e.day DESC, e.created_at DESC, e.id',
  lowest: 'e.amount_cents ASC, e.day DESC, e.created_at DESC, e.id',
};

/**
 * The Expenses tab: the filtered rows in the chosen order (up to `limit`, -1 = all), their total and number, the
 * total of every day that has rows, and the months that have rows under the same filters (for the month picker).
 */
export function useExpenseList(f: ExpenseFilter, sort: ExpenseSort, limit: number) {
  const w = expenseWhere(f);
  const rows = useQuery<Expense & { project_name: string }>(
    `SELECT e.*, p.name AS project_name FROM expenses e JOIN projects p ON p.id = e.project_id
     WHERE ${w.sql} ORDER BY ${EXPENSE_ORDER[sort]} LIMIT ?`,
    [...w.args, limit],
  );
  const sum = useFirst<{ total: number; count: number }>(`SELECT COALESCE(SUM(e.amount_cents), 0) AS total, COUNT(*) AS count FROM expenses e WHERE ${w.sql}`, w.args);
  const dayTotals = useQuery<{ day: string; total: number }>(`SELECT e.day, COALESCE(SUM(e.amount_cents), 0) AS total FROM expenses e WHERE ${w.sql} GROUP BY e.day`, w.args);
  const any = expenseWhere(f, { withPeriod: false });
  const months = useQuery<MonthTotalRow>(
    `SELECT substr(e.day, 1, 7) AS month, COALESCE(SUM(e.amount_cents), 0) AS total, COUNT(*) AS count
     FROM expenses e WHERE ${any.sql} GROUP BY month ORDER BY month DESC`,
    any.args,
  );
  return { rows, total: sum?.total ?? 0, count: sum?.count ?? 0, dayTotals, months };
}

export const PROJECT_SORTS = ['name', 'newest', 'cost', 'used'] as const;
export type ProjectSort = (typeof PROJECT_SORTS)[number];

const PROJECT_ORDER: Record<ProjectSort, string> = {
  name: 'v.name COLLATE NOCASE, v.project_id',
  newest: 'p.created_at DESC, v.name COLLATE NOCASE, v.project_id',
  cost: '(v.expense_cents + v.labour_cents) DESC, v.name COLLATE NOCASE, v.project_id',
  // projects without a contract value have no share to compare: they go last
  used: 'CASE WHEN v.contract_cents > 0 THEN (v.expense_cents + v.labour_cents) * 1.0 / v.contract_cents ELSE -1 END DESC, v.name COLLATE NOCASE, v.project_id',
};

/** Every project with its costs, by status (active, on hold, completed) and then in the chosen order. */
export function useProjectList(sort: ProjectSort) {
  return useQuery<ProjectCost & { location: string | null; client: string | null; created_at: string }>(
    `SELECT v.*, p.location, p.client, p.created_at FROM v_project_cost v JOIN projects p ON p.id = v.project_id
     ORDER BY CASE v.status WHEN 'active' THEN 0 WHEN 'on_hold' THEN 1 ELSE 2 END, ${PROJECT_ORDER[sort]}`,
  );
}

export const WORKER_SORTS = ['name', 'toPay', 'days', 'rate'] as const;
export type WorkerSort = (typeof WORKER_SORTS)[number];
export const BALANCE_FILTERS = ['all', 'pay', 'advance', 'settled'] as const;
export type BalanceFilter = (typeof BALANCE_FILTERS)[number];
export const WORKER_STATUS_FILTERS = ['all', 'active', 'left'] as const;
export type WorkerStatusFilter = (typeof WORKER_STATUS_FILTERS)[number];

/** One row of the Workers tab: on a project its rate and balance there, with "All projects" the worker's own. */
export interface WorkerListRow {
  id: string;
  name: string;
  trade: string | null;
  rate: number;
  balance: number;
  active: number;
  days: number;
}

const WORKER_ORDER: Record<WorkerSort, string> = {
  name: 'name COLLATE NOCASE, id',
  toPay: 'balance DESC, name COLLATE NOCASE, id',
  days: 'days DESC, name COLLATE NOCASE, id',
  rate: 'rate DESC, name COLLATE NOCASE, id',
};
const BALANCE_SQL: Record<BalanceFilter, string> = { all: '1 = 1', pay: 'balance > 0', advance: 'balance < 0', settled: 'balance = 0' };
const STATUS_SQL: Record<WorkerStatusFilter, string> = { all: '1 = 1', active: 'active = 1', left: 'active = 0' };

/**
 * The Workers tab: one project's roster, or every worker with "All projects" (projectId null), filtered by balance
 * and status and in the chosen order. `counts` are per balance under the status filter (for the chips); `total`
 * is the whole roster with no filter.
 */
export function useWorkerList(projectId: string | null, opts: { sort: WorkerSort; balance: BalanceFilter; status: WorkerStatusFilter }) {
  const base = projectId
    ? `SELECT worker_id AS id, name, trade, rate_cents AS rate, balance_cents AS balance, active, days_total AS days
       FROM v_project_worker_balance WHERE project_id = ?`
    : `SELECT v.worker_id AS id, v.name, v.trade, v.daily_rate_cents AS rate, v.balance_cents AS balance, v.active,
         COALESCE((SELECT SUM(we.days) FROM wage_entries we WHERE we.worker_id = v.worker_id AND we.kind = 'work' AND we.deleted_at IS NULL), 0) AS days
       FROM v_worker_balance v`;
  const args: Bind[] = projectId ? [projectId] : [];
  const status = STATUS_SQL[opts.status];
  const rows = useQuery<WorkerListRow>(`SELECT * FROM (${base}) WHERE ${status} AND ${BALANCE_SQL[opts.balance]} ORDER BY ${WORKER_ORDER[opts.sort]}`, args);
  const counts = useFirst<{ pay: number; advance: number; settled: number; n: number }>(
    `SELECT COALESCE(SUM(balance > 0), 0) AS pay, COALESCE(SUM(balance < 0), 0) AS advance, COALESCE(SUM(balance = 0), 0) AS settled, COUNT(*) AS n
     FROM (${base}) WHERE ${status}`,
    args,
  );
  const total = useFirst<{ n: number }>(`SELECT COUNT(*) AS n FROM (${base})`, args)?.n ?? 0;
  return { rows, counts: counts ?? { pay: 0, advance: 0, settled: 0, n: 0 }, total };
}

export const ESTIMATE_SORTS = ['newest', 'oldest', 'highest', 'lowest'] as const;
export type EstimateSort = (typeof ESTIMATE_SORTS)[number];

const ESTIMATE_ORDER: Record<EstimateSort, string> = {
  newest: 'e.issue_day DESC, e.created_at DESC, e.id',
  oldest: 'e.issue_day ASC, e.created_at ASC, e.id',
  highest: 't.total_cents DESC, e.issue_day DESC, e.created_at DESC, e.id',
  lowest: 't.total_cents ASC, e.issue_day DESC, e.created_at DESC, e.id',
};

/** The estimates issued in a range (null = all), in the chosen order, and the months that have estimates. */
export function useEstimateList(range: DayRange | null, sort: EstimateSort) {
  const where = range ? 'AND e.issue_day >= ? AND e.issue_day < ?' : '';
  const rows = useQuery<EstimateListRow>(
    `SELECT e.*, t.total_cents, t.item_count
     FROM estimates e JOIN v_estimate_total t ON t.estimate_id = e.id
     WHERE e.deleted_at IS NULL ${where}
     ORDER BY ${ESTIMATE_ORDER[sort]}`,
    range ? [range.from, range.to] : [],
  );
  const months = useQuery<MonthTotalRow>(
    `SELECT substr(e.issue_day, 1, 7) AS month, COALESCE(SUM(t.total_cents), 0) AS total, COUNT(*) AS count
     FROM estimates e JOIN v_estimate_total t ON t.estimate_id = e.id
     WHERE e.deleted_at IS NULL GROUP BY month ORDER BY month DESC`,
  );
  const total = useFirst<{ n: number }>('SELECT COUNT(*) AS n FROM estimates WHERE deleted_at IS NULL')?.n ?? 0;
  return { rows, months, total };
}

export interface Base {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
  device_id: string;
}

export type ProjectStatus = 'active' | 'on_hold' | 'completed';

export interface Project extends Base {
  name: string;
  client: string | null;
  location: string | null;
  contract_cents: number | null;
  start_date: string | null;
  end_date: string | null;
  status: ProjectStatus;
  notes: string | null;
}

export const EXPENSE_CATEGORIES = [
  'materials',
  'transport',
  'fuel',
  'machinery',
  'food',
  'tools',
  'subcontract',
  'utilities',
  'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const PAY_METHODS = ['cash', 'bank', 'cheque'] as const;
export type PayMethod = (typeof PAY_METHODS)[number];

export interface Expense extends Base {
  project_id: string;
  day: string;
  category: ExpenseCategory;
  amount_cents: number;
  paid_to: string | null;
  method: PayMethod;
  note: string | null;
}

export interface Worker extends Base {
  name: string;
  phone: string | null;
  trade: string | null;
  daily_rate_cents: number;
  active: number;
}

export type WageKind = 'work' | 'advance' | 'payment';

export interface WageEntry extends Base {
  worker_id: string;
  project_id: string | null;
  day: string;
  kind: WageKind;
  days: number | null;
  amount_cents: number;
  note: string | null;
}

/** A worker assigned to a project, with the rate agreed for that project. */
export interface ProjectWorker extends Base {
  project_id: string;
  worker_id: string;
  rate_cents: number;
  active: number;
}

export interface Tool extends Base {
  name: string;
  code: string | null;
  notes: string | null;
}

export interface ToolMovement extends Base {
  tool_id: string;
  kind: 'issue' | 'return';
  project_id: string | null;
  worker_id: string | null;
  taken_by: string | null;
  day: string;
  condition: string | null;
  note: string | null;
}

export interface SiteNote extends Base {
  project_id: string;
  day: string;
  body: string;
  weather: string | null;
}

export interface Attachment extends Base {
  owner_table: string;
  owner_id: string;
  kind: 'photo' | 'pdf' | 'file';
  file_name: string;
  mime: string;
  size: number;
  sha256: string;
}

export interface ProjectCost {
  project_id: string;
  name: string;
  status: ProjectStatus;
  contract_cents: number | null;
  expense_cents: number;
  labour_cents: number;
  labour_paid_cents: number;
}

export interface WorkerBalance {
  worker_id: string;
  name: string;
  trade: string | null;
  daily_rate_cents: number;
  active: number;
  earned_cents: number;
  advance_cents: number;
  paid_cents: number;
  balance_cents: number;
}

/** v_project_worker_balance: one row per worker on a project. */
export interface ProjectWorkerBalance {
  project_id: string;
  worker_id: string;
  name: string;
  trade: string | null;
  phone: string | null;
  rate_cents: number;
  active: number;
  earned_cents: number;
  advance_cents: number;
  paid_cents: number;
  balance_cents: number;
  days_total: number;
}

/** v_wage_day: what one worker did and was paid on one project on one day. */
export interface WageDay {
  project_id: string;
  worker_id: string;
  day: string;
  days: number | null;
  work_cents: number;
  paid_cents: number;
  advance_cents: number;
}

export interface ToolStatus {
  tool_id: string;
  name: string;
  code: string | null;
  last_kind: 'issue' | 'return' | null;
  last_day: string | null;
  project_id: string | null;
  worker_id: string | null;
  taken_by: string | null;
  is_out: number;
}

// ---------------------------------------------------------------- estimates (quotations)

export const ESTIMATE_STATUSES = ['draft', 'sent', 'accepted', 'declined'] as const;
export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];

/** A quotation for a client, made before a project exists. See docs/ESTIMATES.md. */
export interface Estimate extends Base {
  /** Shown on the PDF, e.g. EST-2026-001. Editable. */
  number: string;
  client_name: string;
  client_phone: string | null;
  client_address: string | null;
  /** What is being quoted, e.g. "Boundary wall, Welimada". */
  title: string;
  location: string | null;
  issue_day: string;
  /** The quote stands for this many days after issue_day. */
  valid_days: number;
  discount_cents: number;
  /** Tax in basis points: 1800 = 18 %. 0 = no tax line. */
  tax_bp: number;
  status: EstimateStatus;
  terms: string | null;
  notes: string | null;
  /** Set when the accepted estimate was turned into a project. */
  project_id: string | null;
}

/** One line of the bill of quantities. amount = qty × rate, from qty_milli (1000 = 1 unit). */
export interface EstimateItem extends Base {
  estimate_id: string;
  position: number;
  description: string;
  unit: string | null;
  qty_milli: number;
  rate_cents: number;
}

/** One stage of the payment schedule: a label and its share of the total in basis points. */
export interface EstimatePayment extends Base {
  estimate_id: string;
  position: number;
  label: string;
  percent_bp: number;
}

/** A row of v_estimate_total. All money comes from the database, never from screens. */
export interface EstimateTotal {
  estimate_id: string;
  item_count: number;
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
  /** Sum of the payment schedule in basis points; 10000 = fully scheduled. */
  scheduled_bp: number;
}

/** A row of the estimate list: the estimate and what the list shows of its total. */
export type EstimateListRow = Estimate & Pick<EstimateTotal, 'total_cents' | 'item_count'>;

/** Company and bank details printed on estimates. Kept per phone in the settings table. */
export interface CompanyProfile {
  name: string;
  reg_no: string;
  address: string;
  phone: string;
  email: string;
  bank_name: string;
  account_name: string;
  account_no: string;
  branch: string;
  /** Terms copied into every new estimate. */
  default_terms: string;
  default_valid_days: number;
}

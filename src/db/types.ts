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

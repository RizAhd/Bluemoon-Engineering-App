/**
 * Local SQLite schema. The phone database is the source of truth.
 *
 * Rules (carried over from the SJD non-negotiables):
 *  - Every row has a UUID made on the phone, so merging imports never duplicates.
 *  - `version` goes up on every change; imports keep the higher version.
 *  - Nothing is hard-deleted: `deleted_at` marks a removed row.
 *  - Money is whole cents in INTEGER columns. Totals come from the views below.
 *
 * Migrations only ever append. Never edit a migration that has shipped.
 */

const common = `
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  device_id TEXT NOT NULL
`;

export const migrations: string[] = [
  // 1 — initial schema
  `
  CREATE TABLE projects (
    ${common},
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    client TEXT,
    location TEXT,
    contract_cents INTEGER CHECK (contract_cents IS NULL OR contract_cents >= 0),
    start_date TEXT,
    end_date TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_hold','completed')),
    notes TEXT
  );

  CREATE TABLE expenses (
    ${common},
    project_id TEXT NOT NULL REFERENCES projects(id),
    day TEXT NOT NULL,
    category TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    paid_to TEXT,
    method TEXT NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','bank','cheque')),
    note TEXT
  );
  CREATE INDEX ix_expenses_project_day ON expenses(project_id, day);

  CREATE TABLE workers (
    ${common},
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    phone TEXT,
    trade TEXT,
    daily_rate_cents INTEGER NOT NULL DEFAULT 0 CHECK (daily_rate_cents >= 0),
    active INTEGER NOT NULL DEFAULT 1
  );

  -- One ledger for wages: 'work' = earned, 'advance' and 'payment' = money given.
  CREATE TABLE wage_entries (
    ${common},
    worker_id TEXT NOT NULL REFERENCES workers(id),
    project_id TEXT REFERENCES projects(id),
    day TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('work','advance','payment')),
    days REAL CHECK (days IS NULL OR days > 0),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    note TEXT
  );
  CREATE INDEX ix_wage_worker ON wage_entries(worker_id, day);
  CREATE INDEX ix_wage_project ON wage_entries(project_id, day);

  CREATE TABLE tools (
    ${common},
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    code TEXT,
    notes TEXT
  );

  CREATE TABLE tool_movements (
    ${common},
    tool_id TEXT NOT NULL REFERENCES tools(id),
    kind TEXT NOT NULL CHECK (kind IN ('issue','return')),
    project_id TEXT REFERENCES projects(id),
    worker_id TEXT REFERENCES workers(id),
    taken_by TEXT,
    day TEXT NOT NULL,
    condition TEXT,
    note TEXT
  );
  CREATE INDEX ix_toolmov_tool ON tool_movements(tool_id, created_at);

  CREATE TABLE site_notes (
    ${common},
    project_id TEXT NOT NULL REFERENCES projects(id),
    day TEXT NOT NULL,
    body TEXT NOT NULL CHECK (length(trim(body)) > 0),
    weather TEXT
  );
  CREATE INDEX ix_notes_project_day ON site_notes(project_id, day);

  -- Photos and PDFs. The file lives in the app's documents folder; this row points to it.
  CREATE TABLE attachments (
    ${common},
    owner_table TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('photo','pdf','file')),
    file_name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    sha256 TEXT NOT NULL
  );
  CREATE INDEX ix_attach_owner ON attachments(owner_table, owner_id);

  -- Every write, who/what/when. Never updated, never deleted.
  CREATE TABLE audit_log (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    device_id TEXT NOT NULL,
    table_name TEXT NOT NULL,
    row_id TEXT NOT NULL,
    action TEXT NOT NULL,
    data TEXT
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT
  );

  CREATE VIEW v_project_cost AS
  SELECT p.id AS project_id,
         p.name,
         p.status,
         p.contract_cents,
         COALESCE((SELECT SUM(amount_cents) FROM expenses e
                   WHERE e.project_id = p.id AND e.deleted_at IS NULL), 0) AS expense_cents,
         COALESCE((SELECT SUM(amount_cents) FROM wage_entries w
                   WHERE w.project_id = p.id AND w.kind = 'work' AND w.deleted_at IS NULL), 0) AS labour_cents,
         COALESCE((SELECT SUM(amount_cents) FROM wage_entries w
                   WHERE w.project_id = p.id AND w.kind IN ('advance','payment') AND w.deleted_at IS NULL), 0) AS labour_paid_cents
  FROM projects p
  WHERE p.deleted_at IS NULL;

  CREATE VIEW v_worker_balance AS
  SELECT wk.id AS worker_id,
         wk.name,
         wk.trade,
         wk.daily_rate_cents,
         wk.active,
         COALESCE(SUM(CASE WHEN we.kind = 'work' THEN we.amount_cents END), 0) AS earned_cents,
         COALESCE(SUM(CASE WHEN we.kind = 'advance' THEN we.amount_cents END), 0) AS advance_cents,
         COALESCE(SUM(CASE WHEN we.kind = 'payment' THEN we.amount_cents END), 0) AS paid_cents,
         COALESCE(SUM(CASE WHEN we.kind = 'work' THEN we.amount_cents ELSE -we.amount_cents END), 0) AS balance_cents
  FROM workers wk
  LEFT JOIN wage_entries we ON we.worker_id = wk.id AND we.deleted_at IS NULL
  WHERE wk.deleted_at IS NULL
  GROUP BY wk.id;

  -- A tool is "out" when its latest movement is an issue.
  CREATE VIEW v_tool_status AS
  SELECT t.id AS tool_id,
         t.name,
         t.code,
         m.kind AS last_kind,
         m.day AS last_day,
         m.project_id,
         m.worker_id,
         m.taken_by,
         CASE WHEN m.kind = 'issue' THEN 1 ELSE 0 END AS is_out
  FROM tools t
  LEFT JOIN tool_movements m ON m.id = (
    SELECT id FROM tool_movements mm
    WHERE mm.tool_id = t.id AND mm.deleted_at IS NULL
    ORDER BY mm.day DESC, mm.created_at DESC LIMIT 1)
  WHERE t.deleted_at IS NULL;
  `,
];

/** Tables that hold business data, in an order where parents come before children. */
export const DATA_TABLES = [
  'projects',
  'workers',
  'tools',
  'expenses',
  'wage_entries',
  'tool_movements',
  'site_notes',
  'attachments',
] as const;

export type DataTable = (typeof DATA_TABLES)[number];

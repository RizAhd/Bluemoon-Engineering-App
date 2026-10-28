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

  // 2 — workers are assigned per project with their own rate
  `
  -- One logical row per (project, worker). assignWorker re-activates a
  -- soft-deleted row instead of inserting a second one.
  CREATE TABLE project_workers (
    ${common},
    project_id TEXT NOT NULL REFERENCES projects(id),
    worker_id TEXT NOT NULL REFERENCES workers(id),
    rate_cents INTEGER NOT NULL DEFAULT 0 CHECK (rate_cents >= 0),
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX ix_pw_project ON project_workers(project_id);
  CREATE INDEX ix_pw_worker ON project_workers(worker_id);

  -- Work entries are looked up per worker, project and day (one 'work' row each).
  CREATE INDEX ix_wage_worker_project_day ON wage_entries(worker_id, project_id, day);

  -- Balance of each worker on each project: earned here minus money given here.
  CREATE VIEW v_project_worker_balance AS
  SELECT pw.project_id,
         pw.worker_id,
         wk.name,
         wk.trade,
         wk.phone,
         pw.rate_cents,
         pw.active,
         COALESCE(SUM(CASE WHEN we.kind = 'work' THEN we.amount_cents END), 0) AS earned_cents,
         COALESCE(SUM(CASE WHEN we.kind = 'advance' THEN we.amount_cents END), 0) AS advance_cents,
         COALESCE(SUM(CASE WHEN we.kind = 'payment' THEN we.amount_cents END), 0) AS paid_cents,
         COALESCE(SUM(CASE WHEN we.kind = 'work' THEN we.amount_cents ELSE -we.amount_cents END), 0) AS balance_cents,
         COALESCE(SUM(CASE WHEN we.kind = 'work' THEN we.days END), 0) AS days_total
  FROM project_workers pw
  JOIN workers wk ON wk.id = pw.worker_id AND wk.deleted_at IS NULL
  LEFT JOIN wage_entries we
    ON we.worker_id = pw.worker_id AND we.project_id = pw.project_id AND we.deleted_at IS NULL
  WHERE pw.deleted_at IS NULL
  GROUP BY pw.project_id, pw.worker_id;

  -- One line per worker per project per day: what was worked and what was paid that day.
  CREATE VIEW v_wage_day AS
  SELECT we.project_id,
         we.worker_id,
         we.day,
         SUM(CASE WHEN we.kind = 'work' THEN we.days END) AS days,
         COALESCE(SUM(CASE WHEN we.kind = 'work' THEN we.amount_cents END), 0) AS work_cents,
         COALESCE(SUM(CASE WHEN we.kind = 'payment' THEN we.amount_cents END), 0) AS paid_cents,
         COALESCE(SUM(CASE WHEN we.kind = 'advance' THEN we.amount_cents END), 0) AS advance_cents
  FROM wage_entries we
  WHERE we.deleted_at IS NULL AND we.project_id IS NOT NULL
  GROUP BY we.project_id, we.worker_id, we.day;
  `,

  // 3 — wages recorded before migration 2 belong to a worker on a project; and one assignment per pair
  `
  -- Version 1 let wages be filed under a project without assigning the worker, and the project
  -- screens list workers from project_workers. Give every (project, worker) that already has wage
  -- entries an assignment at the worker's own daily rate, so nobody vanishes from the project
  -- they were paid on. A pair that has ever had an assignment (even a removed one) is left alone.
  -- The id is derived from the pair: two phones that upgrade the same data create the same row,
  -- so merging them cannot produce two assignments for one worker.
  -- (Not written to audit_log: this is the upgrade, not something a person did.)
  INSERT INTO project_workers (id, created_at, updated_at, deleted_at, version, device_id,
                               project_id, worker_id, rate_cents, active)
  SELECT 'pw:' || x.project_id || ':' || x.worker_id,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         NULL,
         1,
         COALESCE((SELECT value FROM settings WHERE key = 'device_id'), 'migration'),
         x.project_id,
         x.worker_id,
         wk.daily_rate_cents,
         wk.active
  FROM (SELECT DISTINCT worker_id, project_id
        FROM wage_entries
        WHERE project_id IS NOT NULL AND deleted_at IS NULL) x
  JOIN workers wk ON wk.id = x.worker_id AND wk.deleted_at IS NULL
  JOIN projects p ON p.id = x.project_id AND p.deleted_at IS NULL
  WHERE NOT EXISTS (SELECT 1 FROM project_workers pw
                    WHERE pw.project_id = x.project_id AND pw.worker_id = x.worker_id);

  -- Two phones can each assign the same worker to the same project while offline; after a merge
  -- both rows are live. Count such a pair once (newest rate), instead of once per row, which
  -- doubled every amount in the old view.
  DROP VIEW v_project_worker_balance;
  CREATE VIEW v_project_worker_balance AS
  SELECT pw.project_id,
         pw.worker_id,
         wk.name,
         wk.trade,
         wk.phone,
         pw.rate_cents,
         pw.active,
         COALESCE(SUM(CASE WHEN we.kind = 'work' THEN we.amount_cents END), 0) AS earned_cents,
         COALESCE(SUM(CASE WHEN we.kind = 'advance' THEN we.amount_cents END), 0) AS advance_cents,
         COALESCE(SUM(CASE WHEN we.kind = 'payment' THEN we.amount_cents END), 0) AS paid_cents,
         COALESCE(SUM(CASE WHEN we.kind = 'work' THEN we.amount_cents ELSE -we.amount_cents END), 0) AS balance_cents,
         COALESCE(SUM(CASE WHEN we.kind = 'work' THEN we.days END), 0) AS days_total
  FROM (
    SELECT a.project_id,
           a.worker_id,
           (SELECT b.rate_cents FROM project_workers b
            WHERE b.project_id = a.project_id AND b.worker_id = a.worker_id AND b.deleted_at IS NULL
            ORDER BY b.updated_at DESC, b.id DESC LIMIT 1) AS rate_cents,
           MAX(a.active) AS active
    FROM project_workers a
    WHERE a.deleted_at IS NULL
    GROUP BY a.project_id, a.worker_id
  ) pw
  JOIN workers wk ON wk.id = pw.worker_id AND wk.deleted_at IS NULL
  LEFT JOIN wage_entries we
    ON we.worker_id = pw.worker_id AND we.project_id = pw.project_id AND we.deleted_at IS NULL
  GROUP BY pw.project_id, pw.worker_id;
  `,

  // 4 — a worker who has left is inactive on every project roster
  `
  -- Marking a worker as left sets workers.active = 0, but the roster view only looked at the
  -- assignment's own flag, so the worker stayed "active" on every project and the Today screen's
  -- "All worked today" booked wages for them. A roster entry is active only while both the
  -- assignment and the worker are. The row stays (history and balance must remain visible).
  -- Same body as migration 3 apart from the active column.
  DROP VIEW v_project_worker_balance;
  CREATE VIEW v_project_worker_balance AS
  SELECT pw.project_id,
         pw.worker_id,
         wk.name,
         wk.trade,
         wk.phone,
         pw.rate_cents,
         MIN(pw.active, wk.active) AS active,
         COALESCE(SUM(CASE WHEN we.kind = 'work' THEN we.amount_cents END), 0) AS earned_cents,
         COALESCE(SUM(CASE WHEN we.kind = 'advance' THEN we.amount_cents END), 0) AS advance_cents,
         COALESCE(SUM(CASE WHEN we.kind = 'payment' THEN we.amount_cents END), 0) AS paid_cents,
         COALESCE(SUM(CASE WHEN we.kind = 'work' THEN we.amount_cents ELSE -we.amount_cents END), 0) AS balance_cents,
         COALESCE(SUM(CASE WHEN we.kind = 'work' THEN we.days END), 0) AS days_total
  FROM (
    SELECT a.project_id,
           a.worker_id,
           (SELECT b.rate_cents FROM project_workers b
            WHERE b.project_id = a.project_id AND b.worker_id = a.worker_id AND b.deleted_at IS NULL
            ORDER BY b.updated_at DESC, b.id DESC LIMIT 1) AS rate_cents,
           MAX(a.active) AS active
    FROM project_workers a
    WHERE a.deleted_at IS NULL
    GROUP BY a.project_id, a.worker_id
  ) pw
  JOIN workers wk ON wk.id = pw.worker_id AND wk.deleted_at IS NULL
  LEFT JOIN wage_entries we
    ON we.worker_id = pw.worker_id AND we.project_id = pw.project_id AND we.deleted_at IS NULL
  GROUP BY pw.project_id, pw.worker_id;
  `,

  // 5 — estimates (quotations): header, bill of quantities, payment schedule (docs/ESTIMATES.md)
  `
  CREATE TABLE estimates (
    ${common},
    number TEXT NOT NULL CHECK (length(trim(number)) > 0),
    client_name TEXT NOT NULL CHECK (length(trim(client_name)) > 0),
    client_phone TEXT,
    client_address TEXT,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    location TEXT,
    issue_day TEXT NOT NULL CHECK (issue_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    valid_days INTEGER NOT NULL DEFAULT 30 CHECK (valid_days BETWEEN 1 AND 365),
    discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
    -- basis points: 1800 = 18 %
    tax_bp INTEGER NOT NULL DEFAULT 0 CHECK (tax_bp BETWEEN 0 AND 10000),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','declined')),
    terms TEXT,
    notes TEXT,
    -- set when the accepted estimate was turned into a project
    project_id TEXT REFERENCES projects(id)
  );
  CREATE INDEX ix_estimates_status_day ON estimates(status, issue_day);
  CREATE INDEX ix_estimates_project ON estimates(project_id);

  -- Quantity is in thousandths (1000 = 1 unit, so 12.5 m2 = 12500), money in cents: nothing is a float.
  CREATE TABLE estimate_items (
    ${common},
    estimate_id TEXT NOT NULL REFERENCES estimates(id),
    position INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL CHECK (length(trim(description)) > 0),
    unit TEXT,
    qty_milli INTEGER NOT NULL CHECK (qty_milli BETWEEN 1 AND 1000000000),
    rate_cents INTEGER NOT NULL DEFAULT 0 CHECK (rate_cents BETWEEN 0 AND 5000000000)
  );
  CREATE INDEX ix_estimate_items_estimate ON estimate_items(estimate_id);

  -- A stage's share of the total in basis points (3000 = 30 %).
  CREATE TABLE estimate_payments (
    ${common},
    estimate_id TEXT NOT NULL REFERENCES estimates(id),
    position INTEGER NOT NULL DEFAULT 0,
    label TEXT NOT NULL CHECK (length(trim(label)) > 0),
    percent_bp INTEGER NOT NULL CHECK (percent_bp BETWEEN 1 AND 10000)
  );
  CREATE INDEX ix_estimate_payments_estimate ON estimate_payments(estimate_id);

  -- One row per live estimate, with or without items. Every amount is whole cents and every
  -- division rounds half up in integer arithmetic (all operands are non-negative):
  --   line amount = (qty_milli * rate_cents + 500) / 1000
  --   taxable     = max(0, subtotal - discount)
  --   tax         = (taxable * tax_bp + 5000) / 10000
  --   total       = taxable + tax
  -- Screens, the PDF and the contract value of a new project all read these numbers; nothing recomputes them.
  CREATE VIEW v_estimate_total AS
  SELECT c.estimate_id,
         c.item_count,
         c.subtotal_cents,
         c.discount_cents,
         c.tax_cents,
         c.taxable_cents + c.tax_cents AS total_cents,
         c.scheduled_bp
  FROM (
    SELECT b.estimate_id,
           b.item_count,
           b.subtotal_cents,
           b.discount_cents,
           b.scheduled_bp,
           b.taxable_cents,
           (b.taxable_cents * b.tax_bp + 5000) / 10000 AS tax_cents
    FROM (
      SELECT a.estimate_id,
             a.item_count,
             a.subtotal_cents,
             a.discount_cents,
             a.tax_bp,
             a.scheduled_bp,
             CASE WHEN a.subtotal_cents > a.discount_cents THEN a.subtotal_cents - a.discount_cents ELSE 0 END AS taxable_cents
      FROM (
        SELECT e.id AS estimate_id,
               (SELECT COUNT(*) FROM estimate_items i
                WHERE i.estimate_id = e.id AND i.deleted_at IS NULL) AS item_count,
               COALESCE((SELECT SUM((i.qty_milli * i.rate_cents + 500) / 1000) FROM estimate_items i
                         WHERE i.estimate_id = e.id AND i.deleted_at IS NULL), 0) AS subtotal_cents,
               e.discount_cents AS discount_cents,
               e.tax_bp AS tax_bp,
               COALESCE((SELECT SUM(p.percent_bp) FROM estimate_payments p
                         WHERE p.estimate_id = e.id AND p.deleted_at IS NULL), 0) AS scheduled_bp
        FROM estimates e
        WHERE e.deleted_at IS NULL
      ) a
    ) b
  ) c;
  `,

  // 6 — tools and materials by quantity. Counts are thousandths of a unit (1000 = one piece), like estimate
  // quantities, so a material can be 2.5 bags while the maths stays whole numbers. Every tool and movement that
  // existed is one piece (the column defaults), so nothing changes until a count is raised.
  `
  ALTER TABLE tools ADD COLUMN quantity_milli INTEGER NOT NULL DEFAULT 1000;
  ALTER TABLE tools ADD COLUMN unit TEXT;
  ALTER TABLE tools ADD COLUMN is_material INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE tool_movements ADD COLUMN qty_milli INTEGER NOT NULL DEFAULT 1000;

  -- How much of each tool or material is out (issued minus returned) and how much is left in store.
  CREATE VIEW v_tool_stock AS
  SELECT s.*, s.quantity_milli - s.out_milli AS in_store_milli
  FROM (
    SELECT t.id AS tool_id,
           t.name,
           t.code,
           t.unit,
           t.is_material,
           t.quantity_milli,
           COALESCE(SUM(CASE WHEN m.kind = 'issue' THEN m.qty_milli WHEN m.kind = 'return' THEN -m.qty_milli END), 0) AS out_milli
    FROM tools t
    LEFT JOIN tool_movements m ON m.tool_id = t.id AND m.deleted_at IS NULL
    WHERE t.deleted_at IS NULL
    GROUP BY t.id
  ) s;

  -- Who holds how much, only where something is still out. A single piece reads as it always did: whoever the last
  -- movement says has it, whoever brings it back. A tool with several pieces, or a material: issued minus returned
  -- per project and person. Pieces brought back under a name that never took them ("unmatched": Kamal took 3,
  -- Nimal brought 2 back) come off the oldest holders first, so the holders add up to what v_tool_stock says is out.
  CREATE VIEW v_tool_holders AS
  WITH net AS (
    SELECT m.tool_id, m.project_id, m.worker_id, m.taken_by,
           SUM(CASE WHEN m.kind = 'issue' THEN m.qty_milli ELSE -m.qty_milli END) AS net_milli,
           MIN(CASE WHEN m.kind = 'issue' THEN m.day END) AS first_day,
           MIN(CASE WHEN m.kind = 'issue' THEN m.created_at END) AS first_at
    FROM tool_movements m
    JOIN tools t ON t.id = m.tool_id AND t.deleted_at IS NULL AND (t.quantity_milli <> 1000 OR t.is_material = 1)
    WHERE m.deleted_at IS NULL
    GROUP BY m.tool_id, m.project_id, m.worker_id, m.taken_by
  ),
  counted AS (
    SELECT n.*,
           SUM(CASE WHEN n.net_milli < 0 THEN -n.net_milli ELSE 0 END) OVER (PARTITION BY n.tool_id) AS unmatched,
           SUM(CASE WHEN n.net_milli > 0 THEN n.net_milli ELSE 0 END)
             OVER (PARTITION BY n.tool_id ORDER BY n.first_day, n.first_at, n.project_id, n.worker_id, n.taken_by ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running
    FROM net n
  )
  SELECT c.tool_id, c.project_id, c.worker_id, c.taken_by,
         CASE WHEN c.running - c.net_milli >= c.unmatched THEN c.net_milli ELSE c.running - c.unmatched END AS qty_milli
  FROM counted c
  WHERE c.net_milli > 0 AND c.running > c.unmatched
  UNION ALL
  SELECT s.tool_id, s.project_id, s.worker_id, s.taken_by, 1000
  FROM v_tool_status s
  JOIN tools t ON t.id = s.tool_id
  WHERE s.is_out = 1 AND t.quantity_milli = 1000 AND t.is_material = 0;
  `,
];

/** Tables that hold business data, in an order where parents come before children. */
export const DATA_TABLES = [
  'projects',
  'estimates',
  'estimate_items',
  'estimate_payments',
  'workers',
  'tools',
  'project_workers',
  'expenses',
  'wage_entries',
  'tool_movements',
  'site_notes',
  'attachments',
] as const;

export type DataTable = (typeof DATA_TABLES)[number];

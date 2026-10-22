/**
 * Realistic sample data for development and screenshots. Only reachable from the
 * More screen when __DEV__ is true, so it never appears in a real build.
 * Safe to run twice: it does nothing if the first demo project already exists.
 */
import { first, tx } from '@/db';
import {
  assignWorker,
  moveTool,
  payWages,
  recordWorkDay,
  saveExpense,
  saveNote,
  saveProject,
  saveTool,
  saveWageEntry,
  saveWorker,
} from '@/db/repo';
import type { ExpenseCategory, PayMethod } from '@/db/types';
import { addDays, today } from '@/lib/dates';

const rs = (n: number) => Math.round(n * 100);

export function seedDemoData(): { created: boolean } {
  if (first('SELECT 1 AS ok FROM projects WHERE name = ?', ['Welimada Primary School Building'])) return { created: false };
  const td = today();
  const d = (n: number) => addDays(td, -n);

  tx(() => {
    const school = saveProject({
      name: 'Welimada Primary School Building',
      client: 'Zonal Education Office, Welimada',
      location: 'Welimada',
      contract_cents: rs(18_500_000),
      start_date: d(60),
      status: 'active',
    });
    const culvert = saveProject({
      name: 'Badulla Culvert Repair',
      client: 'RDA Badulla',
      location: 'Badulla',
      contract_cents: rs(4_200_000),
      start_date: d(20),
      status: 'active',
    });
    saveProject({
      name: 'Bandarawela Drain Renovation',
      client: 'Bandarawela UC',
      location: 'Bandarawela',
      contract_cents: rs(2_750_000),
      start_date: d(150),
      end_date: d(40),
      status: 'completed',
    });

    const w = (name: string, trade: string, rate: number, phone?: string) =>
      saveWorker({ name, trade, daily_rate_cents: rs(rate), phone: phone ?? null });
    const nimal = w('Nimal Perera', 'Mason', 3500, '0771234567');
    const sunil = w('Sunil Fernando', 'Carpenter', 3800, '0712345678');
    const kamal = w('Kamal Silva', 'Helper', 2200);
    const ruwan = w('Ruwan Jayasinghe', 'Bar bender', 3600, '0753456789');
    const anura = w('Anura Kumara', 'Helper', 2200);
    const saman = w('Saman Kumara', 'Mason', 3500);

    const onSchool: [string, number][] = [
      [nimal, 3500],
      [sunil, 3800],
      [kamal, 2200],
      [ruwan, 3600],
      [anura, 2200],
    ];
    for (const [id, rate] of onSchool) assignWorker({ project_id: school, worker_id: id, rate_cents: rs(rate) });
    const onCulvert: [string, number][] = [
      [saman, 3500],
      [kamal, 2300],
    ];
    for (const [id, rate] of onCulvert) assignWorker({ project_id: culvert, worker_id: id, rate_cents: rs(rate) });

    // Five days of work on the school; some paid, one advance.
    for (let n = 4; n >= 0; n--) {
      recordWorkDay({ project_id: school, worker_id: nimal, day: d(n), days: 1 });
      recordWorkDay({ project_id: school, worker_id: sunil, day: d(n), days: n === 2 ? 0.5 : 1 });
      if (n !== 3) recordWorkDay({ project_id: school, worker_id: kamal, day: d(n), days: 1 });
      if (n <= 2) recordWorkDay({ project_id: school, worker_id: ruwan, day: d(n), days: 1.5 });
      if (n === 0) recordWorkDay({ project_id: school, worker_id: anura, day: d(n), days: 1 });
    }
    payWages({ project_id: school, worker_id: nimal, day: d(1), amount_cents: rs(14_000), note: 'Weekly pay' });
    payWages({ project_id: school, worker_id: sunil, day: d(1), amount_cents: rs(10_000) });
    saveWageEntry({ worker_id: kamal, project_id: school, day: d(2), kind: 'advance', amount_cents: rs(5_000), note: 'Advance for medicine' });
    for (let n = 2; n >= 0; n--) recordWorkDay({ project_id: culvert, worker_id: saman, day: d(n), days: 1 });
    payWages({ project_id: culvert, worker_id: saman, day: d(0), amount_cents: rs(3_500) });

    const e = (project_id: string, n: number, category: ExpenseCategory, amount: number, paid_to: string, method: PayMethod = 'cash', note?: string) =>
      saveExpense({ project_id, day: d(n), category, amount_cents: rs(amount), paid_to, method, note: note ?? null });
    e(school, 0, 'materials', 185_000, 'Lanka Cement Depot, Welimada', 'bank', '50 bags OPC cement');
    e(school, 0, 'food', 4_200, 'Kumari Hotel');
    e(school, 1, 'transport', 18_500, 'Perera Transport', 'cash', 'Sand, 2 loads');
    e(school, 1, 'fuel', 12_000, 'Ceypetco Welimada');
    e(school, 2, 'materials', 96_400, 'Uva Hardware', 'cheque', 'Roofing sheets');
    e(school, 3, 'machinery', 42_000, 'Wasantha Excavators', 'cash', 'Excavator hire, 1 day');
    e(school, 5, 'subcontract', 120_000, 'Ranjan Electricals', 'bank', 'First fix wiring, advance');
    e(school, 8, 'tools', 7_800, 'Uva Hardware');
    e(school, 12, 'utilities', 9_650, 'CEB / Water Board');
    e(culvert, 0, 'materials', 64_300, 'Badulla Concrete Works', 'bank', 'Concrete pipes');
    e(culvert, 1, 'transport', 8_500, 'Silva Lorry Service');
    e(culvert, 2, 'food', 3_100, 'Site tea and lunch');

    const drill = saveTool({ name: 'Hilti drill', code: 'BM-T-001' });
    const mixer = saveTool({ name: 'Concrete mixer', code: 'BM-T-002' });
    saveTool({ name: 'Vibrator poker', code: 'BM-T-003' });
    saveTool({ name: 'Total station', code: 'BM-T-004', notes: 'Hand over only to the engineer' });
    const ladder = saveTool({ name: 'Aluminium ladder 12 ft', code: 'BM-T-005' });
    moveTool({ tool_id: drill, kind: 'issue', project_id: school, worker_id: sunil, day: d(2), condition: 'Good' });
    moveTool({ tool_id: mixer, kind: 'issue', project_id: school, worker_id: nimal, day: d(3), condition: 'Good' });
    moveTool({ tool_id: ladder, kind: 'issue', project_id: school, worker_id: kamal, day: d(6), condition: 'Good' });
    moveTool({ tool_id: ladder, kind: 'return', project_id: school, worker_id: kamal, day: d(4), condition: 'One rung loose' });

    saveNote({ project_id: school, day: d(0), body: 'First-floor slab shuttering completed on the east side. Waiting for the bar-bending inspection before pouring.', weather: 'sunny' });
    saveNote({ project_id: school, day: d(1), body: 'Rain after 3 pm, work stopped for the day. Covered the cement bags.', weather: 'rain' });
    saveNote({ project_id: culvert, day: d(0), body: 'Old pipes removed. RDA engineer visited and approved the new levels.', weather: 'cloudy' });
  });
  return { created: true };
}

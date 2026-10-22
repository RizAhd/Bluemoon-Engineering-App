/**
 * Tools: saveTool and moveTool (issue / return), including the id the form hands in so that
 * photos attached before the first save stay linked to the movement.
 */
import { all, first, newId } from '@/db';
import { deleteRecord, moveTool, saveProject, saveTool, saveWorker } from '@/db/repo';
import type { Attachment } from '@/db/types';
import { addPhotos, discardOrphans } from '@/lib/files';
import { queuePhotos, resetDb } from '@/test-utils';
import { useClock } from '@/test-utils/dataKit';

jest.setTimeout(60_000);

let project: string;
let nimal: string;
let drill: string;
let clock: ReturnType<typeof useClock>;

beforeEach(() => {
  resetDb();
  clock = useClock('2026-10-20T04:00:00.000Z');
  project = saveProject({ name: 'Welimada school' });
  nimal = saveWorker({ name: 'Nimal Perera', daily_rate_cents: 350_000 });
  drill = saveTool({ name: 'Hilti drill', code: 'BM-T-001' });
});

afterEach(() => clock.restore());

const status = (tool = drill) =>
  first<{ is_out: number; last_kind: string | null; last_day: string | null; project_id: string | null; worker_id: string | null; taken_by: string | null }>(
    'SELECT is_out, last_kind, last_day, project_id, worker_id, taken_by FROM v_tool_status WHERE tool_id = ?',
    [tool],
  );
const photosOf = (table: string, id: string) =>
  all<Attachment>('SELECT * FROM attachments WHERE owner_table = ? AND owner_id = ? AND deleted_at IS NULL ORDER BY created_at', [table, id]);

describe('saveTool', () => {
  it('creates, then edits the same row', () => {
    expect(first('SELECT name, code, version FROM tools WHERE id = ?', [drill])).toEqual({ name: 'Hilti drill', code: 'BM-T-001', version: 1 });
    clock.tick(1_000);
    expect(saveTool({ id: drill, name: 'Hilti TE-30 drill', code: 'BM-T-001', notes: 'battery in the office' })).toBe(drill);
    expect(first('SELECT name, notes, version FROM tools WHERE id = ?', [drill])).toEqual({ name: 'Hilti TE-30 drill', notes: 'battery in the office', version: 2 });
    expect(first('SELECT COUNT(*) AS n FROM tools')).toEqual({ n: 1 });
  });
});

describe('moveTool', () => {
  it('issues a tool to a worker on a project and the status shows it out', () => {
    const id = moveTool({ tool_id: drill, kind: 'issue', project_id: project, worker_id: nimal, day: '2026-10-19', condition: ' Good ', note: ' for the slab ' });
    expect(first('SELECT tool_id, kind, project_id, worker_id, taken_by, day, condition, note, version FROM tool_movements WHERE id = ?', [id])).toEqual({
      tool_id: drill,
      kind: 'issue',
      project_id: project,
      worker_id: nimal,
      taken_by: null,
      day: '2026-10-19',
      condition: 'Good',
      note: 'for the slab',
      version: 1,
    });
    expect(status()).toEqual({ is_out: 1, last_kind: 'issue', last_day: '2026-10-19', project_id: project, worker_id: nimal, taken_by: null });
  });

  it('issues a tool to a named outsider and to nobody in particular project-wise', () => {
    moveTool({ tool_id: drill, kind: 'issue', taken_by: '  Contractor Silva ', day: '2026-10-19' });
    expect(status()).toEqual({ is_out: 1, last_kind: 'issue', last_day: '2026-10-19', project_id: null, worker_id: null, taken_by: 'Contractor Silva' });
  });

  it('a return puts the tool back in, with the condition it came back in', () => {
    moveTool({ tool_id: drill, kind: 'issue', project_id: project, worker_id: nimal, day: '2026-10-19' });
    clock.tick(1_000);
    const back = moveTool({ tool_id: drill, kind: 'return', project_id: project, worker_id: nimal, day: '2026-10-20', condition: 'Chuck damaged' });
    expect(status()).toMatchObject({ is_out: 0, last_kind: 'return', last_day: '2026-10-20' });
    expect(first('SELECT condition FROM tool_movements WHERE id = ?', [back])).toEqual({ condition: 'Chuck damaged' });
    // both movements are kept: the history of who had the tool is never overwritten
    expect(first('SELECT COUNT(*) AS n FROM tool_movements WHERE tool_id = ?', [drill])).toEqual({ n: 2 });
  });

  it('one tool out does not make another tool out', () => {
    const mixer = saveTool({ name: 'Mixer' });
    moveTool({ tool_id: drill, kind: 'issue', worker_id: nimal, day: '2026-10-19' });
    expect(status(mixer)).toMatchObject({ is_out: 0, last_kind: null });
  });

  describe('the id passed in by the form', () => {
    it('is the id of the saved row, so photos taken before the first save stay linked', async () => {
      moveTool({ tool_id: drill, kind: 'issue', worker_id: nimal, day: '2026-10-18' }); // a tool can only come back once it is out
      const formId = newId();
      queuePhotos(2);
      expect(await addPhotos('tool_movements', formId, 'gallery')).toBe(2);
      expect(first('SELECT COUNT(*) AS n FROM tool_movements')).toEqual({ n: 1 }); // the return is not saved yet

      const saved = moveTool({ id: formId, tool_id: drill, kind: 'return', day: '2026-10-19', condition: 'Cracked housing' });

      expect(saved).toBe(formId);
      expect(first('SELECT id FROM tool_movements WHERE id = ?', [formId])).toEqual({ id: formId });
      expect(photosOf('tool_movements', formId)).toHaveLength(2);
      // leaving the form afterwards must not hide the photos of a movement that now exists
      discardOrphans('tool_movements', formId);
      expect(photosOf('tool_movements', formId)).toHaveLength(2);
    });

    it('photos of a movement that was never saved are hidden again, not lost', async () => {
      const formId = newId();
      queuePhotos(1);
      await addPhotos('tool_movements', formId, 'gallery');
      discardOrphans('tool_movements', formId);
      expect(photosOf('tool_movements', formId)).toEqual([]);
      expect(first('SELECT COUNT(*) AS n FROM attachments WHERE owner_id = ?', [formId])).toEqual({ n: 1 }); // the row stays for history
    });

    it('editing a saved movement keeps its id, its photos and bumps the version', async () => {
      const id = moveTool({ tool_id: drill, kind: 'issue', worker_id: nimal, day: '2026-10-19' });
      queuePhotos(1);
      await addPhotos('tool_movements', id, 'gallery');
      clock.tick(1_000);
      expect(moveTool({ id, tool_id: drill, kind: 'issue', worker_id: nimal, day: '2026-10-19', condition: 'Scratched' })).toBe(id);
      expect(first('SELECT condition, version FROM tool_movements WHERE id = ?', [id])).toEqual({ condition: 'Scratched', version: 2 });
      expect(photosOf('tool_movements', id)).toHaveLength(1);
      expect(first('SELECT COUNT(*) AS n FROM tool_movements')).toEqual({ n: 1 });
    });
  });

  it('deleting a movement removes it (and its photos) from the history and the status follows', async () => {
    const out = moveTool({ tool_id: drill, kind: 'issue', worker_id: nimal, day: '2026-10-19' });
    clock.tick(1_000);
    const back = moveTool({ tool_id: drill, kind: 'return', worker_id: nimal, day: '2026-10-20' });
    queuePhotos(1);
    await addPhotos('tool_movements', back, 'gallery');
    expect(status()?.is_out).toBe(0);

    deleteRecord('tool_movements', back);

    expect(status()).toMatchObject({ is_out: 1, last_kind: 'issue' }); // the earlier issue is the latest again
    expect(photosOf('tool_movements', back)).toEqual([]);
    expect(first('SELECT deleted_at FROM tool_movements WHERE id = ?', [back])).not.toEqual({ deleted_at: null });
    expect(first('SELECT deleted_at FROM tool_movements WHERE id = ?', [out])).toEqual({ deleted_at: null });
    expect(first('SELECT COUNT(*) AS n FROM tool_movements')).toEqual({ n: 2 });
  });

  it('deleting a tool hides it, its movements and all their photos, but keeps every row as history', async () => {
    const out = moveTool({ tool_id: drill, kind: 'issue', worker_id: nimal, day: '2026-10-19' });
    clock.tick(1_000);
    const back = moveTool({ tool_id: drill, kind: 'return', worker_id: nimal, day: '2026-10-20' });
    clock.tick(1_000);
    const again = moveTool({ tool_id: drill, kind: 'issue', project_id: project, worker_id: nimal, day: '2026-10-21' });
    queuePhotos(1);
    await addPhotos('tools', drill, 'gallery');
    queuePhotos(2);
    await addPhotos('tool_movements', out, 'gallery');
    queuePhotos(1);
    await addPhotos('tool_movements', again, 'gallery');

    deleteRecord('tools', drill);

    expect(all('SELECT * FROM v_tool_status')).toEqual([]);
    expect(photosOf('tools', drill)).toEqual([]);
    for (const m of [out, back, again]) expect(photosOf('tool_movements', m)).toEqual([]);
    expect(first('SELECT COUNT(*) AS n FROM tool_movements WHERE tool_id = ? AND deleted_at IS NULL', [drill])).toEqual({ n: 0 });
    // nothing is removed: the movements and the photos are still rows, marked deleted
    expect(first('SELECT COUNT(*) AS n FROM tool_movements WHERE tool_id = ?', [drill])).toEqual({ n: 3 });
    expect(first('SELECT COUNT(*) AS n FROM attachments WHERE deleted_at IS NOT NULL')).toEqual({ n: 4 });
    expect(first('SELECT COUNT(*) AS n FROM tools')).toEqual({ n: 1 });
  });

  it('deleting a tool writes one audit entry for each movement and photo it deleted, and no more', async () => {
    const out = moveTool({ tool_id: drill, kind: 'issue', worker_id: nimal, day: '2026-10-19' });
    clock.tick(1_000);
    const back = moveTool({ tool_id: drill, kind: 'return', worker_id: nimal, day: '2026-10-20' });
    queuePhotos(2);
    await addPhotos('tool_movements', out, 'gallery');
    queuePhotos(1);
    await addPhotos('tools', drill, 'gallery');
    const photos = all<{ id: string }>('SELECT id FROM attachments').map((a) => a.id);
    const seq = first<{ s: number }>('SELECT MAX(seq) AS s FROM audit_log')?.s ?? 0;
    clock.tick(1_000);

    deleteRecord('tools', drill);

    const entries = all<{ table_name: string; row_id: string; action: string }>('SELECT table_name, row_id, action FROM audit_log WHERE seq > ? ORDER BY seq', [seq]);
    expect(entries.every((e) => e.action === 'delete')).toBe(true);
    expect(entries.map((e) => `${e.table_name}:${e.row_id}`).sort()).toEqual(
      [`tools:${drill}`, `tool_movements:${out}`, `tool_movements:${back}`, ...photos.map((p) => `attachments:${p}`)].sort(),
    );
    // each deleted row gets the version bump of a delete, once
    expect(first('SELECT version FROM tool_movements WHERE id = ?', [out])).toEqual({ version: 2 });
    expect(first('SELECT version FROM tools WHERE id = ?', [drill])).toEqual({ version: 2 });
  });

  it('a movement that was already deleted keeps its own deleted_at and version when its tool is deleted', () => {
    const out = moveTool({ tool_id: drill, kind: 'issue', worker_id: nimal, day: '2026-10-19' });
    clock.tick(1_000);
    const back = moveTool({ tool_id: drill, kind: 'return', worker_id: nimal, day: '2026-10-20' });
    deleteRecord('tool_movements', back);
    const earlier = first('SELECT deleted_at, version FROM tool_movements WHERE id = ?', [back]);
    clock.tick(60_000);

    deleteRecord('tools', drill);

    expect(first('SELECT deleted_at, version FROM tool_movements WHERE id = ?', [back])).toEqual(earlier);
    expect(first('SELECT deleted_at FROM tool_movements WHERE id = ?', [out])).not.toEqual({ deleted_at: null });
  });

  it("deleting a tool leaves another tool's movements and status alone", () => {
    const mixer = saveTool({ name: 'Mixer' });
    moveTool({ tool_id: drill, kind: 'issue', worker_id: nimal, day: '2026-10-19' });
    clock.tick(1_000);
    const other = moveTool({ tool_id: mixer, kind: 'issue', worker_id: nimal, day: '2026-10-19' });

    deleteRecord('tools', drill);

    expect(all<{ tool_id: string; is_out: number }>('SELECT tool_id, is_out FROM v_tool_status')).toEqual([{ tool_id: mixer, is_out: 1 }]);
    expect(first('SELECT deleted_at, version FROM tool_movements WHERE id = ?', [other])).toEqual({ deleted_at: null, version: 1 });
  });

  it('deleting a tool with no movements still works, and deleting it twice changes nothing', () => {
    deleteRecord('tools', drill);
    const row = first('SELECT * FROM tools WHERE id = ?', [drill]);
    const audit = first<{ n: number }>('SELECT COUNT(*) AS n FROM audit_log')?.n;
    clock.tick(60_000);
    deleteRecord('tools', drill);
    expect(first('SELECT * FROM tools WHERE id = ?', [drill])).toEqual(row);
    expect(first<{ n: number }>('SELECT COUNT(*) AS n FROM audit_log')?.n).toBe(audit);
  });
});

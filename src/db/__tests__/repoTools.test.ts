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
      const formId = newId();
      queuePhotos(2);
      expect(await addPhotos('tool_movements', formId, 'gallery')).toBe(2);
      expect(first('SELECT COUNT(*) AS n FROM tool_movements')).toEqual({ n: 0 }); // not saved yet

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

  it('deleting a tool hides it and its photos but keeps its movement history', async () => {
    moveTool({ tool_id: drill, kind: 'issue', worker_id: nimal, day: '2026-10-19' });
    queuePhotos(1);
    await addPhotos('tools', drill, 'gallery');
    deleteRecord('tools', drill);
    expect(all('SELECT * FROM v_tool_status')).toEqual([]);
    expect(photosOf('tools', drill)).toEqual([]);
    expect(first('SELECT COUNT(*) AS n FROM tool_movements WHERE deleted_at IS NULL')).toEqual({ n: 1 });
    expect(first('SELECT COUNT(*) AS n FROM tools')).toEqual({ n: 1 });
  });
});

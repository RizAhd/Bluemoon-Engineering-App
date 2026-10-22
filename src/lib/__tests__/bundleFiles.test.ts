/**
 * The files (photos, PDFs) that travel with a bundle: a file that fails its SHA-256 check must
 * never be stored, must not stop the rows from importing, and must be reported; a truncated copy
 * is repaired by the next good import.
 */
import { File, Paths } from 'expo-file-system';

import type { Attachment } from '@/db/types';
import { addPhotos } from '@/lib/files';
import { mainPhone, openSecondPhone, queuePhotos, resetDb, silenceConsoleError, type Phone } from '@/test-utils';

jest.setTimeout(120_000);

let a: Phone;
let b: Phone;

beforeAll(() => {
  b = openSecondPhone();
});
afterAll(() => b.dispose());
beforeEach(() => {
  resetDb();
  b.resetDb();
  a = mainPhone();
});

/** A project with an expense, a photo on the project and two photos on the expense. */
async function projectWithPhotos() {
  const project = a.repo.saveProject({ name: 'With photos' });
  const expense = a.repo.saveExpense({ project_id: project, day: '2026-10-20', category: 'materials', amount_cents: 100_000, method: 'cash' });
  queuePhotos(1);
  await addPhotos('projects', project, 'gallery');
  queuePhotos(2);
  await addPhotos('expenses', expense, 'gallery');
  const atts = a.db.all<Attachment>('SELECT * FROM attachments ORDER BY created_at, id');
  expect(atts).toHaveLength(3);
  return { project, expense, atts };
}

/** What a hand-over PDF or backup part carries: the rows (as text) and the files (as bytes). */
function pack(phone: Phone, project: string) {
  const tables = phone.bundle.collectProject(project);
  const files = new Map<string, Uint8Array>();
  for (const att of phone.bundle.filesOf(tables)) files.set(att.file_name, phone.bundle.readFileBytes(att));
  return { tables: JSON.parse(JSON.stringify(tables)) as typeof tables, files };
}

function flipOneByte(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes);
  out[Math.floor(out.length / 2)] ^= 0xff;
  return out;
}

const onB = (att: Attachment) => b.files.fileFor(att);

describe('a file whose bytes do not match its SHA-256', () => {
  it('is reported, not stored, and does not stop any row from importing', async () => {
    const { project, atts } = await projectWithPhotos();
    const { tables, files } = pack(a, project);
    const bad = atts[1];
    files.set(bad.file_name, flipOneByte(files.get(bad.file_name) as Uint8Array)); // same length, one byte changed

    const mute = silenceConsoleError();
    const plan = await b.bundle.applyBundle(tables, files);
    mute.mockRestore();

    expect(plan.badFiles).toEqual([bad.file_name]);
    expect(plan.counts.inserted).toBe(1 + 1 + 3); // project, expense and all three attachment rows
    expect(b.db.all('SELECT name FROM projects')).toEqual([{ name: 'With photos' }]);
    expect(b.db.all('SELECT id FROM expenses')).toHaveLength(1);
    expect(b.db.all('SELECT id FROM attachments')).toHaveLength(3);

    expect(onB(bad).exists).toBe(false); // the damaged bytes were not written
    for (const good of [atts[0], atts[2]]) {
      expect(onB(good).exists).toBe(true);
      expect(await b.files.sha256(onB(good))).toBe(good.sha256);
    }
  });

  it('a file of the wrong length is caught the same way', async () => {
    const { project, atts } = await projectWithPhotos();
    const { tables, files } = pack(a, project);
    files.set(atts[0].file_name, (files.get(atts[0].file_name) as Uint8Array).slice(0, 10));
    const mute = silenceConsoleError();
    const plan = await b.bundle.applyBundle(tables, files);
    mute.mockRestore();
    expect(plan.badFiles).toEqual([atts[0].file_name]);
    expect(onB(atts[0]).exists).toBe(false);
  });

  it('every damaged file is listed, in the order the rows came', async () => {
    const { project, atts } = await projectWithPhotos();
    const { tables, files } = pack(a, project);
    for (const att of atts) files.set(att.file_name, flipOneByte(files.get(att.file_name) as Uint8Array));
    const plan = await b.bundle.applyBundle(tables, files);
    expect([...plan.badFiles].sort()).toEqual(atts.map((x) => x.file_name).sort());
    expect(plan.counts.inserted).toBe(5);
    for (const att of atts) expect(onB(att).exists).toBe(false);
  });

  it('a later import with the right bytes fills the missing file in, without duplicating any row', async () => {
    const { project, atts } = await projectWithPhotos();
    const { tables, files } = pack(a, project);
    const good = files.get(atts[1].file_name) as Uint8Array;
    files.set(atts[1].file_name, flipOneByte(good));
    await b.bundle.applyBundle(tables, files);
    expect(onB(atts[1]).exists).toBe(false);

    files.set(atts[1].file_name, good);
    const second = await b.bundle.applyBundle(tables, files);

    expect(second.badFiles).toEqual([]);
    expect(second.counts).toEqual({ inserted: 0, updated: 0, skipped: 5 });
    expect(onB(atts[1]).exists).toBe(true);
    expect(await b.files.sha256(onB(atts[1]))).toBe(atts[1].sha256);
    expect(b.db.all('SELECT id FROM attachments')).toHaveLength(3);
  });

  it('a damaged file never replaces a good copy the other phone already has', async () => {
    const { project, atts } = await projectWithPhotos();
    const { tables, files } = pack(a, project);
    await b.bundle.applyBundle(tables, files); // clean import first
    const before = onB(atts[0]).bytesSync();

    const bad = new Map(files);
    bad.set(atts[0].file_name, flipOneByte(files.get(atts[0].file_name) as Uint8Array));
    const mute = silenceConsoleError();
    const plan = await b.bundle.applyBundle(tables, bad);
    mute.mockRestore();

    expect(plan.badFiles).toEqual([atts[0].file_name]);
    expect(Array.from(onB(atts[0]).bytesSync())).toEqual(Array.from(before));
  });
});

describe('a file that is not in the bundle', () => {
  it('the rows still import and nothing is reported (the sender may have sent a PDF without photos)', async () => {
    const { project } = await projectWithPhotos();
    const { tables } = pack(a, project);
    const plan = await b.bundle.applyBundle(tables, new Map());
    expect(plan.badFiles).toEqual([]);
    expect(plan.counts.inserted).toBe(5);
    expect(b.db.all('SELECT id FROM attachments')).toHaveLength(3);
  });

  it('photos sent later arrive on the next import', async () => {
    const { project, atts } = await projectWithPhotos();
    const full = pack(a, project);
    await b.bundle.applyBundle(full.tables, new Map());
    for (const att of atts) expect(onB(att).exists).toBe(false);
    const plan = await b.bundle.applyBundle(full.tables, full.files);
    expect(plan.badFiles).toEqual([]);
    for (const att of atts) expect(onB(att).exists).toBe(true);
  });

  it('a deleted attachment has no file written, even if the bytes are in the bundle', async () => {
    const { project, atts } = await projectWithPhotos();
    a.files.removeAttachment(atts[2].id);
    const { tables, files } = pack(a, project);
    files.set(atts[2].file_name, a.bundle.readFileBytes(atts[2])); // the sender's file is still on disk
    await b.bundle.applyBundle(tables, files);
    expect(onB(atts[2]).exists).toBe(false);
    expect(b.db.first('SELECT deleted_at IS NOT NULL AS gone FROM attachments WHERE id = ?', [atts[2].id])).toEqual({ gone: 1 });
  });
});

describe('a truncated copy', () => {
  it('on the receiving phone is repaired by the next good import', async () => {
    const { project, atts } = await projectWithPhotos();
    const { tables, files } = pack(a, project);
    await b.bundle.applyBundle(tables, files);
    const victim = atts[0];
    const copy = onB(victim);
    copy.writeSync(copy.bytesSync().slice(0, 7)); // a torn write: shorter than the row says
    expect(copy.size).toBeLessThan(victim.size);

    const plan = await b.bundle.applyBundle(tables, files);

    expect(plan.badFiles).toEqual([]);
    expect(plan.counts.inserted + plan.counts.updated).toBe(0); // the rows are the same; only the file was fixed
    expect(onB(victim).size).toBe(victim.size);
    expect(await b.files.sha256(onB(victim))).toBe(victim.sha256);
  });

  it('a good copy is left alone (not rewritten) by the next import', async () => {
    const { project, atts } = await projectWithPhotos();
    const { tables, files } = pack(a, project);
    await b.bundle.applyBundle(tables, files);
    const before = onB(atts[0]).modificationTime;
    await new Promise((r) => setTimeout(r, 30));
    await b.bundle.applyBundle(tables, files);
    expect(onB(atts[0]).modificationTime).toBe(before);
  });

  it('on the sending phone is never packed (its size no longer matches its row); the rows still go', async () => {
    const { project, atts } = await projectWithPhotos();
    const torn = a.files.fileFor(atts[1]);
    torn.writeSync(torn.bytesSync().slice(0, 5));

    const tables = a.bundle.collectProject(project);
    expect(a.bundle.filesOf(tables).map((x) => x.file_name).sort()).toEqual([atts[0].file_name, atts[2].file_name].sort());

    const { files, tables: wire } = pack(a, project);
    expect(files.has(atts[1].file_name)).toBe(false);
    const plan = await b.bundle.applyBundle(wire, files);
    expect(plan.badFiles).toEqual([]);
    expect(b.db.all('SELECT id FROM attachments')).toHaveLength(3);
    expect(onB(atts[1]).exists).toBe(false);
  });

  it('a file that is missing on the sending phone is not packed either', async () => {
    const { project, atts } = await projectWithPhotos();
    a.files.fileFor(atts[0]).delete();
    const tables = a.bundle.collectProject(project);
    expect(a.bundle.filesOf(tables).map((x) => x.file_name)).not.toContain(atts[0].file_name);
  });
});

describe('a file name that points outside the attachments folder', () => {
  /** A bundle whose first attachment row claims `name`, with matching bytes and SHA-256, so only the name is wrong. */
  async function hostile(name: string) {
    const { project } = await projectWithPhotos();
    const { tables, files } = pack(a, project);
    const payload = new TextEncoder().encode('overwritten by an imported file');
    const rows = tables.attachments as unknown as Record<string, unknown>[];
    rows[0] = { ...rows[0], file_name: name, size: payload.length, sha256: await a.bundle.sha256Hex(payload) };
    files.set(name, payload);
    return { tables, files, payload };
  }
  const outside = () =>
    b.run(() => ({
      inDocuments: new File(Paths.document, 'evil.bin').exists,
      inRoot: new File(Paths.document.parentDirectory, 'evil.bin').exists,
      inAttachments: new File(Paths.document, 'attachments', 'evil.bin').exists,
    }));

  it.each(['../evil.bin', '../../evil.bin', '../SQLite/bluemoon.db', 'sub/evil.bin', '..', '.hidden', 'a' + String.fromCharCode(92) + 'evil.bin'])('%p is never written; the file is reported and the rows still import', async (name) => {
    const { tables, files } = await hostile(name);
    const mute = silenceConsoleError();
    const plan = await b.bundle.applyBundle(tables, files);
    mute.mockRestore();
    expect(plan.badFiles).toContain(name);
    expect(plan.counts.inserted).toBe(5);
    expect(outside()).toEqual({ inDocuments: false, inRoot: false, inAttachments: false });
    expect(b.run(() => new File(Paths.document, 'SQLite', 'bluemoon.db').exists)).toBe(false);
    // the two honest photos came across
    const honest = b.db.all<Attachment>('SELECT * FROM attachments').filter((x) => x.file_name !== name);
    expect(honest).toHaveLength(2);
    for (const att of honest) expect(b.files.fileFor(att).exists).toBe(true);
  });

  it('reading an imported row with such a name finds no file (it cannot be used to read other files either)', async () => {
    const { tables, files } = await hostile('../SQLite/bluemoon.db');
    await b.bundle.applyBundle(tables, files);
    const att = b.db.all<Attachment>('SELECT * FROM attachments').find((x) => x.file_name === '../SQLite/bluemoon.db') as Attachment;
    expect(b.files.fileFor(att).exists).toBe(false);
    expect(b.bundle.filesOf(b.bundle.collectAll()).map((x) => x.file_name)).not.toContain(att.file_name);
  });

  it('writeAttachmentBytes refuses such a name outright', () => {
    for (const name of ['../x.jpg', 'a/b.jpg', '', '.', '..']) expect(() => a.files.writeAttachmentBytes(name, new Uint8Array([1]))).toThrow(/Unsafe attachment file name/);
    expect(() => a.files.writeAttachmentBytes('0a1b2c3d-0000-4000-8000-000000000001.jpg', new Uint8Array([1]))).not.toThrow();
  });
});

describe('writeAttachmentBytes', () => {
  it('writes a new file, and leaves no temporary file behind', () => {
    a.files.writeAttachmentBytes('abc.jpg', new Uint8Array([1, 2, 3]));
    const f = new File(a.files.attachmentsDir(), 'abc.jpg');
    expect(Array.from(f.bytesSync())).toEqual([1, 2, 3]);
    expect(a.files.attachmentsDir().list().map((e) => e.name)).toEqual(['abc.jpg']);
  });

  it('replaces a damaged file as one step, and a leftover .tmp from a crash does not get in the way', () => {
    a.files.writeAttachmentBytes('abc.jpg', new Uint8Array([9, 9]));
    const leftover = new File(a.files.attachmentsDir(), 'abc.jpg.tmp');
    leftover.create();
    leftover.writeSync(new Uint8Array([7]));
    a.files.writeAttachmentBytes('abc.jpg', new Uint8Array([1, 2, 3, 4]));
    expect(Array.from(new File(a.files.attachmentsDir(), 'abc.jpg').bytesSync())).toEqual([1, 2, 3, 4]);
    expect(a.files.attachmentsDir().list().map((e) => e.name)).toEqual(['abc.jpg']);
  });

  it('lives in the permanent documents folder, never the cache that Android may clear', () => {
    expect(a.files.attachmentsDir().uri.startsWith(Paths.document.uri)).toBe(true);
    expect(a.files.attachmentsDir().uri.startsWith(Paths.cache.uri)).toBe(false);
  });
});

describe('sha256Hex', () => {
  it('is the standard SHA-256 in lower-case hex', async () => {
    expect(await a.bundle.sha256Hex(new TextEncoder().encode('Bluemoon'))).toBe('48d2ccc8fc161fa27c91721022023e4ca5bb6ae80d1ef111f509b976c950c093');
    expect(await a.bundle.sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

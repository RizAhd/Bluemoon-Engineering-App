/**
 * Password-protected full backups: made as .bmbackup, restored only with the right password, and the
 * plain .zip backups made before (or without a password) still restore exactly as before.
 */
import { File, Paths } from 'expo-file-system';

import { DATA_TABLES } from '@/db/schema';
import { mainPhone, openSecondPhone, resetDb, seedDemo, type Phone } from '@/test-utils';

jest.setTimeout(180_000);

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
  seedDemo();
});

function dump(phone: Phone) {
  return Object.fromEntries(DATA_TABLES.map((t) => [t, phone.db.all(`SELECT * FROM ${t} ORDER BY id`)]));
}

/** The file one phone made, copied to another phone's cache (as if shared through Drive). */
function carry(from: Phone, file: File, to: Phone, name = file.name): string {
  const bytes = from.run(() => file.bytesSync());
  return to.run(() => {
    const f = new File(Paths.cache, name);
    if (f.exists) f.delete();
    f.create();
    f.writeSync(bytes);
    return f.uri;
  });
}

describe('full backup with a password', () => {
  it('is a .bmbackup that does not show the records, and restores on a new phone with the password', async () => {
    const files = await a.backup.makeBackup(undefined, 'welimada-2026');
    expect(files).toHaveLength(1);
    expect(files[0].name).toMatch(/^Bluemoon-backup-.*\.bmbackup$/);
    const bytes = a.run(() => files[0].bytesSync());
    expect(new TextDecoder().decode(bytes.slice(0, 6))).toBe('BMENC1');
    const projectName = a.db.first<{ name: string }>('SELECT name FROM projects LIMIT 1')?.name as string;
    expect(Buffer.from(bytes).includes(Buffer.from(projectName))).toBe(false);
    expect(Buffer.from(bytes).includes(Buffer.from('data.json'))).toBe(false);

    const uri = carry(a, files[0], b);
    expect(await b.backup.isEncryptedBackup(uri)).toBe(true);
    const res = await b.backup.restorePart(uri, 'welimada-2026');
    expect(res.plan.counts.inserted).toBeGreaterThan(0);
    expect(dump(b)).toEqual(dump(a));
  });

  it('without the password it asks for one; with a wrong one it says so; nothing is changed either way', async () => {
    const [file] = await a.backup.makeBackup(undefined, 'right-password');
    const uri = carry(a, file, b);
    const before = dump(b);
    await expect(b.backup.restorePart(uri)).rejects.toMatchObject({ message: 'needs-password' });
    await expect(b.backup.restorePart(uri, 'wrong-password')).rejects.toMatchObject({ message: 'wrong-password' });
    expect(dump(b)).toEqual(before);
    await b.backup.restorePart(uri, 'right-password');
    expect(dump(b)).toEqual(dump(a));
  });

  it('refuses a password under 6 characters before doing any work', async () => {
    await expect(a.backup.makeBackup(undefined, '12345')).rejects.toMatchObject({ message: 'password-short' });
  });

  it('a damaged encrypted file is refused like a wrong password, never half-restored', async () => {
    const [file] = await a.backup.makeBackup(undefined, 'password1');
    const bytes = a.run(() => file.bytesSync()).slice();
    bytes[bytes.length - 100] ^= 0xff;
    const uri = b.run(() => {
      const f = new File(Paths.cache, 'bad.bmbackup');
      f.create();
      f.writeSync(bytes);
      return f.uri;
    });
    const before = dump(b);
    await expect(b.backup.restorePart(uri, 'password1')).rejects.toMatchObject({ message: 'wrong-password' });
    expect(dump(b)).toEqual(before);
  });
});

describe('plain backups still work', () => {
  it('without a password the backup is a .zip, restores with no password, and a password given anyway is ignored', async () => {
    const [file] = await a.backup.makeBackup();
    expect(file.name).toMatch(/\.zip$/);
    const uri = carry(a, file, b);
    expect(await b.backup.isEncryptedBackup(uri)).toBe(false);
    await b.backup.restorePart(uri);
    expect(dump(b)).toEqual(dump(a));
    b.resetDb(); // also empties b's cache, so carry the file again
    await b.backup.restorePart(carry(a, file, b), 'any-password');
    expect(dump(b)).toEqual(dump(a));
  });

  it('the daily snapshot stays a plain zip', async () => {
    const snap = await a.backup.dataSnapshot();
    expect([snap[0], snap[1]]).toEqual([0x50, 0x4b]); // "PK"
  });
});

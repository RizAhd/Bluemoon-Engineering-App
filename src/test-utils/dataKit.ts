/**
 * Small helpers shared by the data-layer integration tests (src/db/__tests__, src/lib/__tests__).
 * Not exported from index.ts on purpose: import from '@/test-utils/dataKit'.
 */
import * as SQLite from 'expo-sqlite';

import { DB_NAME } from '@/db';
import { migrations } from '@/db/schema';

import { world } from './world';

type Fakeable =
  | 'Date'
  | 'hrtime'
  | 'nextTick'
  | 'performance'
  | 'queueMicrotask'
  | 'requestAnimationFrame'
  | 'cancelAnimationFrame'
  | 'requestIdleCallback'
  | 'cancelIdleCallback'
  | 'setImmediate'
  | 'clearImmediate'
  | 'setInterval'
  | 'clearInterval'
  | 'setTimeout'
  | 'clearTimeout';

const EVERYTHING_BUT_DATE: Exclude<Fakeable, 'Date'>[] = [
  'hrtime',
  'nextTick',
  'performance',
  'queueMicrotask',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
  'setImmediate',
  'clearImmediate',
  'setInterval',
  'clearInterval',
  'setTimeout',
  'clearTimeout',
];

/**
 * Freeze the wall clock (Date only: promises, setImmediate and timers stay real, so JSZip and
 * the async file code keep working). `set()` moves it, `tick()` advances it.
 */
export function useClock(start: string | Date) {
  jest.useFakeTimers({ now: new Date(start), doNotFake: EVERYTHING_BUT_DATE });
  return {
    set(at: string | Date) {
      jest.setSystemTime(new Date(at));
    },
    tick(ms = 1) {
      jest.setSystemTime(new Date(Date.now() + ms));
    },
    restore() {
      jest.useRealTimers();
    },
  };
}

/** The local calendar day of an ISO instant, the way the app stores days. */
export function dayOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The names of the objects migration 1 creates, i.e. what a phone that never updated still has. */
export const V1_TABLES = ['projects', 'expenses', 'workers', 'wage_entries', 'tools', 'tool_movements', 'site_notes', 'attachments', 'audit_log', 'settings'];

/**
 * Open the (empty) database of the active phone the way the PREVIOUS app version left it:
 * only the migrations before `upTo` applied and user_version set to `upTo`.
 * The app's own getDb() later upgrades it. The connection is returned open (call closeSync()).
 */
export function openLegacyDb(upTo = 1): SQLite.SQLiteDatabase {
  const old = SQLite.openDatabaseSync(DB_NAME);
  old.execSync('PRAGMA foreign_keys = ON;');
  old.withTransactionSync(() => {
    for (let v = 0; v < upTo; v++) old.execSync(migrations[v]);
    old.execSync(`PRAGMA user_version = ${upTo}`);
  });
  return old;
}

/** Forget everything the camera / gallery doubles were told (queued photos, a denied permission, a pending result). */
export function resetPicker(): void {
  const { picker } = world();
  picker.queue.length = 0;
  picker.pending = null;
  picker.cameraGranted = true;
}

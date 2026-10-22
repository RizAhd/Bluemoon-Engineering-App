/**
 * Timestamps are stored in UTC ("2026-10-21T19:30:00.000Z") but a person reads local calendar days. A
 * backup made at 1 am in Sri Lanka (UTC+5:30) is on the previous UTC day; the screens must still call it
 * "today" and show the local date. (On a machine whose zone is UTC itself there is no such moment and these
 * tests are skipped.)
 */
import '@/test-utils/rnMocks'; // must be first: the jest.mock() calls have to run before any screen is loaded

import { waitFor } from '@testing-library/react-native';

import BackupScreen from '@/app/backup';
import ImportScreen from '@/app/import';
import MoreScreen from '@/app/more';
import { setSetting } from '@/db';
import { addDays, formatDay, today } from '@/lib/dates';
import { exportProjectPdf } from '@/lib/pdf';
import { File, Paths, queueFilePick, resetDb, seedDemo } from '@/test-utils';
import { isoOnLocalDayOffUtc, projectId, SCHOOL } from '@/test-utils/screenData';
import { expectClean, makeTr, pressLabel, renderScreen, visibleText } from '@/test-utils/screenKit';

const E = makeTr('en');
const justAfterMidnightToday = isoOnLocalDayOffUtc(today());
const justAfterMidnightYesterday = isoOnLocalDayOffUtc(addDays(today(), -1));
const zoneTest = justAfterMidnightToday && justAfterMidnightYesterday ? it : it.skip;

beforeEach(() => {
  resetDb();
  setSetting('lang', 'en');
  setSetting('theme', 'light');
});

describe('backup screen near local midnight', () => {
  zoneTest('a backup made after local midnight is "today", not late', async () => {
    setSetting('auto_backup_at', justAfterMidnightToday);
    await renderScreen(<BackupScreen />);
    expectClean('backup tz');
    expect(visibleText()).toContain(E('dataSafe'));
    expect(visibleText()).not.toContain(E('autoBackupLast'));
  });

  zoneTest('yesterday\'s backup and full backup show the local date, not the UTC date', async () => {
    setSetting('auto_backup_at', justAfterMidnightYesterday);
    setSetting('last_backup_at', justAfterMidnightYesterday);
    await renderScreen(<BackupScreen />);
    const yesterday = formatDay(addDays(today(), -1));
    expect(visibleText()).toContain(`${E('autoBackupLast')}: ${yesterday} `);
    expect(visibleText()).toContain(`${E('lastBackup')}: ${yesterday} `);
  });
});

describe('import screen near local midnight', () => {
  zoneTest('"from phone" shows the local day the PDF was made', async () => {
    seedDemo();
    // make the PDF at 00:30 local time on the current day; only the clock is faked
    jest.useFakeTimers({
      now: new Date(justAfterMidnightToday as string),
      doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'hrtime', 'performance'],
    });
    const bytes = (await exportProjectPdf(projectId(SCHOOL), { includePhotos: false, letterhead: false })).bytesSync();
    jest.useRealTimers();
    resetDb();
    setSetting('lang', 'en');
    const f = new File(Paths.cache, 'midnight.pdf');
    f.create();
    f.writeSync(bytes);
    queueFilePick(f.uri);
    await renderScreen(<ImportScreen />);
    await pressLabel(E('choosePdf'));
    await waitFor(() => expect(visibleText()).toContain(SCHOOL));
    expect(visibleText()).toContain(`${E('fromPhone')}: ${formatDay(today())}`);
  });
});

describe('settings screen near local midnight', () => {
  // KNOWN BUG (src/app/more.tsx): `autoAt.slice(0, 10) === today()` compares the UTC day of the timestamp with
  // the local day, so for the first hours of every local day the backup row says "late" although it just ran.
  // The Today screen does it right (toDay(new Date(autoAt))). When more.tsx is fixed this test starts failing:
  // change `it.failing` to `it`.
  (justAfterMidnightToday ? it.failing : it.skip)('a backup made after local midnight shows as done today', async () => {
    setSetting('auto_backup_at', justAfterMidnightToday);
    await renderScreen(<MoreScreen />);
    expect(visibleText()).toContain(`${E('dataSafe')} · `);
  });
});

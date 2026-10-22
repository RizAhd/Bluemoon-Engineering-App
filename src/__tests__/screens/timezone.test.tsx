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
  // more.tsx used to compare `autoAt.slice(0, 10)` (the UTC day) with today() (the local day), so for the first hours of
  // every local day the backup row said "late" although it just ran. It now compares local days, as the Today screen does.
  zoneTest('a backup made after local midnight shows as done today, at its local time', async () => {
    setSetting('auto_backup_at', justAfterMidnightToday);
    await renderScreen(<MoreScreen />);
    expectClean('more tz');
    const localTime = new Date(justAfterMidnightToday as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    expect(visibleText()).toContain(`${E('dataSafe')} · ${localTime}`);
    expect(visibleText()).not.toContain(E('autoBackupLast'));
  });

  zoneTest("yesterday's backup shows the local date, not the UTC date", async () => {
    setSetting('auto_backup_at', justAfterMidnightYesterday);
    await renderScreen(<MoreScreen />);
    expect(visibleText()).toContain(`${E('autoBackupLast')}: ${formatDay(addDays(today(), -1))}`);
    expect(visibleText()).not.toContain(E('dataSafe'));
  });

  zoneTest('a failed run is still shown as failed when only yesterday\'s backup is on record', async () => {
    setSetting('auto_backup_at', justAfterMidnightYesterday);
    setSetting('auto_backup_error', '2026-01-01T00:00:00.000Z database is locked');
    await renderScreen(<MoreScreen />);
    expect(visibleText()).toContain(E('autoBackupFailed'));
  });

  zoneTest('a failed run does not show once today\'s backup has been made', async () => {
    setSetting('auto_backup_at', justAfterMidnightToday);
    setSetting('auto_backup_error', '2026-01-01T00:00:00.000Z database is locked');
    await renderScreen(<MoreScreen />);
    expect(visibleText()).not.toContain(E('autoBackupFailed'));
    expect(visibleText()).toContain(`${E('dataSafe')} · `);
  });
});

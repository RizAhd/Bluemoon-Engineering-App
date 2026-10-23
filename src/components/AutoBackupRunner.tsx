import { useEffect } from 'react';
import { AppState } from 'react-native';

import { recoverPendingPhoto } from '@/lib/files';
import { registerDailyBackupTask, runDailyBackup } from '@/lib/autoBackup';

/**
 * Makes the daily backup reliable: it runs when the app starts and every time
 * it comes back to the front, and also registers the Android background task
 * for days the app is not opened. Each run also copies the day's snapshot to the owner's phone folder and
 * Google Drive when those are set up. Renders nothing.
 */
export function AutoBackupRunner() {
  useEffect(() => {
    registerDailyBackupTask();
    recoverPendingPhoto(); // a photo taken just before Android restarted the app
    // Let the first screen draw before doing any work.
    const first = setTimeout(() => void runDailyBackup(), 2500);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void runDailyBackup();
    });
    return () => {
      clearTimeout(first);
      sub.remove();
    };
  }, []);
  return null;
}

import { useEffect } from 'react';
import { AppState } from 'react-native';

import { registerDailyBackupTask, runAutoBackupIfDue } from '@/lib/autoBackup';

/**
 * Makes the daily backup reliable: it runs when the app starts and every time
 * it comes back to the front, and also registers the Android background task
 * for days the app is not opened. Renders nothing.
 */
export function AutoBackupRunner() {
  useEffect(() => {
    registerDailyBackupTask();
    // Let the first screen draw before doing any work.
    const first = setTimeout(() => runAutoBackupIfDue(), 2500);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') runAutoBackupIfDue();
    });
    return () => {
      clearTimeout(first);
      sub.remove();
    };
  }, []);
  return null;
}

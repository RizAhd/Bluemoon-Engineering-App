import { useEffect } from 'react';
import { Alert } from 'react-native';

import { toast } from '@/components/ui/feedback';
import { getSetting, notify, setSetting } from '@/db';
import { useT } from '@/i18n';
import { listAutoBackups, restoreNewestAutoBackup, runAutoBackupIfDue } from '@/lib/autoBackup';
import { showError } from '@/lib/errors';

/**
 * If the phone database was unreadable and had to be set aside (see getDb), offer to
 * bring the records back from the newest automatic backup. Daily snapshots are paused
 * until the owner chooses, so the good ones are never overwritten by an empty one.
 * Renders nothing.
 */
export function RecoveryPrompt() {
  const t = useT();

  useEffect(() => {
    if (!getSetting('recovered_from_corruption')) return;
    const hasBackup = listAutoBackups().length > 0;

    const clear = () => {
      setSetting('recovered_from_corruption', null);
      notify();
      runAutoBackupIfDue();
    };

    if (!hasBackup) {
      Alert.alert(t('recoveredTitle'), `${t('recoveredBody')}\n\n${t('noAutoBackup')}`, [
        { text: t('startFresh'), style: 'destructive', onPress: clear },
        { text: t('notNow'), style: 'cancel' },
      ]);
      return;
    }

    Alert.alert(t('recoveredTitle'), t('recoveredBody'), [
      {
        text: t('restoreNewest'),
        onPress: async () => {
          try {
            await restoreNewestAutoBackup();
            clear();
            toast(t('recoverDone'));
          } catch (e) {
            showError(e, 'recovery.restore', t);
          }
        },
      },
      { text: t('startFresh'), style: 'destructive', onPress: clear },
      { text: t('notNow'), style: 'cancel' },
    ]);
    // Once per app start: the flag stays set until the owner chooses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

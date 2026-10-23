import { Cloud, CloudOff, FolderOpen, X } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Alert } from 'react-native';

import { IconButton } from '@/components/ui/Button';
import { toast } from '@/components/ui/feedback';
import { ListCard, ListRow, SectionTitle } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { getSetting, setSetting, useSetting } from '@/db';
import { useT, type TKey } from '@/i18n';
import { mirrorTodaysSnapshot, runAutoBackupIfDue } from '@/lib/autoBackup';
import { formatDay, toDay, today } from '@/lib/dates';
import { connectDrive, disconnectDrive, DriveError } from '@/lib/drive';
import { reportError } from '@/lib/errors';
import { folderName, forgetPhoneFolder, pickPhoneFolder } from '@/lib/phoneFolder';
import { useColors } from '@/theme';

/** "Today 19:45" / "23 Oct 2026 19:45" for a stored ISO time. */
function when(iso: string, t: (k: TKey) => string) {
  const day = toDay(new Date(iso));
  const time = new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${day === today() ? t('today') : formatDay(day)} ${time}`;
}

/** The words for a Drive failure. */
export function driveErrorKey(e: unknown): TKey {
  const reason = e instanceof DriveError ? e.reason : 'failed';
  switch (reason) {
    case 'notSetUp':
      return 'driveNotSetUp';
    case 'offline':
      return 'driveOffline';
    case 'denied':
      return 'driveDenied';
    case 'noPlayServices':
      return 'driveNoPlayServices';
    case 'unavailable':
      return 'driveUnavailable';
    default:
      return 'driveFailed';
  }
}

/**
 * Settings → Backup → "Where copies are kept": a folder on the phone the owner chose, and their Google Drive.
 * Each row says where, and when the last copy went there; a tap sets it up, or offers what can be done next.
 */
export function BackupPlaces() {
  const t = useT();
  const c = useColors();
  const folderUri = useSetting('backup_folder_uri');
  const folderAt = useSetting('backup_folder_at');
  const folderError = useSetting('backup_folder_error');
  const email = useSetting('drive_email');
  const driveAt = useSetting('drive_last_at');
  const driveError = useSetting('drive_error');
  const [working, setWorking] = useState<'folder' | 'drive' | null>(null);

  async function chooseFolder() {
    if (working) return;
    setWorking('folder');
    try {
      if (await pickPhoneFolder()) {
        const r = await mirrorTodaysSnapshot();
        if (r.folder === 'failed') toast(t('phoneFolderFailed'), { tone: 'danger' });
        else toast(t('folderSaved'));
      }
    } catch (e) {
      reportError(e, 'backup.folder');
      toast(t('phoneFolderFailed'), { tone: 'danger' });
    } finally {
      setWorking(null);
    }
  }

  function folderMenu() {
    Alert.alert(t('phoneFolder'), folderUri ? folderName(folderUri) : '', [
      { text: t('cancel'), style: 'cancel' },
      { text: t('stopFolder'), style: 'destructive', onPress: forgetPhoneFolder },
      { text: t('changeFolder'), onPress: () => void chooseFolder() },
    ]);
  }

  async function uploadNow() {
    setWorking('drive');
    try {
      // today's snapshot first (if the day has none yet), then send it even if it went up earlier today
      await runAutoBackupIfDue();
      setSetting('drive_auto_day', null);
      const r = await mirrorTodaysSnapshot();
      if (r.drive === 'done') toast(t('driveUploaded'));
      else toast(t(driveErrorKey(new DriveError((getSetting('drive_error') ?? '').split(' ')[1] as DriveError['reason']))), { tone: 'danger' });
    } finally {
      setWorking(null);
    }
  }

  async function connect() {
    if (working) return;
    setWorking('drive');
    try {
      if (await connectDrive()) {
        const r = await mirrorTodaysSnapshot();
        toast(t(r.drive === 'failed' ? 'driveOffline' : 'driveUploaded'), r.drive === 'failed' ? { tone: 'danger' } : undefined);
      }
    } catch (e) {
      if (!(e instanceof DriveError) || e.reason === 'failed') reportError(e, 'backup.drive');
      Alert.alert(t('googleDrive'), t(driveErrorKey(e)));
    } finally {
      setWorking(null);
    }
  }

  function driveMenu() {
    Alert.alert(t('googleDrive'), email ?? '', [
      { text: t('cancel'), style: 'cancel' },
      { text: t('disconnect'), style: 'destructive', onPress: () => void disconnectDrive() },
      { text: t('uploadNow'), onPress: () => void uploadNow() },
    ]);
  }

  const folderFailed = !!folderUri && !!folderError;
  const driveFailed = !!email && !!driveError;
  return (
    <>
      <SectionTitle title={t('backupPlaces')} />
      <ListCard inset>
        <ListRow
          icon={FolderOpen}
          iconTone={folderFailed ? 'warning' : folderUri ? 'success' : 'primary'}
          title={t('phoneFolder')}
          subtitle={
            folderUri
              ? folderFailed
                ? t('phoneFolderFailed')
                : `${folderName(folderUri)} · ${folderAt ? when(folderAt, t) : t('notYet')}`
              : t('phoneFolderNone')
          }
          onPress={folderUri ? folderMenu : () => void chooseFolder()}
          trailing={
            working === 'folder' ? (
              <ActivityIndicator color={c.primary} />
            ) : folderUri ? (
              <IconButton icon={X} label={t('stopFolder')} tone="textMuted" size={44} onPress={forgetPhoneFolder} />
            ) : undefined
          }
        />
        <ListRow
          icon={email ? Cloud : CloudOff}
          iconTone={driveFailed ? 'warning' : email ? 'success' : 'primary'}
          title={t('googleDrive')}
          subtitle={
            email
              ? `${email} · ${t('lastUpload')}: ${driveAt ? when(driveAt, t) : t('notYet')}`
              : t('driveNotConnected')
          }
          onPress={email ? driveMenu : () => void connect()}
          trailing={working === 'drive' ? <ActivityIndicator color={c.primary} /> : undefined}
        />
      </ListCard>
      <Txt variant="caption" color="textMuted">
        {`${t('phoneFolderHint')} ${t('driveHint')}`}
      </Txt>
    </>
  );
}

import { File } from 'expo-file-system';
import { useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { AlertTriangle, CheckCircle2, CloudUpload, History, KeyRound, LockKeyhole, RotateCcw, Share2, ShieldCheck } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Alert, View } from 'react-native';

import { BackupPlaces, driveErrorKey } from '@/components/BackupPlaces';
import { Button, IconButton } from '@/components/ui/Button';
import { toast } from '@/components/ui/feedback';
import { BottomSheet, Field, SheetHeader } from '@/components/ui/form';
import { ToggleRow } from '@/components/ui/kit';
import { Card, ListCard, ListRow, Screen, SectionTitle } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { getSetting, setSetting, useFirst, useSetting } from '@/db';
import { useT, type TKey } from '@/i18n';
import { KEEP_DAYS, listAutoBackups, runAutoBackupIfDue } from '@/lib/autoBackup';
import { BackupError, ENCRYPTED_EXT, makeBackup, markBackedUp, MIN_PASSWORD, restorePart } from '@/lib/backup';
import { daysSince, formatDay, toDay, today } from '@/lib/dates';
import { driveConnected, uploadToDrive } from '@/lib/drive';
import { guard, reportError, showError } from '@/lib/errors';
import { copyFileToPhoneFolder } from '@/lib/phoneFolder';
import { space, useColors } from '@/theme';

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function kb(bytes: number) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

type Busy = 'auto' | 'full' | 'restore' | null;

/** The message for a backup file that could not be read or restored. */
function backupErrorKey(e: BackupError): TKey {
  switch (e.message) {
    case 'newer':
      return 'pdfNewer';
    case 'damaged':
      return 'pdfDamaged';
    case 'wrong-password':
      return 'wrongPassword';
    case 'password-short':
      return 'passwordTooShort';
    default:
      return 'backupInvalid';
  }
}

export default function BackupScreen() {
  const t = useT();
  const c = useColors();
  const params = useLocalSearchParams<{ uri?: string }>();
  const lastFull = useSetting('last_backup_at');
  const autoAt = useSetting('auto_backup_at');
  const autoError = useSetting('auto_backup_error');
  const autoOn = useSetting('auto_backup') !== 'off';
  // with a folder or Drive set up, Back up now copies the full backup there itself
  const folderSet = useSetting('backup_folder_uri');
  const driveSet = useSetting('drive_email');
  const copiesSetUp = !!folderSet || !!driveSet;
  const stats = useFirst<{ records: number; photos: number; bytes: number }>(
    `SELECT
       (SELECT COUNT(*) FROM projects WHERE deleted_at IS NULL)
     + (SELECT COUNT(*) FROM expenses WHERE deleted_at IS NULL)
     + (SELECT COUNT(*) FROM wage_entries WHERE deleted_at IS NULL)
     + (SELECT COUNT(*) FROM tool_movements WHERE deleted_at IS NULL)
     + (SELECT COUNT(*) FROM site_notes WHERE deleted_at IS NULL)
     + (SELECT COUNT(*) FROM estimates WHERE deleted_at IS NULL)
     + (SELECT COUNT(*) FROM estimate_items WHERE deleted_at IS NULL)
     + (SELECT COUNT(*) FROM estimate_payments WHERE deleted_at IS NULL) AS records,
       (SELECT COUNT(*) FROM attachments WHERE deleted_at IS NULL) AS photos,
       (SELECT COALESCE(SUM(size),0) FROM attachments WHERE deleted_at IS NULL) AS bytes`,
  );
  const [busy, setBusy] = useState<Busy>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  // Optional password for the full backup.
  const [protect, setProtect] = useState(false);
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [pwError, setPwError] = useState<TKey | null>(null);
  // An encrypted backup being restored waits here for its password.
  const [unlocking, setUnlocking] = useState<string[] | null>(null);
  const [restorePw, setRestorePw] = useState('');
  const [restorePwError, setRestorePwError] = useState<TKey | null>(null);
  // The file list is not in the database; re-read it whenever a backup finishes.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- autoAt changes when a new backup file is written
  const autos = useMemo(() => listAutoBackups(), [autoAt]);

  async function fullBackup() {
    if (busy) return;
    if (protect) {
      if (password.length < MIN_PASSWORD) return setPwError('passwordTooShort');
      if (password !== password2) return setPwError('passwordMismatch');
    }
    setPwError(null);
    setResult(null);
    setBusy('full');
    const making = t(protect ? 'backupMakingLocked' : 'backupMaking');
    setProgress(making);
    await guard('backup.full', t, async () => {
      const files = await makeBackup((part, parts) => setProgress(parts > 1 ? `${making} ${part}/${parts}` : making), protect ? password : undefined);
      // the owner's own places first: the phone folder, then Google Drive; each failure is said, none stops the rest
      let kept = false;
      if (getSetting('backup_folder_uri')) {
        try {
          for (const f of files) copyFileToPhoneFolder(new File(f.uri));
          kept = true;
          toast(t('folderSaved'));
        } catch (e) {
          reportError(e, 'backup.full.folder');
          toast(t('phoneFolderFailed'), { tone: 'danger' });
        }
      }
      if (driveConnected()) {
        try {
          for (const [i, f] of files.entries()) {
            setProgress(`${t('googleDrive')} ${i + 1}/${files.length}`);
            await uploadToDrive(new File(f.uri).name, new File(f.uri).bytesSync(), f.uri.endsWith(ENCRYPTED_EXT) ? 'application/octet-stream' : 'application/zip');
          }
          kept = true;
          toast(t('driveUploaded'));
        } catch (e) {
          Alert.alert(t('googleDrive'), t(driveErrorKey(e)));
        }
      }
      setProgress(null);
      if (!kept) {
        // nowhere set up: hand the files to the share sheet (Drive app, WhatsApp, a computer…)
        toast(t('backupReady'));
        for (const f of files) {
          const locked = f.uri.endsWith(ENCRYPTED_EXT);
          await Sharing.shareAsync(f.uri, { mimeType: locked ? 'application/octet-stream' : 'application/zip', dialogTitle: t('backup') });
        }
      }
      markBackedUp();
    });
    setProgress(null);
    setBusy(null);
  }

  async function runNow() {
    if (busy) return;
    setBusy('auto');
    const r = await guard('backup.auto', t, () => runAutoBackupIfDue(true));
    setBusy(null);
    if (r === 'failed') {
      reportError(new Error(autoError ?? 'auto backup failed'), 'backup.auto');
      toast(t('autoBackupFailed'), { tone: 'danger', sticky: true, action: { label: t('tryAgain'), onPress: () => void runNow() } });
    } else if (r) toast(t('dataSafe'));
  }

  async function pickAndRestore() {
    if (busy) return;
    const res = await guard('backup.pick', t, () => File.pickFileAsync({ mimeTypes: ['application/zip', 'application/octet-stream'], multipleFiles: true }));
    if (!res || res.canceled) return;
    // a dialog opened in the same moment the file picker closes came up without its title on some phones
    const uris = res.result.map((f) => f.uri);
    setTimeout(() => confirmRestore(uris), 250);
  }

  function confirmRestore(uris: string[]) {
    Alert.alert(t('restoreWarnTitle'), t('restoreWarnBody'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('restore'),
        onPress: () => void restore(uris),
      },
    ]);
  }

  async function restore(uris: string[], pw?: string) {
    setBusy('restore');
    setResult(null);
    let added = 0;
    let updated = 0;
    let photos = 0;
    try {
      for (const uri of uris) {
        const r = await restorePart(uri, pw);
        added += r.plan.counts.inserted;
        updated += r.plan.counts.updated;
        photos += r.photos;
      }
      setUnlocking(null);
      setRestorePw('');
      const summary = `${t('restoreDone')}: +${added} ${t('newRecords')} · ${updated} ${t('updatedRecords')} · ${photos} ${t('receiptPhotos')}`;
      setResult(summary);
      // the card with the result is at the bottom of the page: the toast says it where the person is looking
      toast(summary);
    } catch (e) {
      if (e instanceof BackupError && (e.message === 'needs-password' || e.message === 'wrong-password')) {
        // Ask for the password and start again from the first file: a restore only merges, so nothing is counted twice.
        setRestorePw('');
        setRestorePwError(e.message === 'wrong-password' ? 'wrongPassword' : null);
        setUnlocking(uris);
      } else if (e instanceof BackupError) {
        // The file itself is the problem: say which way, in the user's words.
        reportError(e, 'backup.restore', { uris: uris.length });
        setUnlocking(null);
        Alert.alert(t('errorTitle'), t(backupErrorKey(e)));
      } else {
        setUnlocking(null);
        showError(e, 'backup.restore', t, { uris: uris.length });
      }
    } finally {
      setBusy(null);
    }
  }

  function shareAuto(uri: string) {
    void guard('backup.share', t, () => Sharing.shareAsync(uri, { mimeType: 'application/zip', dialogTitle: t('backup') }));
  }

  // A backup .zip shared into the app ("Share to Bluemoon") lands here.
  useEffect(() => {
    if (params.uri) confirmRestore([params.uri]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.uri]);

  // Timestamps are UTC; "today" is the local calendar day (a 1 am backup in Sri Lanka is on the previous UTC day).
  const autoToday = (!!autoAt && toDay(new Date(autoAt)) === today()) || autos[0]?.day === today();
  const autoFailed = !!autoError && !autoToday;
  const fullDays = daysSince(lastFull);
  const fullStale = (stats?.photos ?? 0) > 0 && (fullDays == null || fullDays >= 7);
  const autoTone: 'danger' | 'success' | 'warning' = autoFailed ? 'danger' : autoToday ? 'success' : 'warning';
  const autoSoft: 'dangerSoft' | 'successSoft' | 'warningSoft' = `${autoTone}Soft`;
  const AutoIcon = autoFailed ? AlertTriangle : ShieldCheck;
  const autoWord = autoFailed ? t('autoBackupFailed') : autoToday ? t('dataSafe') : `${t('autoBackupLast')}: ${autoAt ? `${formatDay(toDay(new Date(autoAt)))} ${timeOf(autoAt)}` : t('never')}`;

  return (
    <Screen footer={<Button icon={CloudUpload} label={progress ?? t('backupNow')} loading={busy === 'full'} disabled={!!busy && busy !== 'full'} onPress={() => void fullBackup()} full />}>
      {/* Daily automatic backup: status card (colour + icon + word) */}
      <Card tone={autoSoft}>
        <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
          <AutoIcon size={24} color={c[autoTone]} strokeWidth={2} />
          <Txt weight="semibold" color={autoTone} style={{ flex: 1 }}>
            {autoWord}
          </Txt>
        </View>
        {autoFailed && autoError ? (
          <Txt variant="caption" color="textMuted" numeric>
            {autoError.slice(25)}
          </Txt>
        ) : null}
        <Button kind="secondary" compact icon={ShieldCheck} label={t('runNow')} onPress={() => void runNow()} loading={busy === 'auto'} disabled={!!busy && busy !== 'auto'} />
      </Card>

      <ListCard>
        <ToggleRow
          icon={History}
          title={t('autoBackup')}
          hint={t('autoBackupHint', { days: KEEP_DAYS })}
          value={autoOn}
          onChange={(v) => void guard('backup.toggle', t, () => setSetting('auto_backup', v ? 'on' : 'off'))}
        />
      </ListCard>

      <BackupPlaces />

      {autos.length ? (
        <View style={{ gap: space.sm }}>
          <SectionTitle title={t('autoBackups')} count={autos.length} />
          <ListCard>
            {autos.map((b) => (
              <ListRow
                key={b.day}
                title={b.day === today() ? t('today') : formatDay(b.day)}
                subtitle={kb(b.size)}
                trailing={
                  <View style={{ flexDirection: 'row', gap: space.xs }}>
                    <IconButton icon={Share2} label={t('shareBackup', { day: formatDay(b.day) })} tone="textMuted" size={44} onPress={() => shareAuto(b.file.uri)} disabled={!!busy} />
                    <IconButton icon={RotateCcw} label={t('restoreThisBackup', { day: formatDay(b.day) })} tone="textMuted" size={44} onPress={() => confirmRestore([b.file.uri])} disabled={!!busy} />
                  </View>
                }
              />
            ))}
          </ListCard>
          <Txt variant="caption" color="textMuted">
            {t('olderDeleted', { days: KEEP_DAYS })}
          </Txt>
        </View>
      ) : null}

      {/* Full backup with photos, to Google Drive (the primary button lives in the footer) */}
      <SectionTitle title={t('fullBackup')} />
      <Card tone={fullStale ? 'warningSoft' : undefined}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          {fullStale ? <AlertTriangle size={24} color={c.warning} strokeWidth={2} /> : <CloudUpload size={24} color={c.textMuted} strokeWidth={2} />}
          <Txt weight="semibold" color={fullStale ? 'warning' : 'text'} style={{ flex: 1 }}>
            {fullStale && fullDays != null ? t('photosOverdue', { days: fullDays }) : `${t('lastBackup')}: ${lastFull ? `${formatDay(toDay(new Date(lastFull)))} ${timeOf(lastFull)}` : t('never')}`}
          </Txt>
        </View>
        <Txt variant="caption" color="textMuted" numeric>
          {`${stats?.records ?? 0} ${t('records')} · ${stats?.photos ?? 0} ${t('receiptPhotos')} · ${kb(stats?.bytes ?? 0)}`}
        </Txt>
        <Txt variant="caption" color="textMuted">
          {t(copiesSetUp ? 'fullBackupHintAuto' : 'fullBackupHint')}
        </Txt>
      </Card>

      <ListCard>
        <ToggleRow
          icon={LockKeyhole}
          title={t('protectWithPassword')}
          hint={protect ? undefined : t('protectWithPasswordHint')}
          value={protect}
          onChange={(v) => {
            setProtect(v);
            setPwError(null);
          }}
        />
      </ListCard>
      {protect ? (
        <Card>
          <Field
            label={t('password')}
            icon={LockKeyhole}
            value={password}
            onChangeText={(s) => {
              setPassword(s);
              setPwError(null);
            }}
            placeholder={t('passwordPlaceholder')}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="newPassword"
            error={pwError === 'passwordTooShort' ? t(pwError) : null}
            returnKeyType="next"
          />
          <Field
            label={t('passwordAgain')}
            icon={LockKeyhole}
            placeholder={t('phPasswordAgain')}
            value={password2}
            onChangeText={(s) => {
              setPassword2(s);
              setPwError(null);
            }}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="newPassword"
            error={pwError === 'passwordMismatch' ? t(pwError) : null}
          />
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
            <AlertTriangle size={16} color={c.warning} strokeWidth={2.4} style={{ marginTop: 2 }} />
            <Txt variant="caption" color="warning" weight="semibold" style={{ flex: 1 }}>
              {t('passwordForgetWarning')}
            </Txt>
          </View>
        </Card>
      ) : null}

      {/* Restore */}
      <SectionTitle title={t('restore')} />
      <Txt variant="caption" color="textMuted">
        {t('restoreHint')}
      </Txt>
      <Button kind="secondary" icon={History} label={busy === 'restore' ? t('reading') : t('restore')} loading={busy === 'restore'} onPress={() => void pickAndRestore()} disabled={!!busy && busy !== 'restore'} full />
      {result ? (
        <Card tone="successSoft">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <CheckCircle2 size={24} color={c.success} strokeWidth={2} />
            <Txt weight="semibold" color="success" style={{ flex: 1 }}>
              {result}
            </Txt>
          </View>
        </Card>
      ) : null}
      <BottomSheet visible={!!unlocking} onClose={() => (busy ? undefined : setUnlocking(null))}>
        <SheetHeader title={t('backupLockedTitle')} caption={t('backupLockedBody')} onClose={() => (busy ? undefined : setUnlocking(null))} />
        <View style={{ paddingHorizontal: space.lg, gap: space.lg, paddingBottom: space.lg }}>
          <Field
            label={t('password')}
            icon={KeyRound}
            value={restorePw}
            onChangeText={(s) => {
              setRestorePw(s);
              setRestorePwError(null);
            }}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            error={restorePwError ? t(restorePwError) : null}
            returnKeyType="done"
            onSubmitEditing={() => {
              if (unlocking && restorePw) void restore(unlocking, restorePw);
            }}
          />
          <Button
            icon={KeyRound}
            label={busy === 'restore' ? t('reading') : t('openAndRestore')}
            loading={busy === 'restore'}
            disabled={!restorePw}
            onPress={() => {
              if (unlocking) void restore(unlocking, restorePw);
            }}
            full
          />
        </View>
      </BottomSheet>
    </Screen>
  );
}

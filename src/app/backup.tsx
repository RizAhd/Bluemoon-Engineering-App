import { File } from 'expo-file-system';
import { useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { AlertTriangle, CheckCircle2, CloudUpload, History, RotateCcw, Share2, ShieldCheck } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Switch, View } from 'react-native';

import { Button, IconButton } from '@/components/ui/Button';
import { toast } from '@/components/ui/feedback';
import { Card, ListCard, ListRow, Screen, SectionTitle } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { setSetting, useFirst, useSetting } from '@/db';
import { useT, type TKey } from '@/i18n';
import { KEEP_DAYS, listAutoBackups, runAutoBackupIfDue } from '@/lib/autoBackup';
import { BackupError, makeBackup, markBackedUp, restorePart } from '@/lib/backup';
import { daysSince, formatDay, toDay, today } from '@/lib/dates';
import { guard, reportError, showError } from '@/lib/errors';
import { space, touchMin, useColors } from '@/theme';

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function kb(bytes: number) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

type Busy = 'auto' | 'full' | 'restore' | null;

export default function BackupScreen() {
  const t = useT();
  const c = useColors();
  const params = useLocalSearchParams<{ uri?: string }>();
  const lastFull = useSetting('last_backup_at');
  const autoAt = useSetting('auto_backup_at');
  const autoError = useSetting('auto_backup_error');
  const autoOn = useSetting('auto_backup') !== 'off';
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
  // The file list is not in the database; re-read it whenever a backup finishes.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- autoAt changes when a new backup file is written
  const autos = useMemo(() => listAutoBackups(), [autoAt]);

  async function fullBackup() {
    if (busy) return;
    setResult(null);
    setBusy('full');
    setProgress(t('backupMaking'));
    await guard('backup.full', t, async () => {
      const files = await makeBackup((part, parts) => setProgress(parts > 1 ? `${t('backupMaking')} ${part}/${parts}` : t('backupMaking')));
      setProgress(null);
      toast(t('backupReady'));
      for (const f of files) {
        await Sharing.shareAsync(f.uri, { mimeType: 'application/zip', dialogTitle: t('backup') });
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
    confirmRestore(res.result.map((f) => f.uri));
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

  async function restore(uris: string[]) {
    setBusy('restore');
    setResult(null);
    let added = 0;
    let updated = 0;
    let photos = 0;
    try {
      for (const uri of uris) {
        const r = await restorePart(uri);
        added += r.plan.counts.inserted;
        updated += r.plan.counts.updated;
        photos += r.photos;
      }
      setResult(`${t('restoreDone')}: +${added} ${t('newRecords')} · ${updated} ${t('updatedRecords')} · ${photos} ${t('receiptPhotos')}`);
      toast(t('restoreDone'));
    } catch (e) {
      if (e instanceof BackupError) {
        // The file itself is the problem: say which way, in the user's words.
        const key: TKey = e.message === 'newer' ? 'pdfNewer' : e.message === 'damaged' ? 'pdfDamaged' : 'backupInvalid';
        reportError(e, 'backup.restore', { uris: uris.length });
        Alert.alert(t('errorTitle'), t(key));
      } else {
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

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touchMin }}>
          <Txt weight="semibold" style={{ flex: 1 }}>
            {t('autoBackup')}
          </Txt>
          <Switch
            value={autoOn}
            onValueChange={(v) => void guard('backup.toggle', t, () => setSetting('auto_backup', v ? 'on' : 'off'))}
            accessibilityLabel={t('autoBackup')}
            trackColor={{ true: c.primary, false: c.borderStrong }}
            thumbColor={c.card}
          />
        </View>
        <Txt variant="caption" color="textMuted">
          {t('autoBackupHint', { days: KEEP_DAYS })}
        </Txt>
      </Card>

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
          {t('fullBackupHint')}
        </Txt>
      </Card>

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
    </Screen>
  );
}

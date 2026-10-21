import { File } from 'expo-file-system';
import { useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { AlertTriangle, CloudUpload, History, RotateCcw, Share2, ShieldCheck } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Switch, View } from 'react-native';

import { Button, IconButton } from '@/components/ui/Button';
import { toast } from '@/components/ui/feedback';
import { Card, ListCard, Screen, SectionTitle } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { setSetting, useFirst, useSetting } from '@/db';
import { useT } from '@/i18n';
import { KEEP_DAYS, listAutoBackups, runAutoBackupIfDue } from '@/lib/autoBackup';
import { BackupError, makeBackup, markBackedUp, restorePart } from '@/lib/backup';
import { daysSince, formatDay, today } from '@/lib/dates';
import { space, useColors } from '@/theme';

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function kb(bytes: number) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

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
     + (SELECT COUNT(*) FROM site_notes WHERE deleted_at IS NULL) AS records,
       (SELECT COUNT(*) FROM attachments WHERE deleted_at IS NULL) AS photos,
       (SELECT COALESCE(SUM(size),0) FROM attachments WHERE deleted_at IS NULL) AS bytes`,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  // The file list is not in the database; re-read it whenever a backup finishes.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- autoAt changes when a new backup file is written
  const autos = useMemo(() => listAutoBackups(), [autoAt]);

  async function fullBackup() {
    setResult(null);
    setBusy(t('backupMaking'));
    try {
      const files = await makeBackup((part, parts) => setBusy(parts > 1 ? `${t('backupMaking')} ${part}/${parts}` : t('backupMaking')));
      setBusy(null);
      toast(t('backupReady'));
      for (const f of files) {
        await Sharing.shareAsync(f.uri, { mimeType: 'application/zip', dialogTitle: t('backup') });
      }
      markBackedUp();
    } catch (e) {
      Alert.alert(t('somethingWrong'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runNow() {
    setBusy(t('backupMaking'));
    const r = await runAutoBackupIfDue(true);
    setBusy(null);
    toast(r === 'failed' ? t('autoBackupFailed') : t('dataSafe'));
  }

  async function pickAndRestore() {
    const res = await File.pickFileAsync({ mimeTypes: ['application/zip', 'application/octet-stream'], multipleFiles: true });
    if (res.canceled) return;
    confirmRestore(res.result.map((f) => f.uri));
  }

  function confirmRestore(uris: string[]) {
    Alert.alert(t('restoreWarnTitle'), t('restoreWarnBody'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('restore'),
        onPress: async () => {
          setBusy(t('reading'));
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
            const key = e instanceof BackupError ? (e.message === 'newer' ? 'pdfNewer' : e.message === 'damaged' ? 'pdfDamaged' : 'backupInvalid') : 'somethingWrong';
            Alert.alert(t(key));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  }

  // A backup .zip shared into the app ("Share to Bluemoon") lands here.
  useEffect(() => {
    if (params.uri) confirmRestore([params.uri]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.uri]);

  const autoToday = autoAt?.slice(0, 10) === today() || autos[0]?.day === today();
  const fullDays = daysSince(lastFull);
  const fullStale = (stats?.photos ?? 0) > 0 && (fullDays == null || fullDays >= 7);

  return (
    <Screen>
      {/* Daily automatic backup */}
      <Card tone={autoError && !autoToday ? 'dangerSoft' : autoToday ? 'successSoft' : 'warningSoft'} style={{ borderColor: 'transparent' }}>
        <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
          {autoError && !autoToday ? (
            <AlertTriangle size={28} color={c.danger} />
          ) : (
            <ShieldCheck size={28} color={autoToday ? c.success : c.warning} />
          )}
          <View style={{ flex: 1 }}>
            <Txt weight="bold">{t('autoBackup')}</Txt>
            <Txt variant="caption" color="textMuted">
              {t('autoBackupLast')}: {autoAt ? `${formatDay(autoAt.slice(0, 10))} ${timeOf(autoAt)}` : t('never')}
            </Txt>
          </View>
          <Switch
            value={autoOn}
            onValueChange={(v) => setSetting('auto_backup', v ? 'on' : 'off')}
            accessibilityLabel={t('autoBackup')}
            trackColor={{ true: c.primary, false: c.borderStrong }}
            thumbColor={c.card}
          />
        </View>
        {autoError && !autoToday ? (
          <Txt variant="caption" color="danger">
            {t('autoBackupFailed')}: {autoError.slice(25)}
          </Txt>
        ) : null}
        <Txt color="textMuted">{t('autoBackupHint', { days: KEEP_DAYS })}</Txt>
        <Button kind="secondary" icon={ShieldCheck} label={t('runNow')} onPress={runNow} loading={busy === t('backupMaking')} disabled={!!busy} />
      </Card>

      {autos.length ? (
        <>
          <SectionTitle title={t('autoBackups')} />
          <ListCard>
            {autos.map((b) => (
              <View key={b.day} style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: space.lg, paddingRight: space.sm, minHeight: 60, gap: space.xs }}>
                <View style={{ flex: 1 }}>
                  <Txt weight="semibold">{b.day === today() ? t('today') : formatDay(b.day)}</Txt>
                  <Txt variant="caption" color="textMuted" numeric>
                    {kb(b.size)}
                  </Txt>
                </View>
                <IconButton icon={Share2} label={t('backup')} onPress={() => Sharing.shareAsync(b.file.uri, { mimeType: 'application/zip' })} />
                <IconButton icon={RotateCcw} label={t('restore')} onPress={() => confirmRestore([b.file.uri])} />
              </View>
            ))}
          </ListCard>
          <Txt variant="caption" color="textMuted">
            {t('olderDeleted', { days: KEEP_DAYS })}
          </Txt>
        </>
      ) : null}

      {/* Full backup with photos, to Google Drive */}
      <SectionTitle title={t('fullBackup')} />
      <Card tone={fullStale ? 'warningSoft' : undefined} style={fullStale ? { borderColor: 'transparent' } : undefined}>
        <Txt weight="semibold" color={fullStale ? 'warning' : 'text'}>
          {t('lastBackup')}: {lastFull ? `${formatDay(lastFull.slice(0, 10))} ${timeOf(lastFull)}` : t('never')}
        </Txt>
        <Txt color="textMuted" numeric>
          {stats?.records ?? 0} {t('records')} · {stats?.photos ?? 0} {t('receiptPhotos')} · {kb(stats?.bytes ?? 0)}
        </Txt>
        <Txt color="textMuted">{t('fullBackupHint')}</Txt>
        <Button icon={CloudUpload} label={busy && busy !== t('reading') ? busy : t('backupNow')} loading={!!busy && busy !== t('reading')} onPress={fullBackup} disabled={!!busy} />
      </Card>

      {/* Restore */}
      <SectionTitle title={t('restore')} />
      <Txt color="textMuted">{t('restoreHint')}</Txt>
      <Button kind="secondary" icon={History} label={busy === t('reading') ? t('reading') : t('restore')} loading={busy === t('reading')} onPress={pickAndRestore} disabled={!!busy} />
      {result ? (
        <Card tone="successSoft" style={{ borderColor: 'transparent' }}>
          <Txt weight="semibold" color="success">
            {result}
          </Txt>
        </Card>
      ) : null}
    </Screen>
  );
}

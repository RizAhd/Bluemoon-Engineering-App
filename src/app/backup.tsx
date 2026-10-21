import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { CloudUpload, History, ShieldCheck } from 'lucide-react-native';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/feedback';
import { Card, Screen, SectionTitle } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { useFirst, useSetting } from '@/db';
import { useT } from '@/i18n';
import { BackupError, makeBackup, markBackedUp, restorePart } from '@/lib/backup';
import { daysSince, formatDay } from '@/lib/dates';
import { space, useColors } from '@/theme';

export default function BackupScreen() {
  const t = useT();
  const c = useColors();
  const params = useLocalSearchParams<{ uri?: string }>();
  const last = useSetting('last_backup_at');
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

  async function backupNow() {
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

  async function restore() {
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

  const mb = ((stats?.bytes ?? 0) / 1024 / 1024).toFixed(1);
  const lastText = last ? `${formatDay(last.slice(0, 10))} ${new Date(last).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : t('never');
  const stale = (daysSince(last) ?? Infinity) >= 3;

  return (
    <Screen>
      <Card tone={stale ? 'warningSoft' : 'successSoft'} style={{ borderColor: 'transparent' }}>
        <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
          {stale ? <History size={28} color={c.warning} /> : <ShieldCheck size={28} color={c.success} />}
          <View style={{ flex: 1 }}>
            <Txt variant="caption" weight="semibold" color={stale ? 'warning' : 'success'}>
              {t('lastBackup')}
            </Txt>
            <Txt variant="title" weight="bold" color={stale ? 'warning' : 'success'}>
              {lastText}
            </Txt>
          </View>
        </View>
        <Txt color="textMuted" numeric>
          {stats?.records ?? 0} {t('records')} · {stats?.photos ?? 0} {t('receiptPhotos')} · {mb} MB
        </Txt>
      </Card>

      <Txt color="textMuted">{t('backupHint')}</Txt>
      <Button icon={CloudUpload} label={busy ?? t('backupNow')} loading={!!busy} onPress={backupNow} />

      <SectionTitle title={t('restore')} />
      <Txt color="textMuted">{t('restoreHint')}</Txt>
      <Button kind="secondary" icon={History} label={t('restore')} onPress={restore} disabled={!!busy} />
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

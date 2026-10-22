import * as Application from 'expo-application';
import { router } from 'expo-router';
import { Bug, Database, FileDown, NotebookPen, ShieldCheck } from 'lucide-react-native';
import { Alert, View } from 'react-native';

import { BrandLogo } from '@/components/Brand';
import { Chips } from '@/components/ui/form';
import { ListCard, ListRow, Screen, SectionTitle } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { deviceId, setSetting, useSetting } from '@/db';
import { LANG_NAMES, useLang, useT, type Lang } from '@/i18n';
import { daysSince, formatDay, toDay, today } from '@/lib/dates';
import { seedDemoData } from '@/lib/demoData';
import { guard } from '@/lib/errors';
import { space, useThemePref, type ThemePref } from '@/theme';

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Settings & more (stack screen, opened from the menu button in every tab header). */
export default function MoreScreen() {
  const t = useT();
  const lang = useLang();
  const theme = useThemePref();
  const autoAt = useSetting('auto_backup_at');
  const autoError = useSetting('auto_backup_error');
  // auto_backup_at is a UTC timestamp, today() a local day: compare local days, or a backup made before 05:30 in Sri Lanka is "yesterday".
  const autoDay = autoAt && !Number.isNaN(Date.parse(autoAt)) ? toDay(new Date(autoAt)) : null;
  const autoToday = autoDay === today();
  const autoStale = (daysSince(autoAt) ?? 99) >= 2;

  // Backup row: green when today's snapshot exists, amber when late, red when the last run failed.
  const backupTone = autoError && !autoToday ? 'danger' : autoToday ? 'success' : autoStale ? 'warning' : 'success';
  const backupSubtitle =
    autoError && !autoToday
      ? t('autoBackupFailed')
      : autoToday
        ? `${t('dataSafe')} · ${timeOf(autoAt ?? '')}`
        : `${t('autoBackupLast')}: ${autoDay ? formatDay(autoDay) : t('never')}`;

  return (
    <Screen paddingBottom={space.xxl}>
      <ListCard inset>
        <ListRow icon={ShieldCheck} iconTone={backupTone} title={t('backup')} subtitle={backupSubtitle} onPress={() => router.push('/backup')} />
        <ListRow icon={FileDown} title={t('importPdf')} subtitle={t('importPdfHint')} onPress={() => router.push('/import')} />
        <ListRow icon={NotebookPen} title={t('siteNotes')} onPress={() => router.push('/notes')} />
        <ListRow icon={Bug} title={t('reportProblem')} subtitle={t('errorLog')} onPress={() => router.push('/problem')} />
        {__DEV__ ? (
          <ListRow
            icon={Database}
            title="Load demo data"
            subtitle="Development builds only"
            onPress={() =>
              void guard('demo.seed', t, () => {
                const { created } = seedDemoData();
                Alert.alert(created ? 'Demo data loaded' : 'Demo data is already here');
              })
            }
          />
        ) : null}
      </ListCard>

      <SectionTitle title={t('language')} />
      <Chips<Lang>
        value={lang}
        onChange={(v) => void guard('settings.lang', t, () => setSetting('lang', v))}
        options={(Object.keys(LANG_NAMES) as Lang[]).map((l) => ({ value: l, label: LANG_NAMES[l] }))}
      />

      <SectionTitle title={t('appearance')} />
      <Chips<ThemePref>
        value={theme}
        onChange={(v) => void guard('settings.theme', t, () => setSetting('theme', v))}
        options={(['system', 'light', 'dark'] as const).map((v) => ({ value: v, label: t(`theme_${v}`) }))}
      />

      <SectionTitle title={t('about')} />
      <View style={{ gap: space.xs, alignItems: 'center', paddingTop: space.sm }}>
        <BrandLogo width={160} />
        <Txt variant="caption" color="textMuted" center>
          Reg. No. PV 00232701 · Welimada, Badulla
        </Txt>
        <Txt variant="caption" color="textMuted" numeric center>
          {`${t('version')} ${Application.nativeApplicationVersion ?? '1.0.0'} · ${t('buildNumber')} ${Application.nativeBuildVersion ?? '—'}`}
        </Txt>
        <Txt variant="caption" color="textMuted" numeric center>
          {`ID ${deviceId().slice(0, 8)}`}
        </Txt>
      </View>

      <View style={{ alignItems: 'center', gap: 2, paddingTop: space.lg }} accessible accessibilityLabel={`${t('developedBy')} ZYFLO.TECH`}>
        <Txt variant="caption" color="textMuted" center>
          {t('developedBy')}
        </Txt>
        <Txt weight="semibold" color="primary" numeric center>
          ZYFLO.TECH
        </Txt>
      </View>
    </Screen>
  );
}

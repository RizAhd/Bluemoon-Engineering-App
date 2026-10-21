import * as Application from 'expo-application';
import { router } from 'expo-router';
import { Building2, FileDown, Languages, NotebookPen, Palette, ShieldCheck } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';

import { TabHeader } from '@/components/ProjectSwitcher';
import { Chips } from '@/components/ui/form';
import { ListCard, ListRow, SectionTitle } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { deviceId, setSetting, useSetting } from '@/db';
import { LANG_NAMES, useLang, useT, type Lang } from '@/i18n';
import { formatDay } from '@/lib/dates';
import { space, useColors, useThemePref, type ThemePref } from '@/theme';

export default function MoreScreen() {
  const t = useT();
  const c = useColors();
  const lang = useLang();
  const theme = useThemePref();
  const autoAt = useSetting('auto_backup_at');

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 140 }}>
      <TabHeader title={t('tabMore')} showProject={false} />
      <View style={{ paddingHorizontal: space.lg, gap: space.lg }}>

      <ListCard>
        <ListRow icon={Building2} title={t('projects')} onPress={() => router.push('/projects')} />
        <ListRow icon={NotebookPen} title={t('siteNotes')} onPress={() => router.push('/notes')} />
        <ListRow icon={FileDown} title={t('importPdf')} subtitle={t('importPdfHint')} onPress={() => router.push('/import')} />
        <ListRow
          icon={ShieldCheck}
          iconTone={autoAt ? 'success' : 'warning'}
          title={t('backup')}
          subtitle={`${t('autoBackupLast')}: ${autoAt ? formatDay(autoAt.slice(0, 10)) : t('never')}`}
          onPress={() => router.push('/backup')}
        />
      </ListCard>

      <SectionTitle title={t('language')} action={<Languages size={22} color={c.textMuted} />} />
      <Chips<Lang>
        value={lang}
        onChange={(v) => setSetting('lang', v)}
        options={(Object.keys(LANG_NAMES) as Lang[]).map((l) => ({ value: l, label: LANG_NAMES[l] }))}
      />

      <SectionTitle title={t('appearance')} action={<Palette size={22} color={c.textMuted} />} />
      <Chips<ThemePref>
        value={theme}
        onChange={(v) => setSetting('theme', v)}
        options={(['system', 'light', 'dark'] as const).map((v) => ({ value: v, label: t(`theme_${v}`) }))}
      />

      <View style={{ gap: space.xs, marginTop: space.lg }}>
        <Txt variant="caption" color="textMuted">
          Bluemoon Engineering (Pvt) Ltd · {t('version')} {Application.nativeApplicationVersion ?? '1.0.0'}
        </Txt>
        <Txt variant="caption" color="textMuted" numeric>
          ID {deviceId().slice(0, 8)}
        </Txt>
      </View>
      </View>
    </ScrollView>
  );
}

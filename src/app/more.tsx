import * as Application from 'expo-application';
import { router, Stack } from 'expo-router';
import type { LucideIcon } from 'lucide-react-native';
import { Bug, Cloud, CloudOff, Database, FileDown, FileText, Fingerprint, KeyRound, LockKeyhole, NotebookPen, Pencil, ShieldCheck } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { BrandMark } from '@/components/Brand';
import { Hero, HeroAction } from '@/components/Hero';
import { Segmented } from '@/components/ui/form';
import { ToggleRow } from '@/components/ui/kit';
import { Card, ListCard, ListRow, Screen, SectionTitle } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { deviceId, setSetting, useFirst, useSetting } from '@/db';
import { LANG_NAMES, useLang, useT, type Lang } from '@/i18n';
import { daysSince, formatDay, toDay, today } from '@/lib/dates';
import { seedDemoData } from '@/lib/demoData';
import { biometricAvailable, loadLock, setBiometric, useLockState } from '@/lib/appLock';
import { useCompanyProfile } from '@/lib/company';
import { guard } from '@/lib/errors';
import { radius, space, useColors, useTextSize, useThemePref, type Palette, type TextSize, type ThemePref } from '@/theme';

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** App lock: the switch opens the PIN screen (to set one, or to confirm turning it off). */
function SecuritySection({ driveRow }: { driveRow: ReactNode }) {
  const t = useT();
  const lock = useLockState();
  const [bioHere, setBioHere] = useState(false);
  useEffect(() => {
    let alive = true;
    void loadLock(false);
    void biometricAvailable().then((v) => alive && setBioHere(v));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      <SectionTitle title={t('security')} />
      <ListCard inset>
        {driveRow}
        <ToggleRow
          icon={LockKeyhole}
          title={t('appLock')}
          hint={t(lock.enabled ? 'appLockOnHint' : 'appLockOffHint')}
          value={lock.enabled}
          onChange={(v) => router.push(`/pin?mode=${v ? 'set' : 'off'}`)}
        />
        {lock.enabled && bioHere ? (
          <ToggleRow icon={Fingerprint} title={t('useFingerprint')} value={lock.bio} onChange={(v) => void guard('lock.bio', t, () => setBiometric(v))} />
        ) : null}
        {lock.enabled ? <ListRow icon={KeyRound} title={t('changePin')} onPress={() => router.push('/pin?mode=change')} /> : null}
      </ListCard>
    </>
  );
}

/** One of the four shortcut cards under the hero: an icon tile, a name, one line under it. */
function Shortcut({ icon: Icon, tone = 'primary', title, subtitle, subtitleTone, onPress }: { icon: LucideIcon; tone?: 'primary' | 'success' | 'warning' | 'danger'; title: string; subtitle: string; subtitleTone?: keyof Palette; onPress: () => void }) {
  const c = useColors();
  const soft = { primary: c.primarySoft, success: c.successSoft, warning: c.warningSoft, danger: c.dangerSoft }[tone];
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Card onPress={onPress} accessibilityLabel={`${title}. ${subtitle}`} padding={space.lg} gap={space.sm} style={{ flexGrow: 1 }}>
        <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: soft, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs }}>
          <Icon size={21} color={c[tone]} strokeWidth={1.9} />
        </View>
        <Txt variant="bodyLg" weight="bold" numberOfLines={2}>
          {title}
        </Txt>
        <Txt variant="caption" weight="semibold" color={subtitleTone ?? 'textMuted'} numberOfLines={2}>
          {subtitle}
        </Txt>
      </Card>
    </View>
  );
}

/** Settings & more (stack screen, opened from the settings button on every tab's hero). */
export default function MoreScreen() {
  const t = useT();
  const c = useColors();
  const lang = useLang();
  const theme = useThemePref();
  const textSize = useTextSize();
  const company = useCompanyProfile();
  const driveEmail = useSetting('drive_email');
  const autoAt = useSetting('auto_backup_at');
  const autoError = useSetting('auto_backup_error');
  const noteCount = useFirst<{ n: number }>('SELECT COUNT(*) AS n FROM site_notes WHERE deleted_at IS NULL')?.n ?? 0;
  // auto_backup_at is a UTC timestamp, today() a local day: compare local days, or a backup made before 05:30 in Sri Lanka is "yesterday".
  const autoDay = autoAt && !Number.isNaN(Date.parse(autoAt)) ? toDay(new Date(autoAt)) : null;
  const autoToday = autoDay === today();
  const autoStale = (daysSince(autoAt) ?? 99) >= 2;

  // Backup card: green when today's snapshot exists, amber when late, red when the last run failed.
  const backupTone = autoError && !autoToday ? 'danger' : autoToday ? 'success' : autoStale ? 'warning' : 'success';
  const backupSubtitle =
    autoError && !autoToday
      ? t('autoBackupFailed')
      : autoToday
        ? `${t('dataSafe')} · ${timeOf(autoAt ?? '')}`
        : `${t('autoBackupLast')}: ${autoDay ? formatDay(autoDay) : t('never')}`;

  const openCompany = () => router.push('/company');

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen hairlineTop={false} paddingBottom={space.xxl}>
        <Hero
          back
          title={t('settingsAndMore')}
          card={
            <View style={{ gap: space.md }}>
              <View style={{ flexDirection: 'row', gap: space.md }}>
                <Shortcut icon={FileText} title={t('estimates')} subtitle={t('estimatesHint')} onPress={() => router.push('/estimate')} />
                <Shortcut
                  icon={ShieldCheck}
                  tone={backupTone}
                  title={t('backup')}
                  subtitle={backupSubtitle}
                  subtitleTone={backupTone === 'success' && autoToday ? 'success' : backupTone === 'success' ? 'textMuted' : backupTone}
                  onPress={() => router.push('/backup')}
                />
              </View>
              <View style={{ flexDirection: 'row', gap: space.md }}>
                <Shortcut icon={NotebookPen} title={t('siteNotes')} subtitle={t('notesCount', { n: noteCount })} onPress={() => router.push('/notes')} />
                <Shortcut icon={FileDown} title={t('importPdf')} subtitle={t('importPdfHint')} onPress={() => router.push('/import')} />
              </View>
            </View>
          }>
          {/* the company: its mark on a white tile, its name, and the way to its details (printed on estimates) */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t('companyAndBank')}. ${t('companyAndBankHint')}`}
              onPress={openCompany}
              style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <View style={{ width: 60, height: 60, borderRadius: radius.md + 2, backgroundColor: c.heroWhite, alignItems: 'center', justifyContent: 'center' }}>
                <BrandMark size={40} scheme="light" />
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Txt variant="title" weight="bold" color="onHeader" numberOfLines={2}>
                  {company.name || 'Bluemoon Engineering'}
                </Txt>
                <Txt variant="caption" weight="semibold" color="onHeaderMuted" numberOfLines={2}>
                  {t('companyAndBank')}
                </Txt>
              </View>
            </Pressable>
            <HeroAction icon={Pencil} label={t('companyAndBank')} onPress={openCompany} />
          </View>
        </Hero>

        <SecuritySection
          driveRow={
            <ListRow
              icon={driveEmail ? Cloud : CloudOff}
              iconTone={driveEmail ? 'success' : 'warning'}
              title={t('googleDrive')}
              subtitle={driveEmail ?? t('driveNotConnected')}
              onPress={() => router.push('/backup')}
            />
          }
        />

        <SectionTitle title={t('appearance')} />
        <Card gap={space.lg}>
          <Segmented<Lang>
            label={t('language')}
            value={lang}
            onChange={(v) => void guard('settings.lang', t, () => setSetting('lang', v))}
            options={(Object.keys(LANG_NAMES) as Lang[]).map((l) => ({ value: l, label: LANG_NAMES[l] }))}
          />
          <Segmented<ThemePref>
            label={t('appearance')}
            value={theme}
            onChange={(v) => void guard('settings.theme', t, () => setSetting('theme', v))}
            options={(['system', 'light', 'dark'] as const).map((v) => ({ value: v, label: t(`theme_${v}`) }))}
          />
          <Segmented<TextSize>
            label={t('textSize')}
            value={textSize}
            onChange={(v) => void guard('settings.textSize', t, () => setSetting('text_size', v === 'medium' ? null : v))}
            options={[
              { value: 'small', label: t('textSmall') },
              { value: 'medium', label: t('textMedium') },
              { value: 'large', label: t('textLarge') },
            ]}
          />
        </Card>

        <SectionTitle title={t('help')} />
        <ListCard inset>
          <ListRow icon={Bug} iconTone="slate" title={t('reportProblem')} subtitle={t('errorLog')} onPress={() => router.push('/problem')} />
          {__DEV__ ? (
            <ListRow
              icon={Database}
              iconTone="slate"
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

        <SectionTitle title={t('about')} />
        <View style={{ gap: space.xs, alignItems: 'center' }}>
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

        <View style={{ alignItems: 'center', gap: 2 }} accessible accessibilityLabel={`${t('developedBy')} ZYFLO.TECH`}>
          <Txt variant="caption" color="textMuted" center>
            {t('developedBy')}
          </Txt>
          <Txt weight="bold" style={{ color: c.primary }} numeric center>
            ZYFLO.TECH
          </Txt>
        </View>
      </Screen>
    </>
  );
}

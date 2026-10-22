/**
 * Friendly recovery screen. Shown by the root ErrorBoundary, by the fatal-error
 * listener and when the database cannot open. It must never crash itself, so
 * it has two layers: the themed, localized version (needs the settings table),
 * and a bare fallback with the system scheme + device language that touches no
 * database at all. If the first throws, the second renders.
 */
import * as Application from 'expo-application';
import { File, Paths } from 'expo-file-system';
import { getLocales } from 'expo-localization';
import * as Sharing from 'expo-sharing';
import { AlertTriangle, Home, RefreshCw, Share2 } from 'lucide-react-native';
import { Component, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, Text, useColorScheme, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { useLang, useT } from '@/i18n';
import { en } from '@/i18n/en';
import { si } from '@/i18n/si';
import { ta } from '@/i18n/ta';
import { errorMessage, readErrorLog, reportError } from '@/lib/errors';
import { FONT_MAP, lineHeight, palette, radius, space, touch, type, useColors, type Palette } from '@/theme';

import { Button } from './ui/Button';
import { Txt } from './ui/Txt';

type Key = keyof typeof en;
type Strings = { title: string; body: string; tryAgain: string; shareLog: string; goHome: string };

export interface ErrorScreenProps {
  /** The error being recovered from; logged under `context` when both are given. */
  error?: unknown;
  context?: string;
  onRetry: () => void;
  /** Omit to hide the "Go to Today" button. */
  onHome?: () => void;
  /** Override title / body keys (e.g. `errorTitle` / `dbError` for a database that cannot open). */
  titleKey?: Key;
  bodyKey?: Key;
  /** Hide the share button. */
  hideShare?: boolean;
}

// ---------------------------------------------------------------- log sharing

/** The shareable text: app name, version, platform, language, then the log. Never throws. */
export function buildErrorReport(lang: string): string {
  const head = [
    `${Application.applicationName ?? 'Bluemoon Site'} ${Application.nativeApplicationVersion ?? ''} (${Application.nativeBuildVersion ?? ''})`,
    `${Platform.OS} ${Platform.Version}`,
    `lang ${lang}`,
    new Date().toISOString(),
    '',
  ].join('\n');
  return head + (readErrorLog() || '(empty)');
}

/** Writes errors-YYYY-MM-DD.txt to the cache and opens the share sheet. Throws on failure (wrap in guard). */
export async function shareErrorLog(lang: string): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const f = new File(Paths.cache, `errors-${day}.txt`);
  if (f.exists) f.delete();
  f.create();
  f.write(buildErrorReport(lang));
  if (!(await Sharing.isAvailableAsync())) throw new Error('sharing-unavailable');
  await Sharing.shareAsync(f.uri, { mimeType: 'text/plain', dialogTitle: `errors-${day}.txt` });
}

function useShare(lang: string) {
  const [sharing, setSharing] = useState(false);
  async function share() {
    if (sharing) return;
    setSharing(true);
    try {
      await shareErrorLog(lang);
    } catch (e) {
      reportError(e, 'error-screen.share');
    } finally {
      setSharing(false);
    }
  }
  return { sharing, share };
}

// ---------------------------------------------------------------- themed version

function LocalizedErrorScreen(props: ErrorScreenProps) {
  const c = useColors();
  const t = useT();
  const lang = useLang();
  const { sharing, share } = useShare(lang);
  const detail = __DEV__ && props.error !== undefined ? errorMessage(props.error) : null;
  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: space.xl, gap: space.md, alignItems: 'center' }}>
          <View style={{ width: touch, height: touch, borderRadius: radius.lg, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
            <AlertTriangle size={28} color={c.danger} strokeWidth={2} />
          </View>
          <Txt variant="title" weight="semibold" center>
            {t(props.titleKey ?? 'appCrashed')}
          </Txt>
          <Txt color="textMuted" center style={{ maxWidth: 360 }}>
            {t(props.bodyKey ?? 'appCrashedBody')}
          </Txt>
          {detail ? (
            <Txt variant="caption" color="textMuted" center numeric style={{ maxWidth: 360 }}>
              {detail}
            </Txt>
          ) : null}
          <View style={{ gap: space.md, marginTop: space.md, maxWidth: 480, width: '100%' }}>
            <Button icon={RefreshCw} label={t('tryAgain')} onPress={props.onRetry} full />
            {props.hideShare ? null : <Button kind="secondary" icon={Share2} label={t('shareLog')} onPress={() => void share()} loading={sharing} full />}
            {props.onHome ? <Button kind="ghost" icon={Home} label={t('goHome')} onPress={props.onHome} full /> : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

// ---------------------------------------------------------------- bare fallback (no database)

function deviceStrings(titleKey: Key = 'appCrashed', bodyKey: Key = 'appCrashedBody'): { lang: string; s: Strings } {
  const code = getLocales()[0]?.languageCode ?? 'en';
  const d: Record<string, string> = code === 'si' ? si : code === 'ta' ? ta : en;
  const pick = (k: Key) => d[k] ?? en[k];
  return { lang: code, s: { title: pick(titleKey), body: pick(bodyKey), tryAgain: pick('tryAgain'), shareLog: pick('shareLog'), goHome: pick('goHome') } };
}

function BareText({ c, size, weight = 'regular', color, children }: { c: Palette; size: 'caption' | 'body' | 'title'; weight?: 'regular' | 'semibold'; color?: string; children: ReactNode }) {
  return (
    <Text
      maxFontSizeMultiplier={1.3}
      style={{ color: color ?? c.text, fontSize: type[size], lineHeight: lineHeight[size].complex, fontFamily: FONT_MAP.en[weight], textAlign: 'center', maxWidth: 360 }}>
      {children}
    </Text>
  );
}

function BareButton({ c, label, onPress, kind, disabled }: { c: Palette; label: string; onPress: () => void; kind: 'primary' | 'secondary' | 'ghost'; disabled?: boolean }) {
  const bg = kind === 'primary' ? c.primary : kind === 'secondary' ? c.card : 'transparent';
  const pressedBg = kind === 'primary' ? c.primaryPressed : kind === 'secondary' ? c.muted : c.primarySoft;
  const fg = kind === 'primary' ? c.onPrimary : kind === 'secondary' ? c.text : c.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: touch,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: kind === 'secondary' ? c.borderStrong : 'transparent',
        backgroundColor: pressed ? pressedBg : bg,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 20,
      })}>
      <Text maxFontSizeMultiplier={1.3} style={{ color: fg, fontSize: type.bodyLg, lineHeight: lineHeight.bodyLg.complex, fontFamily: FONT_MAP.en.semibold, textAlign: 'center' }}>
        {label}
      </Text>
    </Pressable>
  );
}

function BareErrorScreen(props: ErrorScreenProps) {
  const scheme = useColorScheme();
  const c = palette[scheme === 'dark' ? 'dark' : 'light'];
  const { lang, s } = deviceStrings(props.titleKey, props.bodyKey);
  const { sharing, share } = useShare(lang);
  const detail = __DEV__ && props.error !== undefined ? errorMessage(props.error) : null;
  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: space.xl, gap: space.md, alignItems: 'center' }}>
          <View style={{ width: touch, height: touch, borderRadius: radius.lg, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
            <AlertTriangle size={28} color={c.danger} strokeWidth={2} />
          </View>
          <BareText c={c} size="title" weight="semibold">
            {s.title}
          </BareText>
          <BareText c={c} size="body" color={c.textMuted}>
            {s.body}
          </BareText>
          {detail ? (
            <BareText c={c} size="caption" color={c.textMuted}>
              {detail}
            </BareText>
          ) : null}
          <View style={{ gap: space.md, marginTop: space.md, maxWidth: 480, width: '100%' }}>
            <BareButton c={c} label={s.tryAgain} onPress={props.onRetry} kind="primary" />
            {props.hideShare ? null : <BareButton c={c} label={s.shareLog} onPress={() => void share()} kind="secondary" disabled={sharing} />}
            {props.onHome ? <BareButton c={c} label={s.goHome} onPress={props.onHome} kind="ghost" /> : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

/** If the themed screen itself throws (database down), render the bare one. */
class Guarded extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    reportError(err, 'error-screen.render');
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Friendly recovery screen: icon, "The app hit a problem", body, Try again /
 * Share error log / Go to Today. Works even when the database cannot open.
 */
export function ErrorScreen(props: ErrorScreenProps) {
  return (
    <Guarded fallback={<BareErrorScreen {...props} />}>
      <LocalizedErrorScreen {...props} />
    </Guarded>
  );
}

import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { setStatusBarStyle } from 'expo-status-bar';
import { Fingerprint } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/Brand';
import { PinDots, PinPad } from '@/components/PinPad';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { askBiometric, loadLock, lockNow, RELOCK_AFTER_MS, tryPin, unlock, useLockState } from '@/lib/appLock';
import { reportError } from '@/lib/errors';
import { radius, space, touchMin, useColors, useScheme } from '@/theme';

/** Seconds left until `until`, refreshed every second while there are any. */
function useSecondsLeft(until: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);
  return Math.max(0, Math.ceil((until - now) / 1000));
}

/**
 * Covers the whole app while it is locked (a Modal, so it also covers the native headers and swallows
 * the Back button). Renders nothing when the lock is off. Mounted once in the root layout.
 */
export function AppLock() {
  const lock = useLockState();
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    void loadLock(true);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') hiddenAt.current = Date.now();
      else if (s === 'active') {
        const away = hiddenAt.current == null ? 0 : Date.now() - hiddenAt.current;
        hiddenAt.current = null;
        if (away >= RELOCK_AFTER_MS) lockNow();
      }
    });
    return () => sub.remove();
  }, []);

  if (!lock.enabled || !lock.locked) return null;
  return <LockScreen />;
}

/** Faint site grid on the lock's blue half (the hero's grid; the lock lives outside navigation, so not the Hero itself). */
function LockGrid() {
  const c = useColors();
  const lines = Array.from({ length: 30 }, (_, i) => (i + 1) * 28);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.07 }}>
      {lines.map((x) => (
        <View key={`v${x}`} style={{ position: 'absolute', top: 0, bottom: 0, left: x, width: 1, backgroundColor: c.heroWhite }} />
      ))}
      {lines.map((y) => (
        <View key={`h${y}`} style={{ position: 'absolute', left: 0, right: 0, top: y, height: 1, backgroundColor: c.heroWhite }} />
      ))}
    </View>
  );
}

function LockScreen() {
  const t = useT();
  const c = useColors();
  const scheme = useScheme();
  const insets = useSafeAreaInsets();

  // white status-bar icons over the blue while locked
  useEffect(() => {
    setStatusBarStyle('light');
    return () => setStatusBarStyle(scheme === 'dark' ? 'light' : 'dark');
  }, [scheme]);
  const lock = useLockState();
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(0);
  const [wrong, setWrong] = useState(false);
  const [checking, setChecking] = useState(false);
  const secondsLeft = useSecondsLeft(lock.waitUntil);
  const waiting = secondsLeft > 0;
  const asked = useRef(false);

  async function fingerprint() {
    const ok = await askBiometric(t('unlockPrompt'), t('usePin'));
    if (ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      unlock();
    }
  }

  // The fingerprint prompt opens by itself once per lock; the keypad stays underneath as the fallback.
  useEffect(() => {
    if (lock.bio && !asked.current) {
      asked.current = true;
      void fingerprint();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lock.bio]);

  async function onChange(next: string) {
    setWrong(false);
    setPin(next);
    if (!lock.pinLength || next.length < lock.pinLength || checking) return;
    setChecking(true);
    try {
      const r = await tryPin(next);
      if (r.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        unlock();
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setWrong(true);
      setShake((n) => n + 1);
      setPin('');
    } catch (e) {
      reportError(e, 'lock.check');
      setPin('');
    } finally {
      setChecking(false);
    }
  }

  const message = waiting ? t('pinWait', { s: secondsLeft }) : checking ? t('pinChecking') : wrong ? t('pinWrong') : t('enterPin');

  return (
    <Modal visible transparent={false} animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={() => undefined}>
      <View testID="app-lock" style={{ flex: 1, backgroundColor: c.header }}>
        {/* Blueprint lock: the blue half with the mark, then a white rounded panel holding the keys */}
        <LinearGradient colors={[c.header, c.headerEnd]} start={{ x: 0.1, y: 1 }} end={{ x: 1, y: 0 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        <LockGrid />
        <View style={{ flex: 1, minHeight: 220, paddingTop: insets.top + space.xl, paddingHorizontal: space.lg, paddingBottom: space.xl, alignItems: 'center', justifyContent: 'center', gap: space.md }}>
          <View style={{ width: 80, height: 80, borderRadius: radius.lg + 2, backgroundColor: c.heroWhite, alignItems: 'center', justifyContent: 'center' }}>
            <BrandMark size={52} scheme="light" />
          </View>
          <Txt variant="caption" weight="bold" color="onHeaderMuted" style={{ letterSpacing: 1.6 }}>
            BLUEMOON SITE
          </Txt>
          <Txt variant="heading" weight="bold" color="onHeader" center>
            {t('appLocked')}
          </Txt>
          <Txt color="onHeader" weight={wrong || waiting ? 'bold' : 'regular'} center accessibilityLiveRegion="polite" numeric={waiting}>
            {message}
          </Txt>
          <View style={{ paddingTop: space.sm, minHeight: 36, justifyContent: 'center' }}>
            {checking ? <ActivityIndicator color={c.onHeader} /> : <PinDots count={pin.length} slots={lock.pinLength} shake={shake} error={wrong} onBlue />}
          </View>
        </View>

        <View
          style={{
            backgroundColor: c.bg,
            borderTopLeftRadius: radius.xl + 4,
            borderTopRightRadius: radius.xl + 4,
            paddingTop: space.xl,
            paddingHorizontal: space.lg,
            paddingBottom: Math.max(insets.bottom, space.lg) + space.md,
            gap: space.md,
            alignItems: 'center',
          }}>
          <PinPad
            value={pin}
            onChange={(v) => void onChange(v)}
            maxLength={lock.pinLength ?? 6}
            disabled={waiting || checking}
            extra={lock.bio ? { icon: Fingerprint, label: t('useFingerprint'), onPress: () => void fingerprint() } : undefined}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => Alert.alert(t('forgotPinTitle'), t('forgotPinBody'))}
            style={({ pressed }) => ({ minHeight: touchMin, justifyContent: 'center', paddingHorizontal: space.lg, borderRadius: radius.md, backgroundColor: pressed ? c.primarySoft : 'transparent' })}>
            <Txt weight="bold" color="primary">
              {t('forgotPin')}
            </Txt>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

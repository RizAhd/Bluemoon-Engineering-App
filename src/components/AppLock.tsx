import * as Haptics from 'expo-haptics';
import { Fingerprint, Lock } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/Brand';
import { PinDots, PinPad } from '@/components/PinPad';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { askBiometric, loadLock, lockNow, RELOCK_AFTER_MS, tryPin, unlock, useLockState } from '@/lib/appLock';
import { reportError } from '@/lib/errors';
import { space, touchMin, useColors } from '@/theme';

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

function LockScreen() {
  const t = useT();
  const c = useColors();
  const insets = useSafeAreaInsets();
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

  const message = waiting ? t('pinWait', { s: secondsLeft }) : wrong ? t('pinWrong') : t('enterPin');

  return (
    <Modal visible transparent={false} animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={() => undefined}>
      <View
        testID="app-lock"
        style={{
          flex: 1,
          backgroundColor: c.bg,
          paddingTop: insets.top + space.xxl,
          paddingBottom: Math.max(insets.bottom, space.lg) + space.lg,
          paddingHorizontal: space.lg,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
        <View style={{ alignItems: 'center', gap: space.md }}>
          <BrandMark size={56} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Lock size={18} color={c.textMuted} strokeWidth={2} />
            <Txt variant="title" weight="semibold">
              {t('appLocked')}
            </Txt>
          </View>
          <Txt color={wrong || waiting ? 'danger' : 'textMuted'} weight={wrong || waiting ? 'semibold' : 'regular'} center accessibilityLiveRegion="polite" numeric={waiting}>
            {message}
          </Txt>
          <View style={{ paddingVertical: space.md }}>
            <PinDots count={pin.length} slots={lock.pinLength} shake={shake} error={wrong} />
          </View>
        </View>

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
          style={({ pressed }) => ({ minHeight: touchMin, justifyContent: 'center', paddingHorizontal: space.lg, borderRadius: 8, backgroundColor: pressed ? c.muted : 'transparent' })}>
          <Txt weight="semibold" color="primary">
            {t('forgotPin')}
          </Txt>
        </Pressable>
      </View>
    </Modal>
  );
}

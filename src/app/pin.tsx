import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { PinDots, PinPad } from '@/components/PinPad';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { useT, type TKey } from '@/i18n';
import { biometricAvailable, clearPin, setBiometric, setPin, tryPin, useLockState } from '@/lib/appLock';
import { showError } from '@/lib/errors';
import { space } from '@/theme';

type Mode = 'set' | 'change' | 'off';
type Step = 'current' | 'new' | 'confirm';

/**
 * Choose, change or remove the app-lock PIN.
 *   set     new PIN → the same again → (offer the fingerprint)
 *   change  current PIN → new PIN → the same again
 *   off     current PIN → the lock is removed
 */
export default function PinScreen() {
  const t = useT();
  const params = useLocalSearchParams<{ mode?: string }>();
  const mode: Mode = params.mode === 'change' || params.mode === 'off' ? params.mode : 'set';
  const lock = useLockState();
  const [step, setStep] = useState<Step>(mode === 'set' ? 'new' : 'current');
  const [value, setValue] = useState('');
  const [first, setFirst] = useState('');
  const [error, setError] = useState<TKey | null>(null);
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);

  function fail(key: TKey) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    setError(key);
    setShake((n) => n + 1);
    setValue('');
  }

  async function finish(pin: string) {
    setBusy(true);
    try {
      await setPin(pin);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast(t(mode === 'change' ? 'pinChanged' : 'appLockOn'));
      if (mode === 'set' && (await biometricAvailable())) {
        Alert.alert(t('useFingerprintTitle'), t('useFingerprintBody'), [
          { text: t('notNow'), style: 'cancel', onPress: () => router.back() },
          {
            text: t('useFingerprint'),
            onPress: () => {
              void setBiometric(true)
                .catch((e) => showError(e, 'lock.bio', t))
                .finally(() => router.back());
            },
          },
        ]);
      } else router.back();
    } catch (e) {
      showError(e, 'lock.set', t);
    } finally {
      setBusy(false);
    }
  }

  async function checkCurrent(pin: string) {
    setBusy(true);
    try {
      const r = await tryPin(pin);
      if (!r.ok) {
        fail(r.waitUntil > Date.now() ? 'pinTooMany' : 'pinWrong');
        return;
      }
      if (mode === 'off') {
        await clearPin();
        toast(t('appLockOff'));
        router.back();
        return;
      }
      setValue('');
      setError(null);
      setStep('new');
    } catch (e) {
      showError(e, 'lock.check', t);
    } finally {
      setBusy(false);
    }
  }

  function onChange(next: string) {
    setError(null);
    setValue(next);
    if (step === 'current' && lock.pinLength && next.length === lock.pinLength) void checkCurrent(next);
    if (step === 'confirm' && next.length === first.length) {
      if (next === first) void finish(next);
      else {
        fail('pinMismatch');
        setFirst('');
        setStep('new');
      }
    }
  }

  function next() {
    if (value.length < 4) return;
    setFirst(value);
    setValue('');
    setError(null);
    setStep('confirm');
  }

  const title: TKey = step === 'current' ? 'pinEnterCurrent' : step === 'new' ? 'pinChooseNew' : 'pinConfirm';
  const slots = step === 'current' ? lock.pinLength : step === 'confirm' ? first.length : null;

  return (
    <>
      <Stack.Screen options={{ title: t(mode === 'off' ? 'appLockTurnOff' : mode === 'change' ? 'changePin' : 'appLock') }} />
      <Screen
        footer={
          step === 'new' ? <Button label={t('next')} onPress={next} disabled={value.length < 4 || busy} full /> : undefined
        }>
        <View style={{ alignItems: 'center', gap: space.md, paddingTop: space.lg }}>
          <Txt variant="title" weight="semibold" center>
            {t(title)}
          </Txt>
          <Txt color={error ? 'danger' : 'textMuted'} weight={error ? 'semibold' : 'regular'} center accessibilityLiveRegion="polite">
            {error ? t(error) : step === 'new' ? t('pinRule') : ' '}
          </Txt>
          <View style={{ paddingVertical: space.md }}>
            <PinDots count={value.length} slots={slots} shake={shake} error={!!error} />
          </View>
          <PinPad value={value} onChange={onChange} maxLength={slots ?? 6} disabled={busy} />
        </View>
      </Screen>
    </>
  );
}

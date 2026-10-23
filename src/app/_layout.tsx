// Deep imports: the package index pulls in every weight (about 10 MB of fonts the app never uses).
import { NotoSans_400Regular } from '@expo-google-fonts/noto-sans/400Regular';
import { NotoSans_600SemiBold } from '@expo-google-fonts/noto-sans/600SemiBold';
import { NotoSans_700Bold } from '@expo-google-fonts/noto-sans/700Bold';
import { NotoSansSinhala_400Regular } from '@expo-google-fonts/noto-sans-sinhala/400Regular';
import { NotoSansSinhala_600SemiBold } from '@expo-google-fonts/noto-sans-sinhala/600SemiBold';
import { NotoSansSinhala_700Bold } from '@expo-google-fonts/noto-sans-sinhala/700Bold';
import { NotoSansTamil_400Regular } from '@expo-google-fonts/noto-sans-tamil/400Regular';
import { NotoSansTamil_600SemiBold } from '@expo-google-fonts/noto-sans-tamil/600SemiBold';
import { NotoSansTamil_700Bold } from '@expo-google-fonts/noto-sans-tamil/700Bold';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider, usePathname, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState } from 'react';
import { Appearance, Keyboard, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AnimatedSplash } from '@/components/AnimatedSplash';
import { AppLock } from '@/components/AppLock';
import { AutoBackupRunner } from '@/components/AutoBackupRunner';
import { ErrorScreen } from '@/components/ErrorScreen';
import { RecoveryPrompt } from '@/components/RecoveryPrompt';
import { ShareReceiver } from '@/components/ShareReceiver';
import { ToastHost } from '@/components/ui/feedback';
import { TamaguiScope } from '@/components/ui/kit';
import { getDb, getSetting } from '@/db';
import { useT } from '@/i18n';
import { installGlobalErrorHandlers, reportError, setFatalErrorListener } from '@/lib/errors';
import { installKeyboardHygiene } from '@/lib/keyboard';
import { motion, type, useColors, useFont, useScheme, useThemePref } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});
installGlobalErrorHandlers();
installKeyboardHygiene();

/** Render errors anywhere in the tree land here (expo-router calls this with the error and a retry). */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    reportError(error, 'boundary');
    // A crash before the splash overlay drew must not leave the native splash covering this screen.
    SplashScreen.hideAsync().catch(() => {});
  }, [error]);
  return (
    <ErrorScreen
      error={error}
      onRetry={() => void retry()}
      onHome={() => {
        void retry();
        router.replace('/(tabs)');
      }}
    />
  );
}

function openDb(): string | null {
  try {
    getDb();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** The database was set aside at start-up: RecoveryPrompt asks about it at once, so no splash. */
function recoveringAtStart(): boolean {
  try {
    return !!getSetting('recovered_from_corruption');
  } catch {
    return false;
  }
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    NotoSans_400Regular,
    NotoSans_600SemiBold,
    NotoSans_700Bold,
    NotoSansSinhala_400Regular,
    NotoSansSinhala_600SemiBold,
    NotoSansSinhala_700Bold,
    NotoSansTamil_400Regular,
    NotoSansTamil_600SemiBold,
    NotoSansTamil_700Bold,
  });
  // Open the database (and run migrations) once, before the first screen renders.
  const [dbError, setDbError] = useState<string | null>(openDb);
  // Uncaught fatal JS errors show the recovery screen instead of closing the app.
  const [fatal, setFatal] = useState<Error | null>(null);
  const dbReady = !dbError;
  // A font that fails to load falls back to the system font rather than a splash that never ends.
  const fontsReady = fontsLoaded || !!fontError;
  const [recovering] = useState(() => !dbError && recoveringAtStart());
  // The animated splash runs once per start; an error or recovery screen ends it for good.
  const [splashDone, setSplashDone] = useState(false);
  const blocked = !!dbError || !!fatal || recovering;
  if (blocked && !splashDone) setSplashDone(true);

  useEffect(() => {
    setFatalErrorListener((err) => setFatal(err));
    return () => setFatalErrorListener(null);
  }, []);

  useEffect(() => {
    // Normally the overlay hides the native splash on its first frame; without the overlay, do it here.
    if (blocked) SplashScreen.hideAsync().catch(() => {});
  }, [blocked]);

  let content = null;
  if (dbError) {
    content = <ErrorScreen error={dbError} titleKey="errorTitle" bodyKey="dbError" onRetry={() => setDbError(openDb())} />;
  } else if (fatal) {
    content = (
      <ErrorScreen
        error={fatal}
        onRetry={() => setFatal(null)}
        onHome={() => {
          setFatal(null);
          router.replace('/(tabs)');
        }}
      />
    );
  } else if (fontsReady) {
    content = (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          {/* Tamagui follows the app's own light / dark choice (Settings → Theme), not only the system's. */}
          <TamaguiScope>
            <AppStack />
          </TamaguiScope>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {content}
      {splashDone ? null : <AnimatedSplash ready={fontsReady && dbReady} onDone={() => setSplashDone(true)} />}
    </View>
  );
}

function AppStack() {
  const scheme = useScheme();
  const pref = useThemePref();
  const c = useColors();
  const font = useFont();
  const t = useT();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const pathname = usePathname();

  useEffect(() => {
    // A save that goes back, a tap that opens another screen: the keyboard never follows onto the next screen.
    Keyboard.dismiss();
  }, [pathname]);

  useEffect(() => {
    // Android navigation bar follows the tab bar; the status bar follows the scheme.
    SystemUI.setBackgroundColorAsync(c.tabBar).catch(() => {});
  }, [c.tabBar]);

  useEffect(() => {
    // Native dialogs, pickers and the keyboard follow the app's own Light / Dark choice, not only the phone's.
    try {
      Appearance.setColorScheme?.(pref === 'system' ? 'unspecified' : pref);
    } catch {
      // older runtimes: they keep following the phone
    }
  }, [pref]);

  return (
    <ThemeProvider
      value={{
        ...base,
        colors: { ...base.colors, primary: c.primary, background: c.bg, card: c.card, text: c.text, border: c.border },
      }}>
      {/* Edge-to-edge (SDK 58): the status bar is translucent over the header, so only the icon style is set. */}
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.header },
          headerShadowVisible: false,
          headerTintColor: c.text,
          headerTitleStyle: { fontFamily: font('semibold'), fontSize: type.bodyLg, color: c.onHeader },
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: c.bg },
          // the iOS-style push: the new screen slides in over the old one, which drifts left a little
          animation: 'ios_from_right',
          animationDuration: motion.slow + 60,
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="add"
          options={{ presentation: 'transparentModal', headerShown: false, animation: 'fade', animationDuration: 150, contentStyle: { backgroundColor: 'transparent' } }}
        />
        <Stack.Screen name="more" options={{ title: t('settingsAndMore') }} />
        <Stack.Screen name="project/form" options={{ title: t('project') }} />
        <Stack.Screen name="project/[id]" options={{ title: t('project') }} />
        <Stack.Screen name="expense/form" options={{ title: t('expense') }} />
        <Stack.Screen name="worker/form" options={{ title: t('worker') }} />
        <Stack.Screen name="worker/[id]" options={{ title: t('worker') }} />
        <Stack.Screen name="worker/assign" options={{ title: t('addWorkerToProject') }} />
        <Stack.Screen name="wage/form" options={{ title: t('wages') }} />
        <Stack.Screen name="wage/today" options={{ title: t('todaysWork'), animation: 'slide_from_bottom' }} />
        <Stack.Screen name="tool/form" options={{ title: t('tool') }} />
        <Stack.Screen name="tool/[id]" options={{ title: t('tool') }} />
        <Stack.Screen name="tool/move" options={{ title: t('tool') }} />
        <Stack.Screen name="note/form" options={{ title: t('siteNotes') }} />
        <Stack.Screen name="notes" options={{ title: t('siteNotes') }} />
        <Stack.Screen name="import" options={{ title: t('importPdf') }} />
        <Stack.Screen name="backup" options={{ title: t('backup') }} />
        <Stack.Screen name="problem" options={{ title: t('reportProblem') }} />
        <Stack.Screen name="company" options={{ title: t('companyAndBank') }} />
        <Stack.Screen name="estimate/index" options={{ title: t('estimates') }} />
        <Stack.Screen name="estimate/form" options={{ title: t('estimate') }} />
        <Stack.Screen name="estimate/[id]" options={{ title: t('estimate') }} />
        <Stack.Screen name="estimate/item" options={{ title: t('item') }} />
        <Stack.Screen name="estimate/payment" options={{ title: t('paymentStage') }} />
      </Stack>
      <ToastHost />
      <ShareReceiver />
      <AutoBackupRunner />
      <RecoveryPrompt />
      <AppLock />
    </ThemeProvider>
  );
}

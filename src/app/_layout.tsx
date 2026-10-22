import { NotoSans_400Regular, NotoSans_600SemiBold, NotoSans_700Bold } from '@expo-google-fonts/noto-sans';
import {
  NotoSansSinhala_400Regular,
  NotoSansSinhala_600SemiBold,
  NotoSansSinhala_700Bold,
} from '@expo-google-fonts/noto-sans-sinhala';
import { NotoSansTamil_400Regular, NotoSansTamil_600SemiBold, NotoSansTamil_700Bold } from '@expo-google-fonts/noto-sans-tamil';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AutoBackupRunner } from '@/components/AutoBackupRunner';
import { ErrorScreen } from '@/components/ErrorScreen';
import { RecoveryPrompt } from '@/components/RecoveryPrompt';
import { ShareReceiver } from '@/components/ShareReceiver';
import { ToastHost } from '@/components/ui/feedback';
import { getDb } from '@/db';
import { useT } from '@/i18n';
import { installGlobalErrorHandlers, reportError, setFatalErrorListener } from '@/lib/errors';
import { motion, useColors, useFont, useScheme } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});
installGlobalErrorHandlers();

/** Render errors anywhere in the tree land here (expo-router calls this with the error and a retry). */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    reportError(error, 'boundary');
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

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
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

  useEffect(() => {
    setFatalErrorListener((err) => setFatal(err));
    return () => setFatalErrorListener(null);
  }, []);

  useEffect(() => {
    if ((fontsLoaded && dbReady) || dbError) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, dbReady, dbError]);

  if (dbError) {
    return <ErrorScreen error={dbError} titleKey="errorTitle" bodyKey="dbError" onRetry={() => setDbError(openDb())} />;
  }
  if (!fontsLoaded) return null;

  if (fatal) {
    return (
      <ErrorScreen
        error={fatal}
        onRetry={() => setFatal(null)}
        onHome={() => {
          setFatal(null);
          router.replace('/(tabs)');
        }}
      />
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppStack />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AppStack() {
  const scheme = useScheme();
  const c = useColors();
  const font = useFont();
  const t = useT();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;

  useEffect(() => {
    // Android navigation bar follows the tab bar; the status bar follows the scheme.
    SystemUI.setBackgroundColorAsync(c.tabBar).catch(() => {});
  }, [c.tabBar]);

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
          headerTitleStyle: { fontFamily: font('semibold'), fontSize: 18, color: c.onHeader },
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: c.bg },
          animation: 'slide_from_right',
          animationDuration: motion.slow,
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
      </Stack>
      <ToastHost />
      <ShareReceiver />
      <AutoBackupRunner />
      <RecoveryPrompt />
    </ThemeProvider>
  );
}

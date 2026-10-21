import { NotoSans_400Regular, NotoSans_600SemiBold, NotoSans_700Bold } from '@expo-google-fonts/noto-sans';
import {
  NotoSansSinhala_400Regular,
  NotoSansSinhala_600SemiBold,
  NotoSansSinhala_700Bold,
} from '@expo-google-fonts/noto-sans-sinhala';
import { NotoSansTamil_400Regular, NotoSansTamil_600SemiBold, NotoSansTamil_700Bold } from '@expo-google-fonts/noto-sans-tamil';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AutoBackupRunner } from '@/components/AutoBackupRunner';
import { ShareReceiver } from '@/components/ShareReceiver';
import { ToastHost } from '@/components/ui/feedback';
import { Txt } from '@/components/ui/Txt';
import { getDb } from '@/db';
import { useT } from '@/i18n';
import { useColors, useFont, useScheme } from '@/theme';

SplashScreen.preventAutoHideAsync();

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
  const [dbError] = useState<string | null>(() => {
    try {
      getDb();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  });
  const dbReady = !dbError;

  useEffect(() => {
    if ((fontsLoaded && dbReady) || dbError) SplashScreen.hideAsync();
  }, [fontsLoaded, dbReady, dbError]);

  if (dbError) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
        <Txt weight="bold" variant="title">
          Database could not open
        </Txt>
        <Txt>{dbError}</Txt>
      </View>
    );
  }
  if (!fontsLoaded || !dbReady) return null;

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

  return (
    <ThemeProvider
      value={{
        ...base,
        colors: { ...base.colors, primary: c.primary, background: c.bg, card: c.card, text: c.text, border: c.border },
      }}>
      {/* Every header is blue, so the status bar text is always white. */}
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.header },
          headerShadowVisible: false,
          headerTintColor: c.onHeader,
          headerTitleStyle: { fontFamily: font('bold'), fontSize: 20, color: c.onHeader },
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: c.bg },
          animation: 'slide_from_right',
          animationDuration: 240,
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="add"
          options={{ presentation: 'transparentModal', headerShown: false, animation: 'fade', contentStyle: { backgroundColor: 'transparent' } }}
        />
        <Stack.Screen name="project/form" options={{ title: t('project') }} />
        <Stack.Screen name="project/[id]" options={{ title: t('costSummary') }} />
        <Stack.Screen name="projects" options={{ title: t('projects') }} />
        <Stack.Screen name="expense/form" options={{ title: t('expense') }} />
        <Stack.Screen name="worker/form" options={{ title: t('worker') }} />
        <Stack.Screen name="worker/[id]" options={{ title: t('worker') }} />
        <Stack.Screen name="wage/form" options={{ title: t('workers') }} />
        <Stack.Screen name="tool/form" options={{ title: t('tool') }} />
        <Stack.Screen name="tool/[id]" options={{ title: t('tool') }} />
        <Stack.Screen name="tool/move" options={{ title: t('tool') }} />
        <Stack.Screen name="note/form" options={{ title: t('siteNotes') }} />
        <Stack.Screen name="notes" options={{ title: t('siteNotes') }} />
        <Stack.Screen name="import" options={{ title: t('importPdf') }} />
        <Stack.Screen name="backup" options={{ title: t('backup') }} />
      </Stack>
      <ToastHost />
      <ShareReceiver />
      <AutoBackupRunner />
    </ThemeProvider>
  );
}

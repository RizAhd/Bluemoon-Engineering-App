import * as Haptics from 'expo-haptics';
import { router, Tabs } from 'expo-router';
import { Hammer, HardHat, LayoutGrid, Plus, Receipt, Sun } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';
import { space, useColors, useFont } from '@/theme';

export default function TabLayout() {
  const c = useColors();
  const t = useT();
  const font = useFont();
  const insets = useSafeAreaInsets();
  const barHeight = 64 + insets.bottom;

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: c.primary,
          tabBarInactiveTintColor: c.textMuted,
          tabBarStyle: {
            backgroundColor: c.tabBar,
            borderTopColor: c.border,
            height: barHeight,
            paddingTop: 6,
            paddingBottom: insets.bottom + 6,
          },
          tabBarLabelStyle: { fontFamily: font('semibold'), fontSize: 12 },
          sceneStyle: { backgroundColor: c.bg },
        }}>
        <Tabs.Screen name="index" options={{ title: t('tabToday'), tabBarIcon: ({ color }) => <Sun size={24} color={color} /> }} />
        <Tabs.Screen name="expenses" options={{ title: t('tabExpenses'), tabBarIcon: ({ color }) => <Receipt size={24} color={color} /> }} />
        <Tabs.Screen name="workers" options={{ title: t('tabWorkers'), tabBarIcon: ({ color }) => <HardHat size={24} color={color} /> }} />
        <Tabs.Screen name="tools" options={{ title: t('tabTools'), tabBarIcon: ({ color }) => <Hammer size={24} color={color} /> }} />
        <Tabs.Screen name="more" options={{ title: t('tabMore'), tabBarIcon: ({ color }) => <LayoutGrid size={24} color={color} /> }} />
      </Tabs>

      {/* One big Add button, always in the same place, for fast entry on site. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('quickAdd')}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          router.push('/add');
        }}
        style={({ pressed }) => ({
          position: 'absolute',
          right: space.lg,
          bottom: barHeight + space.lg,
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: pressed ? c.primaryPressed : c.primary,
          alignItems: 'center',
          justifyContent: 'center',
          elevation: 6,
          shadowColor: '#000',
          shadowOpacity: 0.2,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
        })}>
        <Plus size={32} color={c.onPrimary} strokeWidth={2.6} />
      </Pressable>
    </View>
  );
}

import * as Haptics from 'expo-haptics';
import { router, Tabs, usePathname } from 'expo-router';
import { Building2, Hammer, HardHat, Plus, Receipt, Sun } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { type ColorValue, Keyboard, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Txt } from '@/components/ui/Txt';
import { useProjects } from '@/hooks/data';
import { useT } from '@/i18n';
import { fabEdgeDark, hairline, radius, sizes, space, tabLabel, useColors, useFont, useLayout, useMotion, useScheme } from '@/theme';

function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const a = Keyboard.addListener(showEvt, () => setOpen(true));
    const b = Keyboard.addListener(hideEvt, () => setOpen(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  return open;
}

export default function TabLayout() {
  const c = useColors();
  const scheme = useScheme();
  const t = useT();
  const font = useFont();
  const insets = useSafeAreaInsets();
  const { narrow } = useLayout();
  const m = useMotion();
  const pathname = usePathname();
  const keyboardOpen = useKeyboardOpen();
  const hasProjects = useProjects().length > 0;
  // Phones with full-screen gestures and the gesture line hidden (many Redmi / Xiaomi) report a
  // bottom inset of 0, which left the labels touching the screen edge where swipe-home starts.
  const bottomInset = Math.max(insets.bottom, space.md);
  const barHeight = sizes.tabBar + bottomInset;

  // The FAB's job follows the tab: "New project" on Projects, "Add" everywhere else.
  const onProjects = pathname.startsWith('/projects');
  const fabLabel = onProjects ? t('newProject') : t('quickAdd');
  const fabTarget = onProjects ? '/project/form' : '/add';
  // Without a single project the empty state owns the only blue button.
  const showFab = !keyboardOpen && (hasProjects || onProjects);

  const dark = scheme === 'dark';

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: c.primary,
          tabBarInactiveTintColor: c.textMuted,
          tabBarStyle: {
            backgroundColor: c.tabBar,
            borderTopWidth: hairline,
            borderTopColor: c.border,
            height: barHeight,
            paddingTop: space.sm,
            paddingBottom: bottomInset,
            elevation: 0,
            shadowOpacity: 0,
          },
          tabBarItemStyle: { paddingVertical: 0 },
          tabBarIconStyle: { width: 56, height: 32 },
          tabBarLabelStyle: { fontFamily: font('semibold'), fontSize: tabLabel.size, lineHeight: tabLabel.lineHeight, marginTop: space.xs },
          tabBarAllowFontScaling: true,
          sceneStyle: { backgroundColor: c.bg },
          animation: 'none',
        }}>
        <Tabs.Screen name="index" options={{ title: t('tabToday'), tabBarIcon: ({ color, focused }) => <TabIcon icon={Sun} color={color} focused={focused} /> }} />
        <Tabs.Screen name="projects" options={{ title: t('tabProjects'), tabBarIcon: ({ color, focused }) => <TabIcon icon={Building2} color={color} focused={focused} /> }} />
        <Tabs.Screen name="expenses" options={{ title: t('tabExpenses'), tabBarIcon: ({ color, focused }) => <TabIcon icon={Receipt} color={color} focused={focused} /> }} />
        <Tabs.Screen name="workers" options={{ title: t('tabWorkers'), tabBarIcon: ({ color, focused }) => <TabIcon icon={HardHat} color={color} focused={focused} /> }} />
        <Tabs.Screen name="tools" options={{ title: t('tabTools'), tabBarIcon: ({ color, focused }) => <TabIcon icon={Hammer} color={color} focused={focused} /> }} />
      </Tabs>

      {/* Extended FAB: always the same place, label says what it adds. Hidden while typing. */}
      {showFab ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={fabLabel}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            router.push(fabTarget);
          }}
          style={({ pressed }) => ({
            position: 'absolute',
            right: space.lg,
            bottom: barHeight + space.lg,
            height: sizes.fab,
            minWidth: sizes.fab,
            paddingHorizontal: narrow ? 0 : 20,
            borderRadius: radius.xl,
            backgroundColor: pressed ? c.primaryPressed : c.primary,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: space.sm,
            transform: [{ scale: pressed ? m.pressScale : 1 }],
            borderWidth: dark ? hairline : 0,
            borderColor: dark ? fabEdgeDark : 'transparent',
            elevation: dark ? 0 : 4,
            shadowColor: c.shadow,
            shadowOpacity: dark ? 0 : 1,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 4 },
          })}>
          <Plus size={22} color={c.onPrimary} strokeWidth={2.5} />
          {narrow ? null : (
            <Txt weight="semibold" style={{ color: c.onPrimary }} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {fabLabel}
            </Txt>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

/** Icon inside a 56 × 32 pill that fills `primarySoft` when the tab is focused. */
function TabIcon({ icon: Icon, color, focused }: { icon: typeof Sun; color: ColorValue; focused: boolean }) {
  const c = useColors();
  return (
    <View style={{ width: 56, height: 32, borderRadius: radius.xl, backgroundColor: focused ? c.primarySoft : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
      <Icon size={22} color={color} strokeWidth={2} />
    </View>
  );
}

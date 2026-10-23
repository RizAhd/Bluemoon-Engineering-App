import * as Haptics from 'expo-haptics';
import { router, Tabs, usePathname } from 'expo-router';
import { Building2, Hammer, HardHat, Plus, Receipt, Sun } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { type ColorValue, Keyboard, Platform, Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useProjects } from '@/hooks/data';
import { useT } from '@/i18n';
import { fabEdgeDark, hairline, radius, sizes, space, tabLabel, useColors, useFont, useMotion, useScheme } from '@/theme';

/** The FAB rises into place when it appears (a new tab, the keyboard closing). */
const FAB_IN = FadeInDown.duration(220);

/** Largest text-size multiplier the tab labels follow. */
const TAB_LABEL_MAX_SCALE = 1.2;

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
          // The label follows the phone's text size only up to 1.2x: at 2x the 12 / 16 label no longer fits the
          // 64 dp bar beside the 32 dp icon pill and five labels would be cut. One line, ellipsis if a language runs long.
          tabBarLabel: ({ color, children }) => (
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={TAB_LABEL_MAX_SCALE}
              style={{ color, fontFamily: font('semibold'), fontSize: tabLabel.size, lineHeight: tabLabel.lineHeight, marginTop: space.xs, textAlign: 'center' }}>
              {children}
            </Text>
          ),
          tabBarLabelStyle: { fontFamily: font('semibold'), fontSize: tabLabel.size, lineHeight: tabLabel.lineHeight, marginTop: space.xs },
          tabBarAllowFontScaling: true,
          sceneStyle: { backgroundColor: c.bg },
          // switching tabs slides the new list in a short way and fades it, instead of a hard cut
          animation: 'shift',
        }}>
        <Tabs.Screen name="index" options={{ title: t('tabToday'), tabBarIcon: ({ color, focused }) => <TabIcon icon={Sun} color={color} focused={focused} /> }} />
        <Tabs.Screen name="projects" options={{ title: t('tabProjects'), tabBarIcon: ({ color, focused }) => <TabIcon icon={Building2} color={color} focused={focused} /> }} />
        <Tabs.Screen name="expenses" options={{ title: t('tabExpenses'), tabBarIcon: ({ color, focused }) => <TabIcon icon={Receipt} color={color} focused={focused} /> }} />
        <Tabs.Screen name="workers" options={{ title: t('tabWorkers'), tabBarIcon: ({ color, focused }) => <TabIcon icon={HardHat} color={color} focused={focused} /> }} />
        <Tabs.Screen name="tools" options={{ title: t('tabTools'), tabBarIcon: ({ color, focused }) => <TabIcon icon={Hammer} color={color} focused={focused} /> }} />
      </Tabs>

      {/* FAB: a 56 dp "+" square, always the same place; its spoken label says what it adds. An icon-only FAB
          covers far less of the list than a labelled one (whose Sinhala / Tamil label ran half the width). Hidden while typing. */}
      {showFab ? (
        <Animated.View
          key={fabTarget}
          entering={m.reduced ? undefined : FAB_IN}
          style={{ position: 'absolute', right: space.lg, bottom: barHeight + space.lg }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={fabLabel}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            router.push(fabTarget);
          }}
          style={({ pressed }) => ({
            height: sizes.fab,
            width: sizes.fab,
            borderRadius: radius.xl,
            backgroundColor: pressed ? c.fillPressed : c.fill,
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
          <Plus size={26} color={c.onFill} strokeWidth={2.5} />
        </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}

/** Icon inside a 56 × 32 pill that fills `primarySoft` when the tab is focused. */
function TabIcon({ icon: Icon, color, focused }: { icon: typeof Sun; color: ColorValue; focused: boolean }) {
  const c = useColors();
  return (
    <View style={{ width: 56, height: 32, alignItems: 'center', justifyContent: 'center' }}>
      {/* the pill grows out from the icon, the way Material 3 marks the chosen tab; the icon itself never scales */}
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          borderRadius: radius.xl,
          backgroundColor: focused ? c.primarySoft : 'transparent',
          transform: [{ scaleX: focused ? 1 : 0.5 }],
          transitionProperty: ['backgroundColor', 'transform'],
          transitionDuration: 220,
          transitionTimingFunction: 'ease-out',
        }}
      />
      <Icon size={22} color={color} strokeWidth={focused ? 2.3 : 2} />
    </View>
  );
}

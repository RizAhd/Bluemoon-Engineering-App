import * as Haptics from 'expo-haptics';
import { router, Tabs, usePathname } from 'expo-router';
import { Hammer, HardHat, Home, Plus, Receipt } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useProjects } from '@/hooks/data';
import { useT } from '@/i18n';
import { radius, sizes, space, tabLabel, useColors, useFont, useLayout, useMotion, useScheme } from '@/theme';

/** The part of what expo-router hands a custom tab bar that this bar uses. */
interface BottomTabBarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  emitter: {
    emit: (e: { type: 'tabPress'; target: string; canPreventDefault: true }) => { defaultPrevented: boolean };
  };
  navigateToTab: (routeKey: string) => void;
}

/** Largest text-size multiplier the tab labels follow. */
const TAB_LABEL_MAX_SCALE = 1.2;

/** The tabs on the bar, in order; the centre "+" sits between the second and the third. Projects is a screen without a tab. */
const BAR = [
  { name: 'index', icon: Home, title: 'tabToday' },
  { name: 'expenses', icon: Receipt, title: 'tabExpenses' },
  { name: 'workers', icon: HardHat, title: 'tabWorkers' },
  { name: 'tools', icon: Hammer, title: 'tabTools' },
] as const;

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
  const t = useT();
  return (
    <Tabs
      tabBar={(props) => <BlueprintTabBar {...(props as unknown as BottomTabBarProps)} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: c.bg },
        // switching tabs slides the new list in a short way and fades it, instead of a hard cut
        animation: 'shift',
      }}>
      <Tabs.Screen name="index" options={{ title: t('tabToday') }} />
      <Tabs.Screen name="expenses" options={{ title: t('tabExpenses') }} />
      <Tabs.Screen name="workers" options={{ title: t('tabWorkers') }} />
      <Tabs.Screen name="tools" options={{ title: t('tabTools') }} />
      <Tabs.Screen name="projects" options={{ title: t('tabProjects') }} />
    </Tabs>
  );
}

/**
 * Blueprint tab bar: a navy bar floating 16 dp above the bottom edge, rounded, with four tabs and a raised blue "+"
 * in the middle (on Projects it starts a new project, elsewhere it opens the quick-add sheet). The chosen tab is
 * white and bold with a dot under it. Hidden while the keyboard is open.
 */
function BlueprintTabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const c = useColors();
  const t = useT();
  const font = useFont();
  const m = useMotion();
  const dark = useScheme() === 'dark';
  const insets = useSafeAreaInsets();
  const { column } = useLayout();
  const keyboardOpen = useKeyboardOpen();
  const pathname = usePathname();
  const hasProjects = useProjects().length > 0;
  if (keyboardOpen) return null;

  const current = state.routes[state.index]?.name;
  // the "+" follows the screen: "New project" on Projects, "Add" everywhere else
  const onProjects = current === 'projects' || pathname.startsWith('/projects');
  // without a single project the empty state owns the only blue button: no "+" beside it
  const showFab = hasProjects || onProjects;
  // Phones with full-screen gestures and the gesture line hidden report a bottom inset of 0: keep the bar off the edge.
  const bottom = Math.max(insets.bottom, space.sm) + space.sm;
  const fabLabel = onProjects ? t('newProject') : t('quickAdd');

  const tab = (b: (typeof BAR)[number]) => {
    const route = state.routes.find((r) => r.name === b.name);
    if (!route) return null;
    const focused = current === b.name;
    const color = focused ? c.onTabBar : c.onTabBarMuted;
    const Icon = b.icon;
    return (
      <Pressable
        key={b.name}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={t(b.title)}
        onPress={() => {
          const e = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !e.defaultPrevented) {
            Haptics.selectionAsync().catch(() => {});
            navigateToTab(route.key);
          }
        }}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: sizes.tabBar, gap: 3 }}>
        <Icon size={22} color={color} strokeWidth={focused ? 2.3 : 1.9} />
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
          maxFontSizeMultiplier={TAB_LABEL_MAX_SCALE}
          style={{ color, fontFamily: font(focused ? 'bold' : 'semibold'), fontSize: tabLabel.size, lineHeight: tabLabel.lineHeight, textAlign: 'center' }}>
          {t(b.title)}
        </Text>
        <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: focused ? c.onTabBar : 'transparent' }} />
      </Pressable>
    );
  };

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.lg, paddingBottom: bottom }}>
      <View
        style={[
          column,
          {
            flexDirection: 'row',
            alignItems: 'center',
            height: sizes.tabBar,
            paddingHorizontal: space.xs,
            borderRadius: radius.xl - 4,
            backgroundColor: c.tabBar,
            borderWidth: dark ? 1 : 0,
            borderColor: c.border,
            shadowColor: '#0A1B4D',
            shadowOpacity: dark ? 0 : 0.28,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 8 },
            elevation: 10,
          },
        ]}>
        {tab(BAR[0])}
        {tab(BAR[1])}
        <View style={{ width: sizes.fab + space.md, alignItems: 'center' }}>
          {/* the centre "+": a blue rounded square lifted above the bar, ringed in the page colour */}
          {showFab ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={fabLabel}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              router.push(onProjects ? '/project/form' : '/add');
            }}
            style={({ pressed }) => ({
              marginTop: -space.xxl,
              width: sizes.fab + 8,
              height: sizes.fab + 8,
              borderRadius: radius.lg + 4,
              borderWidth: 4,
              borderColor: c.bg,
              backgroundColor: pressed ? c.fillPressed : c.fill,
              alignItems: 'center',
              justifyContent: 'center',
              transform: [{ scale: pressed ? m.pressScale : 1 }],
              shadowColor: c.fill,
              shadowOpacity: dark ? 0 : 0.4,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 6 },
              elevation: 8,
            })}>
            <Plus size={30} color={c.onFill} strokeWidth={2.4} />
          </Pressable>
          ) : null}
        </View>
        {tab(BAR[2])}
        {tab(BAR[3])}
      </View>
    </View>
  );
}

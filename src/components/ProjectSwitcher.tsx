import { router } from 'expo-router';
import { ArrowUpDown, Building2, ChevronDown, LayoutGrid, Plus, Settings } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { Hero, HeroAction } from '@/components/Hero';
import { Button } from '@/components/ui/Button';
import { PickerSheet } from '@/components/ui/form';
import { Txt } from '@/components/ui/Txt';
import { setCurrentProject, useCurrentProjectId, useProjects } from '@/hooks/data';
import { useT } from '@/i18n';
import { hairline, radius, sizes, space, useColors } from '@/theme';

export interface ProjectPillProps {
  /** Offer "All projects" (current = null). Screens that need one project pass false. */
  allowAll?: boolean;
  /** Called after the current project changes (the pill already saved it). */
  onChange?: (id: string | null) => void;
  /** `hero`: the full-width glass bar on the blue hero (Blueprint); default: the small pill on white. */
  variant?: 'pill' | 'hero';
  style?: StyleProp<ViewStyle>;
}

/**
 * The current-project chooser: a 44-tall pill that opens the project PickerSheet.
 * The single source of truth for "current project" (`setCurrentProject`).
 */
export function ProjectPill({ allowAll = true, onChange, variant = 'pill', style }: ProjectPillProps) {
  const c = useColors();
  const t = useT();
  const projects = useProjects();
  const current = useCurrentProjectId();
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(false);
  const project = projects.find((p) => p.id === current);
  const name = project?.name ?? t('allProjects');
  const Icon = project ? Building2 : LayoutGrid;

  return (
    <>
      {variant === 'hero' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('chooseProject')}: ${name}`}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen(true)}
          style={({ pressed }) => [
            {
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              minHeight: 56,
              paddingLeft: space.sm,
              paddingRight: space.lg,
              borderRadius: radius.md + 2,
              backgroundColor: pressed ? c.headerDeep : c.headerSoft,
              borderWidth: hairline,
              borderColor: c.headerLine,
            },
            style,
          ]}>
          <View style={{ width: 40, height: 40, borderRadius: radius.md - 2, backgroundColor: c.headerSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon size={20} color={c.onHeader} strokeWidth={1.9} />
          </View>
          <Txt variant="bodyLg" weight="bold" color="onHeader" numberOfLines={1} style={{ flex: 1 }}>
            {name}
          </Txt>
          <ArrowUpDown size={18} color={c.onHeader} strokeWidth={2} />
        </Pressable>
      ) : (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('chooseProject')}: ${name}`}
        accessibilityState={{ expanded: open }}
        hitSlop={{ top: 2, bottom: 2 }}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          {
            flexDirection: 'row',
            alignItems: 'center',
            alignSelf: 'flex-start',
            gap: space.sm,
            minHeight: sizes.headerButton,
            maxWidth: '100%',
            paddingHorizontal: 14,
            borderRadius: radius.pill,
            backgroundColor: pressed ? c.headerDeep : c.headerSoft,
            borderWidth: hairline,
            borderColor: c.border,
            // focus ring drawn as an outer shadow-free outline: keep width constant
            outlineWidth: focus ? 2 : 0,
            outlineColor: c.focusRing,
          },
          style,
        ]}>
        <Icon size={18} color={project ? c.primary : c.textMuted} strokeWidth={2} />
        <Txt weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
          {name}
        </Txt>
        <ChevronDown size={18} color={c.textMuted} strokeWidth={2} />
      </Pressable>
      )}

      <PickerSheet
        visible={open}
        title={t('chooseProject')}
        value={current ?? (allowAll ? '__all' : null)}
        items={[
          ...(allowAll ? [{ id: '__all', title: t('allProjects'), icon: LayoutGrid }] : []),
          ...projects.map((p) => ({
            id: p.id,
            title: p.name,
            icon: Building2,
            subtitle: [p.location, t(`status_${p.status}`)].filter(Boolean).join(' · '),
          })),
        ]}
        onClose={() => setOpen(false)}
        onPick={(id) => {
          const next = id === '__all' || id === null ? null : id;
          if (next === null && !allowAll) return;
          setCurrentProject(next);
          setOpen(false);
          onChange?.(next);
        }}
        footer={
          // Projects has no tab of its own in the Blueprint layout: the chooser is the way to the full list
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <Button
                kind="secondary"
                icon={LayoutGrid}
                label={t('projects')}
                onPress={() => {
                  setOpen(false);
                  router.push('/(tabs)/projects');
                }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                kind="soft"
                icon={Plus}
                label={t('newProject')}
                onPress={() => {
                  setOpen(false);
                  router.push('/project/form');
                }}
              />
            </View>
          </View>
        }
      />
    </>
  );
}

export interface TabHeaderProps {
  title: string;
  /** Caption under the title (e.g. today's date). */
  subtitle?: string;
  allowAll?: boolean;
  /** Show the project pill (Projects tab passes false). */
  showProject?: boolean;
  /** One screen action (an `IconButton size={44}` with `onHeader` tone), placed just left of the settings button. */
  right?: ReactNode;
  /** Hide the settings button (rare). */
  hideMenu?: boolean;
  /** Show the Bluemoon logo mark before the title (the Today screen). */
  brand?: boolean;
  /** Hero content under the title and project bar (amount, chips, buttons). */
  children?: ReactNode;
  /** A card that sits half over the blue. */
  card?: ReactNode;
}

/**
 * White header for tab screens: [logo] title + subtitle, then one row with the project pill
 * on the left and the screen action + settings button on the right. The buttons live on the
 * second row, not in the top-right corner, so they never sit under the status bar (or under
 * Expo Go's own floating tools button while testing). Screens without a project pill keep
 * the buttons on the title row.
 */
export function TabHeader({ title, subtitle, allowAll = true, showProject = true, right, hideMenu, brand, children, card }: TabHeaderProps) {
  const t = useT();
  return (
    <Hero
      // standalone above a list: not inside a padded container
      flush
      title={title}
      subtitle={subtitle}
      brand={brand}
      project={showProject ? { allowAll } : false}
      card={card}
      actions={
        right || !hideMenu ? (
          <>
            {right}
            {hideMenu ? null : <HeroAction icon={Settings} label={t('settingsAndMore')} onPress={() => router.push('/more')} />}
          </>
        ) : undefined
      }>
      {children}
    </Hero>
  );
}

/** Header action helper so screens don't repeat the sizing: `<TabHeader right={<HeaderAction icon={UserPlus} label=… onPress=… />} />`. */
export function HeaderAction({ icon, label, onPress }: { icon: typeof Settings; label: string; onPress: () => void }) {
  return <HeroAction icon={icon} label={label} onPress={onPress} />;
}

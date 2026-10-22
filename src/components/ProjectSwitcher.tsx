import { router } from 'expo-router';
import { Building2, ChevronDown, LayoutGrid, Plus, Settings } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/Brand';
import { Button, IconButton } from '@/components/ui/Button';
import { PickerSheet } from '@/components/ui/form';
import { Txt } from '@/components/ui/Txt';
import { setCurrentProject, useCurrentProjectId, useProjects } from '@/hooks/data';
import { useT } from '@/i18n';
import { hairline, radius, sizes, space, useColors, useLayout } from '@/theme';

export interface ProjectPillProps {
  /** Offer "All projects" (current = null). Screens that need one project pass false. */
  allowAll?: boolean;
  /** Called after the current project changes (the pill already saved it). */
  onChange?: (id: string | null) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * The current-project chooser: a 44-tall pill that opens the project PickerSheet.
 * The single source of truth for "current project" (`setCurrentProject`).
 */
export function ProjectPill({ allowAll = true, onChange, style }: ProjectPillProps) {
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
        <Icon size={20} color={project ? c.primary : c.textMuted} strokeWidth={2} />
        <Txt weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
          {name}
        </Txt>
        <ChevronDown size={20} color={c.textMuted} strokeWidth={2} />
      </Pressable>

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
          <Button
            kind="secondary"
            icon={Plus}
            label={t('newProject')}
            onPress={() => {
              setOpen(false);
              router.push('/project/form');
            }}
          />
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
}

/**
 * White header for tab screens: [logo] title + subtitle, then one row with the project pill
 * on the left and the screen action + settings button on the right. The buttons live on the
 * second row, not in the top-right corner, so they never sit under the status bar (or under
 * Expo Go's own floating tools button while testing). Screens without a project pill keep
 * the buttons on the title row.
 */
export function TabHeader({ title, subtitle, allowAll = true, showProject = true, right, hideMenu, brand }: TabHeaderProps) {
  const c = useColors();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { gutter, maxWidth } = useLayout();

  const actions = (
    <>
      {right}
      {hideMenu ? null : (
        <IconButton icon={Settings} label={t('settingsAndMore')} size={sizes.headerButton} tone="onHeader" pressedBg="headerDeep" onPress={() => router.push('/more')} />
      )}
    </>
  );

  return (
    <View
      style={{
        paddingTop: insets.top + space.md,
        paddingBottom: space.md,
        backgroundColor: c.header,
        borderBottomWidth: hairline,
        borderBottomColor: c.border,
      }}>
      <View style={{ paddingHorizontal: gutter, gap: space.sm, maxWidth, width: '100%', alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: sizes.headerButton, gap: space.md }}>
          {brand ? <BrandMark size={36} /> : null}
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="heading" weight="semibold" accessibilityRole="header" color="onHeader" numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {title}
            </Txt>
            {subtitle ? (
              <Txt variant="caption" weight="semibold" color="onHeaderMuted" numberOfLines={1}>
                {subtitle}
              </Txt>
            ) : null}
          </View>
          {showProject ? null : actions}
        </View>
        {showProject ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <View style={{ flex: 1, flexDirection: 'row' }}>
              <ProjectPill allowAll={allowAll} style={{ flexShrink: 1 }} />
            </View>
            {actions}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** Header action helper so screens don't repeat the sizing: `<TabHeader right={<HeaderAction icon={UserPlus} label=… onPress=… />} />`. */
export function HeaderAction({ icon, label, onPress }: { icon: typeof Settings; label: string; onPress: () => void }) {
  return <IconButton icon={icon} label={label} size={sizes.headerButton} tone="onHeader" pressedBg="headerDeep" onPress={onPress} />;
}

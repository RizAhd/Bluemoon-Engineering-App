import { router } from 'expo-router';
import { Building2, ChevronDown, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { PickerSheet } from '@/components/ui/form';
import { Txt } from '@/components/ui/Txt';
import { setCurrentProject, useCurrentProjectId, useProjects } from '@/hooks/data';
import { useT } from '@/i18n';
import { motion, radius, space, useColors } from '@/theme';

/** Blue top band for the tab screens: title, optional subtitle, current-project pill. */
export function TabHeader({
  title,
  subtitle,
  allowAll = true,
  showProject = true,
}: {
  title: string;
  subtitle?: string;
  allowAll?: boolean;
  showProject?: boolean;
}) {
  const c = useColors();
  const t = useT();
  const insets = useSafeAreaInsets();
  const projects = useProjects();
  const current = useCurrentProjectId();
  const [open, setOpen] = useState(false);
  const name = projects.find((p) => p.id === current)?.name ?? t('allProjects');

  return (
    <View
      style={{
        paddingTop: insets.top + space.md,
        paddingHorizontal: space.lg,
        paddingBottom: space.lg,
        backgroundColor: c.header,
        borderBottomLeftRadius: radius.xl,
        borderBottomRightRadius: radius.xl,
        gap: space.sm,
        marginBottom: space.lg,
      }}>
      {subtitle ? (
        <Txt variant="caption" weight="semibold" style={{ color: c.onHeaderMuted }}>
          {subtitle}
        </Txt>
      ) : null}
      <Txt variant="heading" weight="bold" accessibilityRole="header" style={{ color: c.onHeader }}>
        {title}
      </Txt>
      {showProject ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('chooseProject')}: ${name}`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          gap: space.sm,
          minHeight: 44,
          maxWidth: '100%',
          paddingHorizontal: space.md,
          borderRadius: radius.pill,
          backgroundColor: c.headerSoft,
          opacity: pressed ? 0.75 : 1,
          transform: [{ scale: pressed ? motion.pressScale : 1 }],
        })}>
        <Building2 size={18} color={c.onHeader} />
        <Txt weight="semibold" numberOfLines={1} style={{ flexShrink: 1, color: c.onHeader }}>
          {name}
        </Txt>
        <ChevronDown size={18} color={c.onHeader} />
      </Pressable>
      ) : null}

      <PickerSheet
        visible={open}
        title={t('chooseProject')}
        value={current ?? (allowAll ? '__all' : null)}
        items={[
          ...(allowAll ? [{ id: '__all', title: t('allProjects') }] : []),
          ...projects.map((p) => ({
            id: p.id,
            title: p.name,
            subtitle: [p.location, t(`status_${p.status}`)].filter(Boolean).join(' · '),
          })),
        ]}
        onClose={() => setOpen(false)}
        onPick={(id) => {
          setCurrentProject(id === '__all' ? null : id);
          setOpen(false);
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
    </View>
  );
}

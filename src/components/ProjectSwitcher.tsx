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
import { radius, space, useColors } from '@/theme';

/** Top bar for the tab screens: page title plus the current-project pill. */
export function TabHeader({ title, allowAll = true }: { title: string; allowAll?: boolean }) {
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
        paddingTop: insets.top + space.sm,
        paddingHorizontal: space.lg,
        paddingBottom: space.md,
        backgroundColor: c.bg,
        gap: space.sm,
      }}>
      <Txt variant="heading" weight="bold" accessibilityRole="header">
        {title}
      </Txt>
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
          backgroundColor: pressed ? c.muted : c.card,
          borderWidth: 1,
          borderColor: c.borderStrong,
        })}>
        <Building2 size={18} color={c.primary} />
        <Txt weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
          {name}
        </Txt>
        <ChevronDown size={18} color={c.textMuted} />
      </Pressable>

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

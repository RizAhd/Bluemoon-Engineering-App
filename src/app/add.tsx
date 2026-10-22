import { router, type Href } from 'expo-router';
import type { LucideIcon } from 'lucide-react-native';
import { ArrowUpFromLine, ClipboardCheck, FileText, HandCoins, NotebookPen, Receipt, UserPlus } from 'lucide-react-native';
import { Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SheetHeader } from '@/components/ui/form';
import { ListCard, ListRow } from '@/components/ui/layout';
import { useCurrentProjectId, useProjects } from '@/hooks/data';
import { useT, type TKey } from '@/i18n';
import { hairline, radius, space, useColors, useLayout, useMotion } from '@/theme';

/** `pid` is the project being worked on, or null for "All projects". */
const items = (pid: string | null): { icon: LucideIcon; label: TKey; href: Href; primary?: boolean }[] => [
  { icon: Receipt, label: 'newExpense', href: '/expense/form', primary: true },
  { icon: ClipboardCheck, label: 'todaysWork', href: '/wage/today' },
  { icon: HandCoins, label: 'giveAdvance', href: '/wage/form?kind=advance' },
  { icon: ArrowUpFromLine, label: 'issueTool', href: '/tool/move?kind=issue' },
  { icon: NotebookPen, label: 'newNote', href: '/note/form' },
  // With a project chosen a new worker goes onto it with a rate (as on the Workers tab); a bare worker would be hidden from its roster.
  { icon: UserPlus, label: 'newWorker', href: pid ? `/worker/assign?projectId=${pid}` : '/worker/form' },
  { icon: FileText, label: 'newEstimate', href: '/estimate/form' },
];

/** Quick-add sheet: a list of the things a supervisor records most, opened by the FAB. */
export default function AddSheet() {
  const c = useColors();
  const t = useT();
  const insets = useSafeAreaInsets();
  const m = useMotion();
  const { gutter, column, wide } = useLayout();
  const pid = useCurrentProjectId();
  const projects = useProjects();
  const projectName = projects.find((p) => p.id === pid)?.name ?? t('allProjects');

  return (
    <View style={{ flex: 1, justifyContent: 'flex-end' }}>
      <Animated.View entering={FadeIn.duration(m.reduced ? m.enter : 150)} style={{ position: 'absolute', inset: 0, backgroundColor: c.overlay }}>
        <Pressable style={{ flex: 1 }} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('close')} />
      </Animated.View>
      {/* At most 640 wide and centred on tablets; never taller than 90 % of the window (landscape): the list scrolls. */}
      <Animated.View
        entering={m.reduced ? FadeIn.duration(m.enter) : SlideInDown.duration(220)}
        style={[
          column,
          {
            maxHeight: '90%',
            backgroundColor: c.surface3,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            borderTopWidth: hairline,
            borderLeftWidth: wide ? hairline : 0,
            borderRightWidth: wide ? hairline : 0,
            borderColor: c.border,
            paddingBottom: insets.bottom + space.lg,
          },
        ]}>
        <SheetHeader title={t('whatToAdd')} onClose={() => router.back()} caption={`${t('project')}: ${projectName}`} />
        <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: space.sm }}>
          <ListCard inset>
            {items(pid).map((it) => (
              <ListRow key={it.label} icon={it.icon} iconTone={it.primary ? 'primary' : undefined} title={t(it.label)} onPress={() => router.replace(it.href)} />
            ))}
          </ListCard>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

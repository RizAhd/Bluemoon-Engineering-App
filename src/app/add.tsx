import { router, type Href } from 'expo-router';
import type { LucideIcon } from 'lucide-react-native';
import { ArrowUpFromLine, ClipboardCheck, HandCoins, NotebookPen, Receipt, UserPlus } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SheetHeader } from '@/components/ui/form';
import { ListCard, ListRow } from '@/components/ui/layout';
import { useCurrentProjectId, useProjects } from '@/hooks/data';
import { useT, type TKey } from '@/i18n';
import { hairline, radius, space, useColors, useLayout, useMotion } from '@/theme';

const ITEMS: { icon: LucideIcon; label: TKey; href: Href; primary?: boolean }[] = [
  { icon: Receipt, label: 'newExpense', href: '/expense/form', primary: true },
  { icon: ClipboardCheck, label: 'todaysWork', href: '/wage/today' },
  { icon: HandCoins, label: 'giveAdvance', href: '/wage/form?kind=advance' },
  { icon: ArrowUpFromLine, label: 'issueTool', href: '/tool/move?kind=issue' },
  { icon: NotebookPen, label: 'newNote', href: '/note/form' },
  { icon: UserPlus, label: 'newWorker', href: '/worker/form' },
];

/** Quick-add sheet: a list of the things a supervisor records most, opened by the FAB. */
export default function AddSheet() {
  const c = useColors();
  const t = useT();
  const insets = useSafeAreaInsets();
  const m = useMotion();
  const { gutter, maxWidth } = useLayout();
  const pid = useCurrentProjectId();
  const projects = useProjects();
  const projectName = projects.find((p) => p.id === pid)?.name ?? t('allProjects');

  return (
    <View style={{ flex: 1, justifyContent: 'flex-end' }}>
      <Animated.View entering={FadeIn.duration(m.reduced ? m.enter : 150)} style={{ position: 'absolute', inset: 0, backgroundColor: c.overlay }}>
        <Pressable style={{ flex: 1 }} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('close')} />
      </Animated.View>
      <Animated.View
        entering={m.reduced ? FadeIn.duration(m.enter) : SlideInDown.duration(220)}
        style={{
          backgroundColor: c.surface3,
          borderTopLeftRadius: radius.xl,
          borderTopRightRadius: radius.xl,
          borderTopWidth: hairline,
          borderTopColor: c.border,
          paddingBottom: insets.bottom + space.lg,
        }}>
        <View style={{ maxWidth, width: '100%', alignSelf: 'center' }}>
          <SheetHeader title={t('whatToAdd')} onClose={() => router.back()} caption={`${t('project')}: ${projectName}`} />
          <View style={{ paddingHorizontal: gutter, paddingTop: space.sm }}>
            <ListCard inset>
              {ITEMS.map((it) => (
                <ListRow key={it.label} icon={it.icon} iconTone={it.primary ? 'primary' : undefined} title={t(it.label)} onPress={() => router.replace(it.href)} />
              ))}
            </ListCard>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

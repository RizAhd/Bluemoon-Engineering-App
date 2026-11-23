import { router, type Href } from 'expo-router';
import type { LucideIcon } from 'lucide-react-native';
import { ArrowUpFromLine, Banknote, Building2, ClipboardCheck, FileText, HandCoins, NotebookPen, Receipt, UserPlus } from 'lucide-react-native';
import { Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SheetHeader } from '@/components/ui/form';
import { Txt } from '@/components/ui/Txt';
import { useCurrentProjectId, useProjects } from '@/hooks/data';
import { useT, type TKey } from '@/i18n';
import { radius, space, useColors, useLayout, useMotion } from '@/theme';

interface Item {
  icon: LucideIcon;
  label: TKey;
  hint: TKey;
  href: Href;
  primary?: boolean;
}

/** `pid` is the project being worked on, or null for "All projects". */
const items = (pid: string | null): Item[] => [
  { icon: Receipt, label: 'newExpense', hint: 'addHintExpense', href: '/expense/form', primary: true },
  { icon: ClipboardCheck, label: 'todaysWork', hint: 'addHintWork', href: '/wage/today' },
  // money from the client belongs to one project: offered only when one is chosen
  ...(pid ? [{ icon: Banknote, label: 'recordPayment', hint: 'addHintPayment', href: `/project/receipt?projectId=${pid}` } as Item] : []),
  { icon: ArrowUpFromLine, label: 'issueTool', hint: 'addHintTool', href: '/tool/move?kind=issue' },
  { icon: NotebookPen, label: 'newNote', hint: 'addHintNote', href: '/note/form' },
  { icon: Building2, label: 'newProject', hint: 'addHintProject', href: '/project/form' },
  { icon: HandCoins, label: 'giveAdvance', hint: 'addHintAdvance', href: '/wage/form?kind=advance' },
  // With a project chosen a new worker goes onto it with a rate (as on the Workers tab); a bare worker would be hidden from its roster.
  { icon: UserPlus, label: 'newWorker', hint: 'addHintWorker', href: pid ? `/worker/assign?projectId=${pid}` : '/worker/form' },
  { icon: FileText, label: 'newEstimate', hint: 'addHintEstimate', href: '/estimate/form' },
];

/** Quick-add sheet (Blueprint): a two-column grid of tiles for the things a supervisor records most, opened by the "+". */
export default function AddSheet() {
  const c = useColors();
  const t = useT();
  const insets = useSafeAreaInsets();
  const m = useMotion();
  const { column, width } = useLayout();
  const pid = useCurrentProjectId();
  const projects = useProjects();
  const projectName = projects.find((p) => p.id === pid)?.name ?? t('allProjects');
  const list = items(pid);
  // two tiles a row; on a very narrow window (or the last odd tile) one tile takes the whole row
  const one = width < 300;

  return (
    <View style={{ flex: 1, justifyContent: 'flex-end', paddingHorizontal: space.sm }}>
      <Animated.View entering={FadeIn.duration(m.reduced ? m.enter : 150)} style={{ position: 'absolute', inset: 0, backgroundColor: c.overlay }}>
        <Pressable style={{ flex: 1 }} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('close')} />
      </Animated.View>
      {/* A floating rounded sheet, at most 640 wide and centred on tablets; never taller than 90 % of the window: the grid scrolls. */}
      <Animated.View
        entering={m.reduced ? FadeIn.duration(m.enter) : SlideInDown.duration(220)}
        style={[
          column,
          {
            maxHeight: '90%',
            marginBottom: Math.max(insets.bottom, space.sm),
            backgroundColor: c.surface3,
            borderRadius: radius.xl,
            paddingBottom: space.lg,
          },
        ]}>
        <SheetHeader title={t('whatToAdd')} onClose={() => router.back()} caption={`${t('project')}: ${projectName}`} />
        <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.sm, flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
          {list.map((it, i) => (
            <Tile key={it.label} item={it} full={one || (i === list.length - 1 && list.length % 2 === 1)} label={t(it.label)} hint={t(it.hint)} />
          ))}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

/** One tile: an icon square, the name in bold and a one-line hint. The first (New expense) is blue. */
function Tile({ item, label, hint, full }: { item: Item; label: string; hint: string; full: boolean }) {
  const c = useColors();
  const Icon = item.icon;
  const on = !!item.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => router.replace(item.href)}
      style={({ pressed }) => ({
        // two a row: half the row less half the gap
        width: full ? '100%' : '47.5%',
        flexGrow: 1,
        minHeight: 132,
        padding: space.lg,
        gap: space.xs,
        borderRadius: radius.lg,
        backgroundColor: on ? (pressed ? c.fillPressed : c.fill) : pressed ? c.muted : c.surface2,
      })}>
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: radius.md,
          marginBottom: space.sm,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: on ? c.primaryPressed : c.primarySoft,
        }}>
        <Icon size={22} color={on ? c.onFill : c.primary} strokeWidth={1.9} />
      </View>
      <Txt variant="bodyLg" weight="bold" numberOfLines={2} style={{ color: on ? c.onFill : c.text }}>
        {label}
      </Txt>
      <Txt variant="caption" numberOfLines={2} style={{ color: on ? c.onFill : c.textMuted }}>
        {hint}
      </Txt>
    </Pressable>
  );
}

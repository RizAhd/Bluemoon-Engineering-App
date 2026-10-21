import { router, type Href } from 'expo-router';
import type { LucideIcon } from 'lucide-react-native';
import { FileDown, Hammer, HardHat, NotebookPen, Receipt, X } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/ui/Button';
import { Txt } from '@/components/ui/Txt';
import { useT, type TKey } from '@/i18n';
import { radius, space, useColors } from '@/theme';

const ITEMS: { icon: LucideIcon; label: TKey; href: Href; tone: 'primary' | 'slate' }[] = [
  { icon: Receipt, label: 'newExpense', href: '/expense/form', tone: 'primary' },
  { icon: HardHat, label: 'recordWork', href: '/wage/form?kind=work', tone: 'slate' },
  { icon: HardHat, label: 'giveAdvance', href: '/wage/form?kind=advance', tone: 'slate' },
  { icon: Hammer, label: 'issueTool', href: '/tool/move?kind=issue', tone: 'slate' },
  { icon: NotebookPen, label: 'newNote', href: '/note/form', tone: 'slate' },
  { icon: FileDown, label: 'importPdf', href: '/import', tone: 'slate' },
];

export default function AddSheet() {
  const c = useColors();
  const t = useT();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, justifyContent: 'flex-end' }}>
      <Animated.View entering={FadeIn.duration(150)} style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(15,23,42,0.5)' }}>
        <Pressable style={{ flex: 1 }} onPress={() => router.back()} accessibilityLabel={t('close')} />
      </Animated.View>
      <Animated.View
        entering={SlideInDown.duration(220)}
        style={{
          backgroundColor: c.bg,
          borderTopLeftRadius: radius.lg + 8,
          borderTopRightRadius: radius.lg + 8,
          padding: space.lg,
          paddingBottom: insets.bottom + space.lg,
          gap: space.md,
        }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Txt variant="title" weight="bold" style={{ flex: 1 }}>
            {t('whatToAdd')}
          </Txt>
          <IconButton icon={X} label={t('close')} onPress={() => router.back()} />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
          {ITEMS.map((it) => (
            <Pressable
              key={it.label}
              accessibilityRole="button"
              accessibilityLabel={t(it.label)}
              onPress={() => router.replace(it.href)}
              style={({ pressed }) => ({
                flexBasis: '47%',
                flexGrow: 1,
                minHeight: 104,
                borderRadius: radius.lg,
                borderWidth: 1.5,
                borderColor: it.tone === 'primary' ? c.primary : c.border,
                backgroundColor: pressed ? c.muted : it.tone === 'primary' ? c.primarySoft : c.card,
                padding: space.md,
                justifyContent: 'space-between',
                gap: space.sm,
              })}>
              <it.icon size={28} color={it.tone === 'primary' ? c.primary : c.slate} strokeWidth={2} />
              <Txt weight="semibold">{t(it.label)}</Txt>
            </Pressable>
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

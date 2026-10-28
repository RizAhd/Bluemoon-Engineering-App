/**
 * The bottom sheet behind a "… PDF" row: the letterhead tick, the language of the printed labels (when
 * the PDF can be read by someone who does not speak the app's language, as a worker's statement can)
 * and the Share button. The same shape as the estimate's PDF sheet. The choices are the screen's
 * remembered settings; the Share sheet's PDF row uses the same ones without opening this.
 */
import { Share2 } from 'lucide-react-native';
import { Pressable, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { BottomSheet, Checkbox, Chips, SheetHeader } from '@/components/ui/form';
import { Txt } from '@/components/ui/Txt';
import { LANG_NAMES, useT, type Lang } from '@/i18n';
import { radius, space, touch, useColors } from '@/theme';

/** One tick box with a label and a one-line hint. The whole row is the tap target (48 dp+). */
function TickOption({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (next: boolean) => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={`${label}. ${hint}`}
      onPress={() => onChange(!checked)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.xs,
        minHeight: touch,
        borderRadius: radius.md,
        backgroundColor: pressed ? c.muted : 'transparent',
      })}>
      {/* The row carries the role and the tap; the box is only the picture of the state. */}
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Checkbox checked={checked} onChange={onChange} label={label} />
      </View>
      <View style={{ flex: 1, paddingVertical: space.xs }}>
        <Txt weight="semibold">{label}</Txt>
        <Txt variant="caption" color="textMuted">
          {hint}
        </Txt>
      </View>
    </Pressable>
  );
}

export interface PdfOptionsSheetProps {
  visible: boolean;
  title: string;
  /** While the PDF is being made the sheet stays: closing it would hide the only sign that something is happening. */
  busy: boolean;
  letterhead: boolean;
  onLetterhead: (on: boolean) => void;
  /** The language of the labels on the PDF; left out when the PDF is always in the app's language. */
  lang?: { label: string; value: Lang; onChange: (lang: Lang) => void };
  onShare: () => void;
  onClose: () => void;
}

export function PdfOptionsSheet({ visible, title, busy, letterhead, onLetterhead, lang, onShare, onClose }: PdfOptionsSheetProps) {
  const t = useT();
  const close = busy ? () => undefined : onClose;
  return (
    <BottomSheet visible={visible} onClose={close}>
      <SheetHeader title={title} onClose={close} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.lg }}>
        <TickOption label={t('letterheadOption')} hint={t('estimateLetterheadHint')} checked={letterhead} onChange={onLetterhead} />
        {lang ? <Chips<Lang> label={lang.label} value={lang.value} onChange={lang.onChange} options={(Object.keys(LANG_NAMES) as Lang[]).map((l) => ({ value: l, label: LANG_NAMES[l] }))} /> : null}
        <Button icon={Share2} label={busy ? t('exporting') : t('shareNow')} loading={busy} onPress={onShare} full />
      </ScrollView>
    </BottomSheet>
  );
}

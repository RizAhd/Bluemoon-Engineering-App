import type { LucideIcon } from 'lucide-react-native';
import { CheckCircle2, Pencil, Send, XCircle } from 'lucide-react-native';
import { View, type TextInputProps } from 'react-native';

import { Badge, type BadgeTone } from '@/components/ui/feedback';
import { Chips, Field, type ChipOption } from '@/components/ui/form';
import type { EstimateStatus } from '@/db/types';
import { useT } from '@/i18n';
import { space } from '@/theme';

/** Colour plus icon plus a word: draft is neutral, sent is waiting (amber), accepted is good, declined is bad. */
const STATUS: Record<EstimateStatus, { tone: BadgeTone; icon: LucideIcon }> = {
  draft: { tone: 'slate', icon: Pencil },
  sent: { tone: 'warning', icon: Send },
  accepted: { tone: 'success', icon: CheckCircle2 },
  declined: { tone: 'danger', icon: XCircle },
};

/** The status of an estimate as a badge (list rows, the hub, the import preview, the project's linked-estimate row). */
export function EstimateStatusBadge({ status }: { status: EstimateStatus }) {
  const t = useT();
  const s = STATUS[status] ?? STATUS.draft;
  return <Badge tone={s.tone} icon={s.icon} label={t(`estStatus_${status}`)} />;
}

export interface PresetFieldProps {
  /** Label of the chip group ("Valid for", "Unit", "Stage"). */
  label: string;
  /** Label of the free text field under the chips (what a screen reader says; drawn too unless `hideFieldLabel`). */
  fieldLabel: string;
  /** The chip group label already says it: draw the field without its own label. */
  hideFieldLabel?: boolean;
  presets: ChipOption<string>[];
  value: string;
  onChangeText: (s: string) => void;
  /** Chip labels are symbols or fixed English text (m², Advance): draw them in the Latin font. */
  numeric?: boolean;
  error?: string | null;
  hint?: string;
  keyboardType?: TextInputProps['keyboardType'];
  returnKeyType?: TextInputProps['returnKeyType'];
  placeholder?: string;
  /** Leading icon in the text box, like the other fields. */
  icon?: LucideIcon;
}

/**
 * A value with a few usual choices as chips and a text field for anything else. The chip that equals
 * the text is shown selected; tapping a chip fills the field. Used for the validity days, the line
 * unit and the payment stage name.
 */
export function PresetField({ label, fieldLabel, hideFieldLabel, presets, value, onChangeText, numeric, error, hint, keyboardType, returnKeyType, placeholder, icon }: PresetFieldProps) {
  const trimmed = value.trim();
  const selected = presets.find((p) => p.value === trimmed)?.value ?? null;
  return (
    <View style={{ gap: space.md }}>
      <Chips label={label} options={presets} value={selected} onChange={onChangeText} numeric={numeric} />
      <Field label={fieldLabel} hideLabel={hideFieldLabel} value={value} onChangeText={onChangeText} error={error} hint={hint} keyboardType={keyboardType} returnKeyType={returnKeyType} placeholder={placeholder} icon={icon} />
    </View>
  );
}

import { Alert } from 'react-native';

import type { TKey, useT } from '@/i18n';
import { formatLKR } from '@/lib/money';

export interface PayLine {
  name: string;
  cents: number;
}

/**
 * The one confirmation before money is recorded: every name with its amount, and the total on the confirm
 * button. Nothing is saved until the button is pressed. Used by the wage sheet, the work form and the balance card.
 */
export function confirmPayments(t: ReturnType<typeof useT>, lines: PayLine[], title: TKey, onConfirm: () => void) {
  const total = lines.reduce((s, l) => s + l.cents, 0);
  Alert.alert(t(title), lines.map((l) => `${l.name} — ${formatLKR(l.cents)}`).join('\n'), [
    { text: t('cancel'), style: 'cancel' },
    { text: `${t(title)} · ${formatLKR(total)}`, onPress: onConfirm },
  ]);
}

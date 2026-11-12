/**
 * Money received from the client against the project value, in whole cents. One place does the sums so the project
 * page, the list and the PDF can never disagree.
 *
 *   value 1 crore (1,000,000,000 cents), paid 10 lakh then 20 lakh -> received 30 lakh, still to receive 70 lakh.
 */
export interface ReceiptSummary {
  /** The project value, or null when none was entered. */
  value: number | null;
  received: number;
  /** Value minus received, never below 0. null without a value. */
  left: number | null;
  /** How far past the value the payments went (0 when not over). */
  over: number;
  /** 0..100 whole percent of the value received (capped at 100; 0 without a value). */
  percent: number;
}

export function receiptSummary(contractCents: number | null | undefined, receivedCents: number): ReceiptSummary {
  const received = Math.max(0, Math.trunc(receivedCents || 0));
  const value = contractCents != null && contractCents > 0 ? contractCents : null;
  if (value == null) return { value: null, received, left: null, over: 0, percent: 0 };
  // integer maths: no float rounding on lakhs and crores
  const percent = Math.min(100, Math.floor((received * 100) / value));
  return { value, received, left: Math.max(0, value - received), over: Math.max(0, received - value), percent };
}

import { formatQty } from './estimate';

/** "7", "2.5 bags": a count in thousandths, with its unit when it has one. */
export function qtyText(milli: number, unit?: string | null): string {
  return `${formatQty(Math.max(0, milli))}${unit ? ` ${unit}` : ''}`;
}

/** A tool kept as one piece (the way every tool was before quantities): it looks and reads exactly as it always did. */
export function isSinglePiece(s: { quantity_milli: number; is_material: number }): boolean {
  return s.quantity_milli === 1000 && !s.is_material;
}

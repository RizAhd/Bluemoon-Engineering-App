/**
 * A person's name without a leading title, for initials: "Mr. K. Silva" → "K. Silva" (initials "KS", not "MK").
 * The name is still printed in full everywhere else.
 */
const TITLE = /^(mr|mrs|ms|miss|dr|rev|eng|prof|hon)\.?\s+/i;

export function withoutTitle(name: string): string {
  const trimmed = name.trim();
  const rest = trimmed.replace(TITLE, '');
  return rest || trimmed;
}

/** A Sri Lankan phone number as people write it: "0771234567" → "077 123 4567", "+94771234567" → "+94 77 123 4567". Anything else is left as typed. */
export function formatPhone(raw: string): string {
  const d = raw.replace(/[\s-]/g, '');
  if (/^0\d{9}$/.test(d)) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  if (/^\+94\d{9}$/.test(d)) return `+94 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  return raw;
}

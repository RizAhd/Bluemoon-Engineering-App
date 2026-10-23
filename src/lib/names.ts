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

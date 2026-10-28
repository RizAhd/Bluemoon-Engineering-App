/**
 * The one matching rule behind every search box (`src/hooks/search.ts` adds the box itself).
 *
 * `matchesQuery`: case-insensitive; every typed word must appear in some field, in any order; a word made of digits
 * also matches amounts with their grouping commas ignored ("1250" finds "Rs 1,250.00"); Sinhala and Tamil are matched
 * as plain substrings. `likeQuery` is the same rule as SQL, for the lists the database pages or filters (Expenses,
 * Workers): one `LIKE ? ESCAPE '\'` group per word, with `%` and `_` in the word made literal.
 */
import { parseCents } from '@/lib/money';

export type SearchValue = string | number | null | undefined;

/** The words typed, lower-cased, in the order typed; none when only spaces were typed. */
export function searchWords(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

const NUMBER = /^[\d,]+(\.\d*)?$/;

/** A word that reads as a number, with its grouping commas removed ("1,250" -> "1250"); null for anything else. */
function plainDigits(word: string): string | null {
  return NUMBER.test(word) ? word.replace(/,/g, '') : null;
}

/** True when every word of `query` appears in at least one of `fields` (empty query = everything matches). */
export function matchesQuery(fields: readonly SearchValue[], query: string): boolean {
  const words = searchWords(query);
  if (!words.length) return true;
  const texts: string[] = [];
  for (const f of fields) if (f != null && f !== '') texts.push(String(f).toLowerCase());
  // the same fields with grouping commas dropped, so "1250" finds "1,250" and "Rs 1,250.00"
  const plain = texts.map((s) => s.replace(/,/g, ''));
  return words.every((w) => {
    const digits = plainDigits(w);
    return texts.some((s, i) => s.includes(w) || (digits !== null && plain[i].includes(digits)));
  });
}

// ---------------------------------------------------------------- SQL

/** The LIKE operator with a backslash as its escape, as `likePattern` writes it. */
export const LIKE = "LIKE ? ESCAPE '\\'";

/** `%word%` with the LIKE wildcards in the word made literal, so "100%" finds "100%" and "_" finds an underscore. */
export function likePattern(word: string): string {
  return `%${word.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

export interface LikeWord {
  /** The word as typed, lower-cased. */
  word: string;
  /** Without columns: the bare fragment `LIKE ? ESCAPE '\'`. With columns: `(c1 LIKE ? ESCAPE '\' OR c2 LIKE ? ESCAPE '\' …)`. */
  sql: string;
  /** The bound `%word%` pattern: once for the bare fragment, once per column (in the order of `sql`) with columns. */
  args: string[];
  /** The word as an exact amount in cents when it reads as one ("1,250" = 125000), else null. */
  cents: number | null;
}

/**
 * The typed words as SQL: one entry per word, to be ANDed so every word must match.
 * `likeQuery('a_b')` gives the bare fragment to put after a column; `likeQuery('a_b', ['e.paid_to', 'e.note'])` gives the
 * whole OR group over those columns. Nothing typed is pasted into the SQL: it only ever travels as a bound argument.
 */
export function likeQuery(query: string, columns?: readonly string[]): LikeWord[] {
  return searchWords(query).map((word) => {
    const pattern = likePattern(word);
    const cents = parseCents(word);
    if (!columns) return { word, sql: LIKE, args: [pattern], cents };
    return {
      word,
      sql: columns.length ? `(${columns.map((c) => `${c} ${LIKE}`).join(' OR ')})` : '0',
      args: columns.map(() => pattern),
      cents,
    };
  });
}

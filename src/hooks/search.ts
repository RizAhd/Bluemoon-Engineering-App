/**
 * The search box at the top of every list.
 *
 *   const search = useListSearch(rows, (r) => [r.name, r.client, formatLKR(r.amount_cents)]);
 *   <CardList header={<>{search.node}…</>} sections={…search.filtered…} empty={search.noResults ?? <EmptyState … />} />
 *
 * The matching rule (`matchesQuery`, and `likeQuery` for the lists the database searches) lives in `src/lib/search.ts`
 * and is re-exported here. The query is plain state: it is never remembered, and it applies to nothing while the box
 * is hidden (`shown: false`), so a list can never be filtered invisibly.
 */
import { createElement, useMemo, useState, type ReactElement } from 'react';

import { NoResults } from '@/components/ui/feedback';
import { SearchField } from '@/components/ui/form';
import { useT } from '@/i18n';
import { matchesQuery, type SearchValue } from '@/lib/search';

export { LIKE, likePattern, likeQuery, matchesQuery, searchWords, type LikeWord, type SearchValue } from '@/lib/search';

export interface SearchBoxOptions {
  placeholder?: string;
  /** False hides the box; the query then applies to nothing. Default true. */
  shown?: boolean;
}

export interface SearchBox {
  /** The trimmed search text, or '' while the box is hidden. */
  query: string;
  setQuery: (s: string) => void;
  /** The compact SearchField, or null while hidden. Put it first in the list's header. */
  node: ReactElement | null;
  /** The "No results for …" block with its Clear link while a search is on, else null: use it as the list's empty state. */
  noResults: ReactElement | null;
}

/** A compact search box as plain state (never remembered): for lists whose rows the database searches (Expenses, Workers). */
export function useSearchBox(opts: SearchBoxOptions = {}): SearchBox {
  const t = useT();
  const [text, setText] = useState('');
  const shown = opts.shown ?? true;
  const query = shown ? text.trim() : '';
  const node = shown ? createElement(SearchField, { compact: true, value: text, onChangeText: setText, placeholder: opts.placeholder ?? t('search') }) : null;
  const noResults = query ? createElement(NoResults, { query, onClear: () => setText('') }) : null;
  return { query, setQuery: setText, node, noResults };
}

/** The search box plus its in-memory filter over `rows`: `fields` names what a row can be found by. */
export function useListSearch<T>(rows: T[], fields: (r: T) => SearchValue[], opts: SearchBoxOptions = {}): SearchBox & { filtered: T[] } {
  const box = useSearchBox(opts);
  const { query } = box;
  const filtered = useMemo(() => (query ? rows.filter((r) => matchesQuery(fields(r), query)) : rows), [rows, fields, query]);
  return { ...box, filtered };
}

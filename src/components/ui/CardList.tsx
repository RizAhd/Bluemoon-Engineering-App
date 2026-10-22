/**
 * A virtualised list of rows drawn as rounded cards (the look of ListCard), for every list that can grow:
 * expenses, projects, workers, tools, estimates, histories, the error log.
 *
 *   <CardList
 *     header={<View style={{ gap: space.md }}>…controls, tiles…</View>}
 *     sections={[{ key: 'active', label: 'ACTIVE (2)', value: 'Rs 4,000', rows }]}
 *     keyOf={(r) => r.id}
 *     renderRow={(r) => <ListRow … />}
 *     empty={<EmptyState … />}
 *   />
 *
 * One FlatList holds the header, an eyebrow label (or any title node) per section, every row as one slice
 * of its section's card, and the footer. Only the rows near the screen are mounted (listTuning), so a list of
 * 2,000 expenses scrolls like a list of 20. Rows are memoised; `renderRow` gets the row only.
 *
 * `stickyFooter` is the screen's footer (a primary button): sticky under the list, or at the end of the list
 * when the window is under 480 dp tall.
 */
import { memo, useMemo, type ReactElement, type ReactNode } from 'react';
import { FlatList, Platform, View, type FlatListProps } from 'react-native';

import { hairline, listTuning, radius, sizes, space, useColors, useLayout } from '@/theme';

import { GroupLabel, StickyFooter } from './layout';

export interface CardSection<T> {
  key: string;
  /** Eyebrow label above the card (GroupLabel), with an optional right-aligned total. */
  label?: string;
  value?: string;
  /** Any node above the card instead of a label (a SectionTitle, chips). */
  title?: ReactNode;
  rows: T[];
  /** Extra rows after the data rows, in the same card (a "See all" row, a collapsible group header). */
  after?: { key: string; node: ReactNode }[];
  /** Rows before the data rows, in the same card. */
  before?: { key: string; node: ReactNode }[];
}

type Item<T> =
  | { kind: 'title'; key: string; node: ReactNode; top: boolean }
  | { kind: 'label'; key: string; label: string; value?: string; top: boolean }
  | { kind: 'row'; key: string; row: T; first: boolean; last: boolean; top: boolean }
  | { kind: 'node'; key: string; node: ReactNode; first: boolean; last: boolean; top: boolean };

export interface CardListProps<T> {
  sections: CardSection<T>[];
  keyOf: (row: T) => string;
  renderRow: (row: T) => ReactElement;
  header?: ReactNode;
  /** Under the last card (a "Show all" button). */
  footer?: ReactNode;
  /** Shown instead of the cards when no section has a row. */
  empty?: ReactNode;
  /** Divider inset like ListCard: `true` = 68 (rows with icons), a number, default 16; `false` hides dividers. */
  inset?: boolean | number;
  /** Space between the header and the groups and between groups. Default 12. */
  gap?: number;
  /** Scroll padding at the bottom. Default 96 (room for the FAB), 24 with a sticky footer. */
  paddingBottom?: number;
  /** The screen's footer: sticky under the list, or the list's last item on a short window. */
  stickyFooter?: ReactNode;
  testID?: string;
  listProps?: Omit<FlatListProps<Item<T>>, 'data' | 'renderItem' | 'keyExtractor'>;
}

export function flatten<T>(sections: CardSection<T>[], keyOf: (row: T) => string, hasHeader: boolean): Item<T>[] {
  const out: Item<T>[] = [];
  for (const s of sections) {
    const before = s.before ?? [];
    const after = s.after ?? [];
    const count = before.length + s.rows.length + after.length;
    if (!count) continue;
    let top = hasHeader || out.length > 0;
    if (s.title != null) {
      out.push({ kind: 'title', key: `${s.key}:title`, node: s.title, top });
      top = false;
    } else if (s.label != null) {
      out.push({ kind: 'label', key: `${s.key}:label`, label: s.label, value: s.value, top });
      top = false;
    }
    let i = 0;
    const slot = () => {
      const first = i === 0;
      const last = i === count - 1;
      const t = first && top;
      i += 1;
      return { first, last, top: t };
    };
    for (const b of before) out.push({ kind: 'node', key: `${s.key}:b:${b.key}`, node: b.node, ...slot() });
    for (const row of s.rows) out.push({ kind: 'row', key: `${s.key}:r:${keyOf(row)}`, row, ...slot() });
    for (const a of after) out.push({ kind: 'node', key: `${s.key}:a:${a.key}`, node: a.node, ...slot() });
  }
  return out;
}

const itemKey = (item: { key: string }) => item.key;

export function CardList<T>({ sections, keyOf, renderRow, header, footer, empty, inset, gap = space.md, paddingBottom, stickyFooter, testID, listProps }: CardListProps<T>) {
  const { gutter, column, short } = useLayout();
  const hasHeader = header != null && header !== false;
  const items = useMemo(() => flatten(sections, keyOf, hasHeader), [sections, keyOf, hasHeader]);
  const left = inset === true ? 68 : inset === false ? -1 : typeof inset === 'number' ? inset : space.lg;
  const footerInline = !!stickyFooter && short;
  const bottom = paddingBottom ?? (stickyFooter ? space.xl : sizes.tabScrollBottom);

  const listFooter =
    footer || footerInline ? (
      <View style={{ marginTop: gap, gap: space.sm }}>
        {footer}
        {footerInline ? stickyFooter : null}
      </View>
    ) : null;

  return (
    <>
      <FlatList
        testID={testID}
        data={items}
        keyExtractor={itemKey}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        {...listTuning}
        removeClippedSubviews={Platform.OS === 'android'}
        {...listProps}
        contentContainerStyle={[column, { paddingHorizontal: gutter, paddingTop: space.lg, paddingBottom: bottom }]}
        ListHeaderComponent={hasHeader ? <View>{header}</View> : undefined}
        ListEmptyComponent={empty ? <View style={{ marginTop: hasHeader ? gap : 0 }}>{empty}</View> : undefined}
        ListFooterComponent={listFooter ?? undefined}
        renderItem={({ item }) => <CardItem item={item} renderRow={renderRow} gap={gap} dividerLeft={left} />}
      />
      {stickyFooter && !footerInline ? <StickyFooter>{stickyFooter}</StickyFooter> : null}
    </>
  );
}

function CardItemInner<T>({ item, renderRow, gap, dividerLeft }: { item: Item<T>; renderRow: (row: T) => ReactElement; gap: number; dividerLeft: number }) {
  const c = useColors();
  if (item.kind === 'title') return <View style={{ marginTop: item.top ? gap : 0, marginBottom: space.sm }}>{item.node}</View>;
  if (item.kind === 'label')
    return (
      <View style={{ marginTop: item.top ? gap : 0, marginBottom: space.sm }}>
        <GroupLabel label={item.label} value={item.value} />
      </View>
    );
  const { first, last } = item;
  return (
    <View
      style={{
        marginTop: item.top ? gap : 0,
        backgroundColor: c.card,
        borderColor: c.border,
        borderLeftWidth: hairline,
        borderRightWidth: hairline,
        borderTopWidth: first ? hairline : 0,
        borderBottomWidth: last ? hairline : 0,
        borderTopLeftRadius: first ? radius.lg : 0,
        borderTopRightRadius: first ? radius.lg : 0,
        borderBottomLeftRadius: last ? radius.lg : 0,
        borderBottomRightRadius: last ? radius.lg : 0,
        overflow: 'hidden',
      }}>
      {!first && dividerLeft >= 0 ? <View style={{ height: hairline, backgroundColor: c.border, marginLeft: dividerLeft }} /> : null}
      {item.kind === 'row' ? renderRow(item.row) : item.node}
    </View>
  );
}

const CardItem = memo(CardItemInner) as typeof CardItemInner;

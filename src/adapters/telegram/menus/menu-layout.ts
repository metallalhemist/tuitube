export type MenuLayoutItem = {
  label: string;
};

export const TWO_COLUMN_LABEL_MAX_LENGTH = 18;

export function layoutMenuRows<T extends MenuLayoutItem>(
  items: T[],
  maxTwoColumnLabelLength = TWO_COLUMN_LABEL_MAX_LENGTH,
): T[][] {
  const rows: T[][] = [];
  let pendingShortRow: T[] = [];

  const flushShortRow = () => {
    if (pendingShortRow.length === 0) return;
    rows.push(pendingShortRow);
    pendingShortRow = [];
  };

  for (const item of items) {
    if (item.label.length > maxTwoColumnLabelLength) {
      flushShortRow();
      rows.push([item]);
      continue;
    }

    pendingShortRow.push(item);
    if (pendingShortRow.length === 2) flushShortRow();
  }

  flushShortRow();
  return rows;
}

export interface RowSelection {
  readonly keys: ReadonlySet<string>;
  readonly anchor: string | null;
}

export const EMPTY_ROW_SELECTION: RowSelection = { keys: new Set(), anchor: null };

export function selectRow(
  selection: RowSelection,
  key: string,
  orderedKeys: readonly string[],
  extend: boolean,
): RowSelection {
  const anchorIndex = selection.anchor === null ? -1 : orderedKeys.indexOf(selection.anchor);
  const targetIndex = orderedKeys.indexOf(key);
  const keys = new Set(selection.keys);
  if (extend && anchorIndex !== -1 && targetIndex !== -1) {
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    for (const rangeKey of orderedKeys.slice(start, end + 1)) keys.add(rangeKey);
    return { keys, anchor: selection.anchor };
  }
  if (!keys.delete(key)) keys.add(key);
  return { keys, anchor: key };
}

export function setRowsSelected(
  selection: RowSelection,
  rowKeys: readonly string[],
  selected: boolean,
): RowSelection {
  const keys = new Set(selection.keys);
  for (const key of rowKeys) {
    if (selected) keys.add(key);
    else keys.delete(key);
  }
  return { keys, anchor: selected ? selection.anchor : null };
}

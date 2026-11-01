import { describe, expect, it } from "vite-plus/test";

import { EMPTY_ROW_SELECTION, selectRow, setRowsSelected } from "./ArchivedThreadsPanel.logic";

const ROWS = ["a", "b", "c", "d", "e"];

describe("archived thread row selection", () => {
  it("toggles a row and extends a range from the last toggled row", () => {
    const first = selectRow(EMPTY_ROW_SELECTION, "b", ROWS, false);
    expect([...first.keys]).toEqual(["b"]);

    const range = selectRow(first, "d", ROWS, true);
    expect([...range.keys].toSorted()).toEqual(["b", "c", "d"]);
    expect(range.anchor).toBe("b");

    const backwards = selectRow(range, "a", ROWS, true);
    expect([...backwards.keys].toSorted()).toEqual(["a", "b", "c", "d"]);

    const untoggled = selectRow(backwards, "c", ROWS, false);
    expect([...untoggled.keys].toSorted()).toEqual(["a", "b", "d"]);
    expect(untoggled.anchor).toBe("c");
  });

  it("toggles instead of extending when the anchor is filtered out", () => {
    const selection = selectRow(EMPTY_ROW_SELECTION, "z", [...ROWS, "z"], false);
    const next = selectRow(selection, "c", ROWS, true);
    expect([...next.keys].toSorted()).toEqual(["c", "z"]);
    expect(next.anchor).toBe("c");
  });

  it("selects and clears only the given rows", () => {
    const hidden = selectRow(EMPTY_ROW_SELECTION, "z", [...ROWS, "z"], false);
    const all = setRowsSelected(hidden, ROWS, true);
    expect(all.keys.size).toBe(6);

    const cleared = setRowsSelected(all, ROWS, false);
    expect([...cleared.keys]).toEqual(["z"]);
    expect(cleared.anchor).toBeNull();
  });
});

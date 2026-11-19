import { THREAD_WORK_ROW_MIN_HEIGHT } from "../../lib/layout";
import type { ThreadFeedEntry } from "../../lib/threadActivity";

const TURN_FOLD_HEIGHT = 42;
const WORK_GROUP_TOGGLE_HEIGHT = THREAD_WORK_ROW_MIN_HEIGHT;

/** A previously opened detail stays measured while its closing fade keeps it mounted. */
export function threadWorkRowNeedsMeasurement(
  rowId: string,
  expandedRows: Readonly<Record<string, boolean>>,
) {
  return Object.hasOwn(expandedRows, rowId);
}

export function resolveThreadFeedFixedItemSize(entryType: ThreadFeedEntry["type"]) {
  switch (entryType) {
    case "run-fold":
      return TURN_FOLD_HEIGHT;
    case "work-toggle":
      return WORK_GROUP_TOGGLE_HEIGHT;
    case "activity-group":
    case "message":
      return undefined;
  }
}

import { openCommandPalette } from "../commandPaletteBus";
import type { PaneEdge } from "./layout";
import { focusPaneComposer } from "./paneScope";
import { useChatPaneStore } from "./store";

/** Arms the next opened thread to land beside the focused pane, then lets the user pick it. */
export function openThreadPickerBeside(edge: PaneEdge) {
  useChatPaneStore.getState().requestOpenToSide(edge);
  openCommandPalette();
}

/** A keyboard switch moves typing into the newly focused pane, as a click would. */
function focusFocusedPaneComposer() {
  const layout = useChatPaneStore.getState().layout;
  if (layout) requestAnimationFrame(() => focusPaneComposer(layout.focusedPaneId));
}

export function focusPaneIndexFromKeyboard(index: number): boolean {
  if (!useChatPaneStore.getState().focusIndex(index)) return false;
  focusFocusedPaneComposer();
  return true;
}

export function focusAdjacentPaneFromKeyboard(offset: 1 | -1): boolean {
  const { layout, focusAdjacent } = useChatPaneStore.getState();
  if (!layout || layout.cells.length < 2) return false;
  focusAdjacent(offset);
  focusFocusedPaneComposer();
  return true;
}

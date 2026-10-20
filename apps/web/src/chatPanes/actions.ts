import { openCommandPalette } from "../commandPaletteBus";
import type { PaneEdge } from "./layout";
import { focusPaneComposer } from "./paneScope";
import { useChatPaneStore } from "./store";

/** Arms the next opened thread to land beside the focused pane, then lets the user pick it. */
export function openThreadPickerBeside(edge: PaneEdge) {
  useChatPaneStore.getState().requestOpenToSide(edge);
  openCommandPalette();
}

/** Moves keyboard focus into a pane, for pane switching from the keyboard or a menu. */
export function focusPaneFromKeyboard(paneId: string) {
  useChatPaneStore.getState().focus(paneId);
  requestAnimationFrame(() => focusPaneComposer(paneId));
}

export function focusPaneIndexFromKeyboard(index: number): boolean {
  if (!useChatPaneStore.getState().focusIndex(index)) return false;
  const layout = useChatPaneStore.getState().layout;
  if (layout) requestAnimationFrame(() => focusPaneComposer(layout.focusedPaneId));
  return true;
}

export function focusAdjacentPaneFromKeyboard(offset: 1 | -1): boolean {
  const { layout, focusAdjacent } = useChatPaneStore.getState();
  if (!layout || layout.cells.length < 2) return false;
  focusAdjacent(offset);
  const next = useChatPaneStore.getState().layout;
  if (next) requestAnimationFrame(() => focusPaneComposer(next.focusedPaneId));
  return true;
}

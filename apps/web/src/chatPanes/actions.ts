import { openCommandPalette } from "../commandPaletteBus";
import type { ThreadRouteTarget } from "../threadRoutes";
import { canSplitPane, findPaneByTarget, type PaneEdge } from "./layout";
import { workspaceSize } from "./paneDrop";
import { focusPaneComposer } from "./paneScope";
import { useChatPaneStore } from "./store";
import type { ScopedThreadRef } from "@supaterm/contracts";

/**
 * Opens a thread in a new pane beside the focused one, or focuses it if it is already on screen.
 * False when there is no room, so the caller can open it in place instead.
 */
export function openThreadBeside(target: ThreadRouteTarget, edge: PaneEdge): boolean {
  const { layout, split } = useChatPaneStore.getState();
  const workspace = workspaceSize();
  if (!layout || !workspace) return false;
  const fits =
    findPaneByTarget(layout, target) !== null ||
    canSplitPane(layout, layout.focusedPaneId, edge, workspace);
  return fits && split(layout.focusedPaneId, edge, target) !== null;
}

/** A click into a desktop browser never reaches the pane's DOM, so the browser claims its pane. */
export function focusPaneShowingThread(threadRef: ScopedThreadRef) {
  const { layout, focus } = useChatPaneStore.getState();
  const pane = layout ? findPaneByTarget(layout, { kind: "server", threadRef }) : null;
  if (pane) focus(pane.id);
}

let mountedWorkspaces = 0;

/** The chat workspace follows focus into the URL; elsewhere, such as Settings, callers navigate. */
export function trackChatPaneWorkspaceMount(): () => void {
  mountedWorkspaces += 1;
  return () => {
    mountedWorkspaces -= 1;
  };
}

export function isChatPaneWorkspaceMounted(): boolean {
  return mountedWorkspaces > 0;
}

/** Pane commands that arrive as desktop menu actions, such as shortcuts forwarded from a browser. */
export function runPaneMenuAction(action: string): boolean {
  if (action === "pane.focusNext") return focusAdjacentPaneFromKeyboard(1);
  if (action === "pane.focusPrevious") return focusAdjacentPaneFromKeyboard(-1);
  const index = /^pane\.focus\.([1-4])$/.exec(action)?.[1];
  return index !== undefined && focusPaneIndexFromKeyboard(Number(index) - 1);
}

/** Arms the next opened thread to land beside the focused pane, then lets the user pick it. */
export function openThreadPickerBeside(edge: PaneEdge) {
  useChatPaneStore.getState().requestOpenToSide(edge);
  openCommandPalette();
}

/** A keyboard switch moves typing into the newly focused pane, as a click would. */
export function focusFocusedPaneComposer() {
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

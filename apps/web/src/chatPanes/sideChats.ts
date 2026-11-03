import { randomUUID } from "../lib/utils";
import type { ThreadRouteTarget } from "../threadRoutes";
import {
  canSplitPane,
  closePane,
  type ClosePaneResult,
  findPane,
  findPaneByTarget,
  focusPane,
  linkSideChatPane,
  type PaneEdge,
  type PaneLayout,
  type PaneLayoutSize,
  paneTargetKey,
  replacePaneTarget,
  sideChatPanes,
  splitPane,
  unlinkPane,
} from "./layout";

const MAX_PARKED_SIDE_CHATS = 20;

export interface ParkedSideChats {
  readonly parent: ThreadRouteTarget;
  readonly sideChats: ReadonlyArray<ThreadRouteTarget>;
}

/** The panes, plus the side chats whose parent left them, newest parent first. */
export interface PaneArrangement {
  readonly layout: PaneLayout;
  readonly parkedSideChats: ReadonlyArray<ParkedSideChats>;
}

function parkSideChats(state: PaneArrangement, paneId: string): PaneArrangement {
  const pane = findPane(state.layout, paneId);
  const sideChats = sideChatPanes(state.layout, paneId);
  if (!pane || sideChats.length === 0) return state;
  const layout = sideChats.reduce(
    (current, cell) => closePane(current, cell.id)?.layout ?? current,
    state.layout,
  );
  const key = paneTargetKey(pane.target);
  const targets = sideChats.map((cell) => cell.target);
  const keys = new Set(targets.map(paneTargetKey));
  const earlier = state.parkedSideChats.find((entry) => paneTargetKey(entry.parent) === key);
  const entry = {
    parent: pane.target,
    sideChats: [
      ...targets,
      ...(earlier?.sideChats ?? []).filter((target) => !keys.has(paneTargetKey(target))),
    ],
  };
  return {
    layout,
    parkedSideChats: [entry, ...state.parkedSideChats.filter((other) => other !== earlier)].slice(
      0,
      MAX_PARKED_SIDE_CHATS,
    ),
  };
}

/** Side chats that do not fit stay parked; one already on screen is tied back to its parent. */
function restoreSideChats(
  state: PaneArrangement,
  paneId: string,
  workspace: PaneLayoutSize | null,
): PaneArrangement {
  const pane = findPane(state.layout, paneId);
  const key = pane ? paneTargetKey(pane.target) : null;
  const entry = state.parkedSideChats.find((other) => paneTargetKey(other.parent) === key);
  if (!entry || !workspace) return state;
  let layout = state.layout;
  const unopened: ThreadRouteTarget[] = [];
  // Each opens right beside the parent, so the last one goes first to keep their order.
  for (const target of entry.sideChats.toReversed()) {
    const shown = findPaneByTarget(layout, target);
    if (shown) {
      layout = linkSideChatPane(layout, shown.id, paneId);
      continue;
    }
    const id = randomUUID();
    const split = canSplitPane(layout, paneId, "right", workspace)
      ? splitPane(layout, paneId, "right", target, id, randomUUID)
      : null;
    if (split) layout = linkSideChatPane(split, id, paneId);
    else unopened.unshift(target);
  }
  return {
    layout: focusPane(layout, paneId),
    parkedSideChats:
      unopened.length > 0
        ? state.parkedSideChats.map((other) =>
            other === entry ? { ...other, sideChats: unopened } : other,
          )
        : state.parkedSideChats.filter((other) => other !== entry),
  };
}

/**
 * Shows `target` in `paneId` and focuses it. The thread the pane showed takes its side chats
 * along, and the side chats parked under `target` come back beside it.
 */
export function showInPane(
  state: PaneArrangement,
  paneId: string,
  target: ThreadRouteTarget,
  workspace: PaneLayoutSize | null,
): PaneArrangement {
  const parked = parkSideChats(state, paneId);
  const layout = focusPane(replacePaneTarget(parked.layout, paneId, target), paneId);
  return restoreSideChats({ ...parked, layout }, paneId, workspace);
}

/**
 * Shows a parked side chat by bringing back its parent, which reopens it beside. Null when the
 * side chat is not parked, its parent is already on screen, or it would not fit.
 */
export function showParkedSideChat(
  state: PaneArrangement,
  paneId: string,
  sideChat: ThreadRouteTarget,
  workspace: PaneLayoutSize | null,
): PaneArrangement | null {
  const key = paneTargetKey(sideChat);
  const entry = state.parkedSideChats.find((other) =>
    other.sideChats.some((target) => paneTargetKey(target) === key),
  );
  if (!entry || findPaneByTarget(state.layout, entry.parent)) return null;
  const shown = showInPane(state, paneId, entry.parent, workspace);
  const pane = findPaneByTarget(shown.layout, sideChat);
  return pane ? { ...shown, layout: focusPane(shown.layout, pane.id) } : null;
}

/** Opens `target` beside `paneId` with its parked side chats; null when it cannot split. */
export function openBeside(
  state: PaneArrangement,
  paneId: string,
  edge: PaneEdge,
  target: ThreadRouteTarget,
  newPaneId: string,
  workspace: PaneLayoutSize | null,
): PaneArrangement | null {
  const layout = splitPane(state.layout, paneId, edge, target, newPaneId, randomUUID);
  return layout ? restoreSideChats({ ...state, layout }, newPaneId, workspace) : null;
}

/** The same conversation under a new target, such as a promoted draft, so the pane keeps its tie. */
export function retargetPane(
  state: PaneArrangement,
  paneId: string,
  target: ThreadRouteTarget,
): PaneArrangement {
  const parked = parkSideChats(state, paneId);
  return {
    ...parked,
    layout: {
      ...parked.layout,
      cells: parked.layout.cells.map((cell) => (cell.id === paneId ? { ...cell, target } : cell)),
    },
  };
}

/** Closes `paneId` and parks its side chats, unless they are all that would be left. */
export function closePaneWithSideChats(
  state: PaneArrangement,
  paneId: string,
): { readonly arrangement: PaneArrangement; readonly closed: ClosePaneResult } | null {
  const parked = parkSideChats(state, paneId);
  const from = parked.layout.cells.length < 2 ? state : parked;
  const closed = closePane(from.layout, paneId);
  return closed ? { arrangement: { ...from, layout: closed.layout }, closed } : null;
}

/** Unties a side chat that became a full thread, whether it is on screen or parked. */
export function untieSideChat(
  state: PaneArrangement,
  sideChat: ThreadRouteTarget,
): PaneArrangement {
  const key = paneTargetKey(sideChat);
  const pane = findPaneByTarget(state.layout, sideChat);
  return {
    layout: pane ? unlinkPane(state.layout, pane.id) : state.layout,
    parkedSideChats: state.parkedSideChats.flatMap((entry) => {
      const sideChats = entry.sideChats.filter((target) => paneTargetKey(target) !== key);
      return sideChats.length === 0 ? [] : [{ ...entry, sideChats }];
    }),
  };
}

/** A draft parked before its first send finished stands for its thread once the draft is gone. */
export function promoteParkedDraft(
  parked: ReadonlyArray<ParkedSideChats>,
  draft: ThreadRouteTarget,
  thread: ThreadRouteTarget,
): ReadonlyArray<ParkedSideChats> {
  const key = paneTargetKey(draft);
  return parked.map((entry) => ({
    ...entry,
    sideChats: entry.sideChats.map((target) => (paneTargetKey(target) === key ? thread : target)),
  }));
}

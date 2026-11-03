import type { ScopedThreadRef } from "@supaterm/contracts";

import type { DraftId } from "../draftId";
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

/** The thread a sent draft became, or null while it is unsent. */
export type DraftThread = (draftId: DraftId) => ScopedThreadRef | null;
const noDraftThread: DraftThread = () => null;

export interface ParkedSideChats {
  readonly parent: ThreadRouteTarget;
  readonly sideChats: ReadonlyArray<ThreadRouteTarget>;
}

/** The panes, plus the side chats whose parent left them, newest parent first. */
export interface PaneArrangement {
  readonly layout: PaneLayout;
  readonly parkedSideChats: ReadonlyArray<ParkedSideChats>;
}

// A sent draft is parked as its thread: the draft goes away once the thread takes over.
function parkedTarget(target: ThreadRouteTarget, draftThread: DraftThread): ThreadRouteTarget {
  const threadRef = target.kind === "draft" ? draftThread(target.draftId) : null;
  return threadRef ? { kind: "server", threadRef } : target;
}

function parkSideChats(
  state: PaneArrangement,
  paneId: string,
  draftThread: DraftThread,
): PaneArrangement {
  const pane = findPane(state.layout, paneId);
  const sideChats = sideChatPanes(state.layout, paneId);
  if (!pane || sideChats.length === 0) return state;
  const layout = sideChats.reduce(
    (current, cell) => closePane(current, cell.id)?.layout ?? current,
    state.layout,
  );
  const targets = sideChats.map((cell) => parkedTarget(cell.target, draftThread));
  return { layout, parkedSideChats: parkUnder(state.parkedSideChats, pane.target, targets) };
}

/** Earlier entries go first when they come back, so ones already parked under `parent` follow. */
function parkUnder(
  parked: ReadonlyArray<ParkedSideChats>,
  parent: ThreadRouteTarget,
  sideChats: ReadonlyArray<ThreadRouteTarget>,
): ReadonlyArray<ParkedSideChats> {
  const key = paneTargetKey(parent);
  const keys = new Set(sideChats.map(paneTargetKey));
  const earlier = parked.find((entry) => paneTargetKey(entry.parent) === key);
  const entry = {
    parent,
    sideChats: [
      ...sideChats,
      ...(earlier?.sideChats ?? []).filter((target) => !keys.has(paneTargetKey(target))),
    ],
  };
  return [entry, ...parked.filter((other) => other !== earlier)].slice(0, MAX_PARKED_SIDE_CHATS);
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
  let previousId = paneId;
  const unopened: ThreadRouteTarget[] = [];
  for (const target of entry.sideChats) {
    const shown = findPaneByTarget(layout, target);
    if (shown) {
      layout = linkSideChatPane(layout, shown.id, paneId);
      continue;
    }
    const id = randomUUID();
    const split = canSplitPane(layout, previousId, "right", workspace)
      ? splitPane(layout, previousId, "right", target, id, randomUUID)
      : null;
    if (split) {
      layout = linkSideChatPane(split, id, paneId);
      previousId = id;
    } else {
      unopened.push(target);
    }
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
  draftThread: DraftThread = noDraftThread,
): PaneArrangement {
  const parked = parkSideChats(state, paneId, draftThread);
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
  draftThread: DraftThread,
): PaneArrangement | null {
  const key = paneTargetKey(sideChat);
  const entry = state.parkedSideChats.find((other) =>
    other.sideChats.some((target) => paneTargetKey(target) === key),
  );
  if (!entry || findPaneByTarget(state.layout, entry.parent)) return null;
  const shown = showInPane(state, paneId, entry.parent, workspace, draftThread);
  const pane = findPaneByTarget(shown.layout, sideChat);
  return pane ? { ...shown, layout: focusPane(shown.layout, pane.id) } : null;
}

/**
 * With no room beside its parent, a side chat takes the pane of the parent's last side chat,
 * which is parked. Null when the parent has no side chat on screen.
 */
export function swapInSideChat(
  state: PaneArrangement,
  parentPaneId: string,
  sideChat: ThreadRouteTarget,
): PaneArrangement | null {
  const parent = findPane(state.layout, parentPaneId);
  const last = sideChatPanes(state.layout, parentPaneId).at(-1);
  if (!parent || !last || findPaneByTarget(state.layout, sideChat)) return null;
  const cells = state.layout.cells.map((cell) =>
    cell.id === last.id ? { ...cell, target: sideChat } : cell,
  );
  return {
    layout: focusPane({ ...state.layout, cells }, last.id),
    parkedSideChats: parkUnder(state.parkedSideChats, parent.target, [last.target]),
  };
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
  const parked = parkSideChats(state, paneId, noDraftThread);
  return {
    ...parked,
    layout: {
      ...parked.layout,
      cells: parked.layout.cells.map((cell) => (cell.id === paneId ? { ...cell, target } : cell)),
    },
  };
}

/**
 * Closes `paneId` and parks its side chats, unless they are all that would be left or the
 * thread is gone for good.
 */
export function closePaneWithSideChats(
  state: PaneArrangement,
  paneId: string,
  threadGone: boolean,
): { readonly arrangement: PaneArrangement; readonly closed: ClosePaneResult } | null {
  const parked = threadGone ? state : parkSideChats(state, paneId, noDraftThread);
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

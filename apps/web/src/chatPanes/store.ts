import { ScopedThreadRef } from "@supaterm/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { DraftId } from "../draftId";
import { resolveStorage, type StateStorage } from "../lib/storage";
import { randomUUID } from "../lib/utils";
import type { ThreadRouteTarget } from "../threadRoutes";
import {
  canSplitPane,
  closeOtherPanes,
  closePane,
  createPaneLayout,
  equalizePaneLayout,
  findPane,
  findPaneByTarget,
  focusAdjacentPane,
  focusedPane,
  focusPane,
  isValidPaneLayout,
  linkSideChatPane,
  movePane,
  orderedPanes,
  type PaneEdge,
  type PaneLayout,
  type PaneLayoutSize,
  paneTargetKey,
  replacePaneTarget,
  setTrackSizes,
  sideChatPanes,
  splitPane,
  swapPanes,
  unlinkPane,
} from "./layout";

const STORAGE_KEY = "supaterm:chat-panes:v1";
const MAX_CLOSED_RECORDS = 20;
const MAX_PARKED_SIDE_CHATS = 20;

const PaneTargetSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("server"), threadRef: ScopedThreadRef }),
  Schema.Struct({ kind: Schema.Literal("draft"), draftId: DraftId }),
]);
const PaneTrackSchema = Schema.Struct({ id: Schema.String, size: Schema.Finite });
const PaneLayoutSchema = Schema.Struct({
  columns: Schema.Array(PaneTrackSchema),
  rows: Schema.Array(PaneTrackSchema),
  cells: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      target: PaneTargetSchema,
      column: Schema.Number,
      columnSpan: Schema.Number,
      row: Schema.Number,
      rowSpan: Schema.Number,
      sideChatOf: Schema.optionalKey(Schema.String),
    }),
  ),
  focusedPaneId: Schema.String,
});
const ClosedPaneRecordSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("pane"),
    target: PaneTargetSchema,
    besidePaneId: Schema.String,
    edge: Schema.Literals(["left", "right", "top", "bottom"]),
    /** The parent thread of a side chat's pane, to tie it again when it reopens. */
    sideChatOf: Schema.optionalKey(PaneTargetSchema),
    closedAt: Schema.Number,
  }),
  Schema.Struct({
    kind: Schema.Literal("layout"),
    layout: PaneLayoutSchema,
    closedAt: Schema.Number,
  }),
]);
const ParkedSideChatsSchema = Schema.Struct({
  parent: PaneTargetSchema,
  sideChats: Schema.Array(PaneTargetSchema),
});
const PersistedChatPaneState = Schema.Struct({
  layout: Schema.NullOr(PaneLayoutSchema),
  closed: Schema.Array(ClosedPaneRecordSchema),
  parkedSideChats: Schema.optionalKey(Schema.Array(ParkedSideChatsSchema)),
});
const decodePersistedChatPaneState = Schema.decodeUnknownOption(PersistedChatPaneState);

export type ClosedPaneRecord = typeof ClosedPaneRecordSchema.Type;
type ParkedSideChats = typeof ParkedSideChatsSchema.Type;

/**
 * Reads this tab's own copy first so a reload restores its arrangement, and
 * falls back to the last arrangement any tab saved: a new tab, or a desktop
 * relaunch, which clears session storage. Writes go to both.
 */
function createPaneStorage(): StateStorage {
  const session = resolveStorage(typeof window !== "undefined" ? window.sessionStorage : undefined);
  const local = resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined);
  return {
    getItem: (name) => {
      const own = session.getItem(name);
      if (typeof own === "string") return own;
      const shared = local.getItem(name);
      // Seed this tab so a later reload keeps it, even if another tab saves after.
      if (typeof shared === "string") session.setItem(name, shared);
      return shared;
    },
    setItem: (name, value) => {
      session.setItem(name, value);
      local.setItem(name, value);
    },
    removeItem: (name) => {
      session.removeItem(name);
      local.removeItem(name);
    },
  };
}

/** How the URL should follow a focus change: an open adds history, a click does not. */
export type PaneHistoryMode = "push" | "replace";

interface ChatPaneState {
  layout: PaneLayout | null;
  closed: ReadonlyArray<ClosedPaneRecord>;
  /** Side chats whose parent left the screen, newest parent first, to reopen when it returns. */
  parkedSideChats: ReadonlyArray<ParkedSideChats>;
  historyMode: PaneHistoryMode;
  /** Set while the user picks a thread to open beside the focused pane. */
  openToSide: { readonly edge: PaneEdge } | null;
  /**
   * The route names the focused pane's thread. With an open-to-side request
   * armed, a thread that is not on screen opens in a new pane instead.
   */
  reconcileRoute: (target: ThreadRouteTarget, workspace: PaneLayoutSize | null) => void;
  /** The next thread opened from anywhere lands beside the focused pane. */
  requestOpenToSide: (edge: PaneEdge) => void;
  cancelOpenToSide: () => void;
  focus: (paneId: string) => void;
  focusAdjacent: (offset: 1 | -1) => void;
  focusIndex: (index: number) => boolean;
  split: (paneId: string, edge: PaneEdge, target: ThreadRouteTarget) => string | null;
  /** Ties an on-screen side chat to its parent's pane; a no-op unless both are on screen. */
  linkSideChat: (pair: {
    readonly parent: ThreadRouteTarget;
    readonly sideChat: ThreadRouteTarget;
  }) => void;
  /** Unties a side chat that became a full thread, so it stays when its parent leaves. */
  unlinkSideChat: (sideChat: ThreadRouteTarget) => void;
  replace: (paneId: string, target: ThreadRouteTarget, workspace: PaneLayoutSize | null) => void;
  /** Swaps a pane's thread without moving the URL, for a background draft that was promoted. */
  retarget: (paneId: string, target: ThreadRouteTarget) => void;
  /** Closes a pane; `remember: false` skips reopen history, for a thread that no longer exists. */
  close: (paneId: string, options?: { readonly remember?: boolean }) => boolean;
  closeOthers: (paneId: string) => void;
  move: (paneId: string, targetPaneId: string, edge: PaneEdge) => void;
  swap: (paneId: string, otherPaneId: string) => void;
  setTrackSizes: (sizes: {
    readonly columns?: Record<string, number>;
    readonly rows?: Record<string, number>;
  }) => void;
  equalize: () => void;
  /** Restores the most recent closed pane or arrangement; returns false when there is none. */
  reopenClosed: (workspace: PaneLayoutSize | null) => boolean;
}

function remember(
  closed: ReadonlyArray<ClosedPaneRecord>,
  record: ClosedPaneRecord,
): ReadonlyArray<ClosedPaneRecord> {
  return [record, ...closed].slice(0, MAX_CLOSED_RECORDS);
}

interface PaneArrangement {
  readonly layout: PaneLayout;
  readonly parkedSideChats: ReadonlyArray<ParkedSideChats>;
}

/** Closes the side chats tied to `paneId` and remembers them under the thread it shows. */
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

/** Reopens the side chats parked under the thread `paneId` shows, beside it, where they fit. */
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
    if (findPaneByTarget(layout, target)) continue;
    const id = randomUUID();
    const split = canSplitPane(layout, paneId, "right", workspace)
      ? splitPane(layout, paneId, "right", target, id, randomUUID)
      : null;
    if (split) layout = linkSideChatPane(split, id, paneId);
    else unopened.unshift(target);
  }
  return {
    layout: { ...layout, focusedPaneId: paneId },
    parkedSideChats:
      unopened.length > 0
        ? state.parkedSideChats.map((other) =>
            other === entry ? { ...other, sideChats: unopened } : other,
          )
        : state.parkedSideChats.filter((other) => other !== entry),
  };
}

/**
 * Shows `target` in `paneId` and focuses it. The side chats of the thread it showed leave with
 * that thread, and the side chats parked under `target` come back.
 */
function showInPane(
  state: PaneArrangement,
  paneId: string,
  target: ThreadRouteTarget,
  workspace: PaneLayoutSize | null,
): PaneArrangement {
  const parked = parkSideChats(state, paneId);
  const layout = focusPane(replacePaneTarget(parked.layout, paneId, target), paneId);
  return restoreSideChats({ ...parked, layout }, paneId, workspace);
}

export const useChatPaneStore = create<ChatPaneState>()(
  persist(
    (set, get) => ({
      layout: null,
      closed: [],
      parkedSideChats: [],
      historyMode: "replace",
      openToSide: null,
      // Runs once per navigation, so an armed open-to-side request is used up either way.
      reconcileRoute: (target, workspace) =>
        set((state) => {
          const request = state.openToSide;
          const { layout: current } = state;
          if (
            current &&
            request &&
            workspace &&
            !findPaneByTarget(current, target) &&
            canSplitPane(current, current.focusedPaneId, request.edge, workspace)
          ) {
            const split = splitPane(
              current,
              current.focusedPaneId,
              request.edge,
              target,
              randomUUID(),
              randomUUID,
            );
            if (split) return { layout: split, openToSide: null, historyMode: "replace" };
          }
          if (current === null) {
            return {
              layout: createPaneLayout(target, randomUUID),
              openToSide: null,
              historyMode: "replace",
            };
          }
          const existing = findPaneByTarget(current, target);
          if (existing) {
            const layout = focusPane(current, existing.id);
            return layout === current && state.openToSide === null
              ? state
              : { layout, openToSide: null, historyMode: "replace" };
          }
          // Navigating from a side chat moves its parent's pane, which takes the side chat along.
          const focused = focusedPane(current);
          const shown = showInPane(
            { layout: current, parkedSideChats: state.parkedSideChats },
            focused.sideChatOf ?? focused.id,
            target,
            workspace,
          );
          return { ...shown, openToSide: null, historyMode: "replace" };
        }),
      requestOpenToSide: (edge) => set({ openToSide: { edge } }),
      cancelOpenToSide: () => set((state) => (state.openToSide ? { openToSide: null } : state)),
      focus: (paneId) =>
        set((state) => {
          if (!state.layout) return state;
          const layout = focusPane(state.layout, paneId);
          return layout === state.layout ? state : { layout, historyMode: "replace" };
        }),
      focusAdjacent: (offset) =>
        set((state) =>
          state.layout
            ? { layout: focusAdjacentPane(state.layout, offset), historyMode: "replace" }
            : state,
        ),
      focusIndex: (index) => {
        const layout = get().layout;
        const pane = layout ? orderedPanes(layout)[index] : undefined;
        if (!layout || !pane) return false;
        set({ layout: focusPane(layout, pane.id), historyMode: "replace" });
        return true;
      },
      split: (paneId, edge, target) => {
        const layout = get().layout;
        if (!layout) return null;
        const existing = findPaneByTarget(layout, target);
        if (existing) {
          set({ layout: focusPane(layout, existing.id), historyMode: "push" });
          return existing.id;
        }
        const newPaneId = randomUUID();
        const next = splitPane(layout, paneId, edge, target, newPaneId, randomUUID);
        if (!next) return null;
        set({ layout: next, historyMode: "push" });
        return newPaneId;
      },
      linkSideChat: ({ parent, sideChat }) =>
        set((state) => {
          if (!state.layout) return state;
          const parentPane = findPaneByTarget(state.layout, parent);
          const sideChatPane = findPaneByTarget(state.layout, sideChat);
          if (!parentPane || !sideChatPane) return state;
          const layout = linkSideChatPane(state.layout, sideChatPane.id, parentPane.id);
          return layout === state.layout ? state : { layout };
        }),
      unlinkSideChat: (sideChat) =>
        set((state) => {
          const pane = state.layout ? findPaneByTarget(state.layout, sideChat) : null;
          if (!state.layout || !pane) return state;
          const layout = unlinkPane(state.layout, pane.id);
          return layout === state.layout ? state : { layout };
        }),
      replace: (paneId, target, workspace) =>
        set((state) => {
          if (!state.layout || !findPane(state.layout, paneId)) return state;
          const existing = findPaneByTarget(state.layout, target);
          if (existing)
            return { layout: focusPane(state.layout, existing.id), historyMode: "push" };
          const shown = showInPane(
            { layout: state.layout, parkedSideChats: state.parkedSideChats },
            paneId,
            target,
            workspace,
          );
          return { ...shown, historyMode: "push" };
        }),
      // The pane keeps its tie: a promoted draft is the same conversation.
      retarget: (paneId, target) =>
        set((state) => {
          if (!state.layout || findPaneByTarget(state.layout, target)) return state;
          const parked = parkSideChats(
            { layout: state.layout, parkedSideChats: state.parkedSideChats },
            paneId,
          );
          return {
            ...parked,
            layout: {
              ...parked.layout,
              cells: parked.layout.cells.map((cell) =>
                cell.id === paneId ? { ...cell, target } : cell,
              ),
            },
          };
        }),
      close: (paneId, options) => {
        const { layout, closed, parkedSideChats } = get();
        const cell = layout ? findPane(layout, paneId) : null;
        if (!layout || !cell || layout.cells.length < 2) return false;
        // Its side chats leave with it, unless they are all that would be left.
        const parked = parkSideChats({ layout, parkedSideChats }, paneId);
        const from = parked.layout.cells.length < 2 ? { layout, parkedSideChats } : parked;
        const result = closePane(from.layout, paneId);
        if (!result) return false;
        const parent = cell.sideChatOf === undefined ? null : findPane(layout, cell.sideChatOf);
        set({
          layout: result.layout,
          parkedSideChats: from.parkedSideChats,
          closed:
            options?.remember === false
              ? closed
              : remember(closed, {
                  kind: "pane",
                  target: cell.target,
                  besidePaneId: result.reopenBeside.paneId,
                  edge: result.reopenBeside.edge,
                  ...(parent ? { sideChatOf: parent.target } : {}),
                  closedAt: Date.now(),
                }),
          historyMode: "replace",
        });
        return true;
      },
      closeOthers: (paneId) => {
        const { layout, closed } = get();
        if (!layout || layout.cells.length < 2 || !findPane(layout, paneId)) return;
        set({
          layout: closeOtherPanes(layout, paneId),
          closed: remember(closed, { kind: "layout", layout, closedAt: Date.now() }),
          historyMode: "replace",
        });
      },
      move: (paneId, targetPaneId, edge) =>
        set((state) => {
          if (!state.layout) return state;
          const layout = movePane(state.layout, paneId, targetPaneId, edge, randomUUID);
          return layout ? { layout, historyMode: "replace" } : state;
        }),
      swap: (paneId, otherPaneId) =>
        set((state) =>
          state.layout
            ? { layout: swapPanes(state.layout, paneId, otherPaneId), historyMode: "replace" }
            : state,
        ),
      setTrackSizes: (sizes) =>
        set((state) => {
          if (!state.layout) return state;
          const layout = setTrackSizes(state.layout, sizes);
          return layout === state.layout ? state : { layout };
        }),
      equalize: () =>
        set((state) => (state.layout ? { layout: equalizePaneLayout(state.layout) } : state)),
      reopenClosed: (workspace) => {
        const { layout, closed, parkedSideChats } = get();
        const [record, ...rest] = closed;
        if (!layout || !record) return false;
        if (record.kind === "layout") {
          const focused = findPane(layout, layout.focusedPaneId);
          const restored = focused
            ? replacePaneTarget(record.layout, record.layout.focusedPaneId, focused.target)
            : record.layout;
          set({
            layout: isValidPaneLayout(restored) ? restored : record.layout,
            closed: rest,
            historyMode: "push",
          });
          return true;
        }
        const existing = findPaneByTarget(layout, record.target);
        if (existing) {
          set({ layout: focusPane(layout, existing.id), closed: rest, historyMode: "push" });
          return true;
        }
        const beside = findPane(layout, record.besidePaneId)?.id ?? layout.focusedPaneId;
        const reopenedId = randomUUID();
        const next = splitPane(layout, beside, record.edge, record.target, reopenedId, randomUUID);
        const parentPane = record.sideChatOf ? findPaneByTarget(layout, record.sideChatOf) : null;
        const reopened = next
          ? restoreSideChats(
              {
                layout: parentPane ? linkSideChatPane(next, reopenedId, parentPane.id) : next,
                parkedSideChats,
              },
              reopenedId,
              workspace,
            )
          : showInPane({ layout, parkedSideChats }, layout.focusedPaneId, record.target, workspace);
        set({ ...reopened, closed: rest, historyMode: "push" });
        return true;
      },
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(createPaneStorage),
      partialize: ({ layout, closed, parkedSideChats }) => ({ layout, closed, parkedSideChats }),
      merge: (persisted, current) => {
        const decoded = Option.getOrNull(decodePersistedChatPaneState(persisted));
        if (!decoded) return current;
        const layout = decoded.layout && isValidPaneLayout(decoded.layout) ? decoded.layout : null;
        return {
          ...current,
          layout,
          closed: decoded.closed.filter(
            (record) => record.kind === "pane" || isValidPaneLayout(record.layout),
          ),
          parkedSideChats: decoded.parkedSideChats ?? [],
        };
      },
    },
  ),
);

export function newestClosedPaneAt(): number | null {
  return useChatPaneStore.getState().closed[0]?.closedAt ?? null;
}

export function isThreadShownInSplit(threadRef: ScopedThreadRef): boolean {
  const { layout } = useChatPaneStore.getState();
  return (
    layout !== null &&
    layout.cells.length > 1 &&
    findPaneByTarget(layout, { kind: "server", threadRef }) !== null
  );
}

/**
 * Closes the split pane showing a thread, for a thread archived or deleted from
 * anywhere. Returns false when the thread is not in a split, so the caller keeps
 * its single-view behavior.
 */
export function closePaneShowingThread(
  threadRef: ScopedThreadRef,
  options: { readonly remember: boolean; readonly onlyInBackground?: boolean },
): boolean {
  const { layout, close } = useChatPaneStore.getState();
  if (!layout || layout.cells.length < 2) return false;
  const pane = findPaneByTarget(layout, { kind: "server", threadRef });
  if (!pane || (options.onlyInBackground && pane.id === layout.focusedPaneId)) return false;
  return close(pane.id, { remember: options.remember });
}

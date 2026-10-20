import { ScopedThreadRef } from "@supaterm/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { DraftId } from "../composerDraftStore";
import { resolveStorage, type StateStorage } from "../lib/storage";
import { randomUUID } from "../lib/utils";
import type { ThreadRouteTarget } from "../threadRoutes";
import {
  canSplitPane,
  closeOtherPanes,
  closePane,
  equalizePaneLayout,
  findPane,
  findPaneByTarget,
  focusAdjacentPane,
  focusPane,
  isValidPaneLayout,
  movePane,
  orderedPanes,
  type PaneEdge,
  type PaneLayout,
  type PaneLayoutSize,
  reconcileLayoutWithRoute,
  replacePaneTarget,
  setTrackSizes,
  splitPane,
  swapPanes,
} from "./layout";

const STORAGE_KEY = "supaterm:chat-panes:v1";
const MAX_CLOSED_RECORDS = 20;

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
    closedAt: Schema.Number,
  }),
  Schema.Struct({
    kind: Schema.Literal("layout"),
    layout: PaneLayoutSchema,
    closedAt: Schema.Number,
  }),
]);
const PersistedChatPaneState = Schema.Struct({
  layout: Schema.NullOr(PaneLayoutSchema),
  closed: Schema.Array(ClosedPaneRecordSchema),
});
const decodePersistedChatPaneState = Schema.decodeUnknownOption(PersistedChatPaneState);

export type ClosedPaneRecord = typeof ClosedPaneRecordSchema.Type;

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
  replace: (paneId: string, target: ThreadRouteTarget) => void;
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
  reopenClosed: () => boolean;
}

function remember(
  closed: ReadonlyArray<ClosedPaneRecord>,
  record: ClosedPaneRecord,
): ReadonlyArray<ClosedPaneRecord> {
  return [record, ...closed].slice(0, MAX_CLOSED_RECORDS);
}

export const useChatPaneStore = create<ChatPaneState>()(
  persist(
    (set, get) => ({
      layout: null,
      closed: [],
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
          const layout = reconcileLayoutWithRoute(current, target, randomUUID);
          return layout === current && state.openToSide === null
            ? state
            : { layout, openToSide: null, historyMode: "replace" };
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
      replace: (paneId, target) =>
        set((state) => {
          if (!state.layout) return state;
          const existing = findPaneByTarget(state.layout, target);
          const layout = existing
            ? focusPane(state.layout, existing.id)
            : focusPane(replacePaneTarget(state.layout, paneId, target), paneId);
          return { layout, historyMode: "push" };
        }),
      retarget: (paneId, target) =>
        set((state) => {
          if (!state.layout || findPaneByTarget(state.layout, target)) return state;
          return {
            layout: {
              ...state.layout,
              cells: state.layout.cells.map((cell) =>
                cell.id === paneId ? { ...cell, target } : cell,
              ),
            },
          };
        }),
      close: (paneId, options) => {
        const { layout, closed } = get();
        if (!layout) return false;
        const cell = findPane(layout, paneId);
        const result = closePane(layout, paneId);
        if (!cell || !result) return false;
        set({
          layout: result.layout,
          closed:
            options?.remember === false
              ? closed
              : remember(closed, {
                  kind: "pane",
                  target: cell.target,
                  besidePaneId: result.reopenBeside.paneId,
                  edge: result.reopenBeside.edge,
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
      reopenClosed: () => {
        const { layout, closed } = get();
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
        const next = splitPane(
          layout,
          beside,
          record.edge,
          record.target,
          randomUUID(),
          randomUUID,
        );
        set({
          layout: next ?? replacePaneTarget(layout, layout.focusedPaneId, record.target),
          closed: rest,
          historyMode: "push",
        });
        return true;
      },
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(createPaneStorage),
      partialize: ({ layout, closed }) => ({ layout, closed }),
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
        };
      },
    },
  ),
);

export function newestClosedPaneAt(): number | null {
  return useChatPaneStore.getState().closed[0]?.closedAt ?? null;
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

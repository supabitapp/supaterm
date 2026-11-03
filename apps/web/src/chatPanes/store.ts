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
  createPaneLayout,
  equalizePaneLayout,
  findPane,
  findPaneByTarget,
  findPromotedDraftPane,
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
  swapPanes,
} from "./layout";
import {
  closePaneWithSideChats,
  type DraftThread,
  openBeside,
  type ParkedSideChats,
  promoteParkedDraft,
  retargetPane,
  showInPane,
  showParkedSideChat,
  swapInSideChat,
  untieSideChat,
} from "./sideChats";

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
   * armed, a thread that is not on screen opens in a new pane instead. A draft's
   * own thread, per `draftThread`, stays in the draft's pane.
   */
  reconcileRoute: (
    target: ThreadRouteTarget,
    workspace: PaneLayoutSize | null,
    draftThread?: DraftThread,
  ) => void;
  /** The next thread opened from anywhere lands beside the focused pane. */
  requestOpenToSide: (edge: PaneEdge) => void;
  cancelOpenToSide: () => void;
  focus: (paneId: string) => void;
  focusAdjacent: (offset: 1 | -1) => void;
  focusIndex: (index: number) => boolean;
  split: (
    paneId: string,
    edge: PaneEdge,
    target: ThreadRouteTarget,
    workspace: PaneLayoutSize | null,
  ) => string | null;
  /** Ties an on-screen side chat to its parent's pane; a no-op unless both are on screen. */
  linkSideChat: (pair: {
    readonly parent: ThreadRouteTarget;
    readonly sideChat: ThreadRouteTarget;
  }) => void;
  /** Puts a side chat in its parent's last side chat pane; false without one on screen. */
  swapInSideChat: (pair: {
    readonly parent: ThreadRouteTarget;
    readonly sideChat: ThreadRouteTarget;
  }) => boolean;
  /** Unties a side chat that became a full thread, so it stays when its parent leaves. */
  unlinkSideChat: (sideChat: ThreadRouteTarget) => void;
  promoteParkedDraft: (draftId: DraftId, threadRef: ScopedThreadRef) => void;
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

export const useChatPaneStore = create<ChatPaneState>()(
  persist(
    (set, get) => ({
      layout: null,
      closed: [],
      parkedSideChats: [],
      historyMode: "replace",
      openToSide: null,
      // Runs once per navigation, so an armed open-to-side request is used up either way.
      reconcileRoute: (target, workspace, draftThread = () => null) =>
        set((state) => {
          const { layout: current, openToSide: request } = state;
          if (current === null) {
            return {
              layout: createPaneLayout(target, randomUUID),
              openToSide: null,
              historyMode: "replace",
            };
          }
          const draftPane = findPromotedDraftPane(current, target, draftThread);
          if (draftPane && !findPaneByTarget(current, target)) {
            const retargeted = retargetPane(
              { layout: current, parkedSideChats: state.parkedSideChats },
              draftPane.id,
              target,
            );
            return {
              ...retargeted,
              layout: focusPane(retargeted.layout, draftPane.id),
              openToSide: null,
              historyMode: "replace",
            };
          }
          const existing = findPaneByTarget(current, target);
          if (existing) {
            const layout = focusPane(current, existing.id);
            return layout === current && request === null
              ? state
              : { layout, openToSide: null, historyMode: "replace" };
          }
          const from = { layout: current, parkedSideChats: state.parkedSideChats };
          const opened =
            request &&
            workspace &&
            canSplitPane(current, current.focusedPaneId, request.edge, workspace)
              ? openBeside(
                  from,
                  current.focusedPaneId,
                  request.edge,
                  target,
                  randomUUID(),
                  workspace,
                )
              : null;
          // Navigating from a side chat moves its parent's pane, which takes the side chat along.
          const focused = focusedPane(current);
          const anchorId = focused.sideChatOf ?? focused.id;
          return {
            ...(opened ??
              showParkedSideChat(from, anchorId, target, workspace, draftThread) ??
              showInPane(from, anchorId, target, workspace, draftThread)),
            openToSide: null,
            historyMode: "replace",
          };
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
      split: (paneId, edge, target, workspace) => {
        const { layout, parkedSideChats } = get();
        if (!layout) return null;
        const existing = findPaneByTarget(layout, target);
        if (existing) {
          set({ layout: focusPane(layout, existing.id), historyMode: "push" });
          return existing.id;
        }
        const newPaneId = randomUUID();
        const next = openBeside(
          { layout, parkedSideChats },
          paneId,
          edge,
          target,
          newPaneId,
          workspace,
        );
        if (!next) return null;
        set({ ...next, historyMode: "push" });
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
      swapInSideChat: ({ parent, sideChat }) => {
        const { layout, parkedSideChats } = get();
        const parentPane = layout ? findPaneByTarget(layout, parent) : null;
        if (!layout || !parentPane) return false;
        const swapped = swapInSideChat({ layout, parkedSideChats }, parentPane.id, sideChat);
        if (!swapped) return false;
        set({ ...swapped, historyMode: "push" });
        return true;
      },
      unlinkSideChat: (sideChat) =>
        set((state) => {
          if (!state.layout) return state;
          const key = paneTargetKey(sideChat);
          return {
            ...untieSideChat(
              { layout: state.layout, parkedSideChats: state.parkedSideChats },
              sideChat,
            ),
            closed: state.closed.map((record) => {
              if (record.kind !== "pane" || paneTargetKey(record.target) !== key) return record;
              const { sideChatOf: _sideChatOf, ...untied } = record;
              return untied;
            }),
          };
        }),
      promoteParkedDraft: (draftId, threadRef) =>
        set((state) => ({
          parkedSideChats: promoteParkedDraft(
            state.parkedSideChats,
            { kind: "draft", draftId },
            { kind: "server", threadRef },
          ),
        })),
      replace: (paneId, target, workspace) =>
        set((state) => {
          if (!state.layout || !findPane(state.layout, paneId)) return state;
          const existing = findPaneByTarget(state.layout, target);
          if (existing) {
            return { layout: focusPane(state.layout, existing.id), historyMode: "push" };
          }
          const shown = showInPane(
            { layout: state.layout, parkedSideChats: state.parkedSideChats },
            paneId,
            target,
            workspace,
          );
          return { ...shown, historyMode: "push" };
        }),
      retarget: (paneId, target) =>
        set((state) => {
          if (!state.layout || findPaneByTarget(state.layout, target)) return state;
          return retargetPane(
            { layout: state.layout, parkedSideChats: state.parkedSideChats },
            paneId,
            target,
          );
        }),
      close: (paneId, options) => {
        const { layout, closed, parkedSideChats } = get();
        const cell = layout ? findPane(layout, paneId) : null;
        if (!layout || !cell || layout.cells.length < 2) return false;
        const result = closePaneWithSideChats(
          { layout, parkedSideChats },
          paneId,
          options?.remember === false,
        );
        if (!result) return false;
        const parent = cell.sideChatOf === undefined ? null : findPane(layout, cell.sideChatOf);
        set({
          ...result.arrangement,
          closed:
            options?.remember === false
              ? closed
              : remember(closed, {
                  kind: "pane",
                  target: cell.target,
                  besidePaneId: result.closed.reopenBeside.paneId,
                  edge: result.closed.reopenBeside.edge,
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
        const from = { layout, parkedSideChats };
        const opened = openBeside(from, beside, record.edge, record.target, reopenedId, workspace);
        const parentPane = record.sideChatOf ? findPaneByTarget(layout, record.sideChatOf) : null;
        const reopened = opened
          ? {
              ...opened,
              layout: parentPane
                ? linkSideChatPane(opened.layout, reopenedId, parentPane.id)
                : opened.layout,
            }
          : showInPane(from, layout.focusedPaneId, record.target, workspace);
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

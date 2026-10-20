import type { ScopedThreadRef } from "@supaterm/contracts";
import { useSyncExternalStore } from "react";

import {
  canSplitPane,
  findPane,
  findPaneByTarget,
  movePane,
  paneLayoutFits,
  type PaneEdge,
} from "./layout";
import { useChatPaneStore } from "./store";

export type PaneDropZone = PaneEdge | "center";

export type PaneDragPayload =
  | { readonly kind: "threads"; readonly threads: ReadonlyArray<ScopedThreadRef> }
  | { readonly kind: "pane"; readonly paneId: string };

export interface PaneDropTarget {
  readonly paneId: string;
  readonly zone: PaneDropZone;
}

interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const edgeDepth = (extent: number) => Math.min(160, Math.max(56, extent * 0.22));

/** Edge bands scale with the pane; at a corner the edge the pointer is relatively closest to wins. */
export function resolvePaneDropZone(rect: Rect, point: { x: number; y: number }): PaneDropZone {
  const horizontal = edgeDepth(rect.width);
  const vertical = edgeDepth(rect.height);
  const distances: ReadonlyArray<readonly [PaneEdge, number]> = [
    ["left", (point.x - rect.left) / horizontal],
    ["right", (rect.left + rect.width - point.x) / horizontal],
    ["top", (point.y - rect.top) / vertical],
    ["bottom", (rect.top + rect.height - point.y) / vertical],
  ];
  let nearest = distances[0]!;
  for (const candidate of distances) if (candidate[1] < nearest[1]) nearest = candidate;
  return nearest[1] < 1 ? nearest[0] : "center";
}

/** A thread already on screen moves its pane rather than opening a second one. */
export function paneDropVerb(zone: PaneDropZone, payload: PaneDragPayload): string {
  const moving = payload.kind === "pane" || sourcePaneId(payload) !== null;
  if (zone === "center") return moving ? "Swap panes" : "Open here";
  const direction = { left: "left", right: "right", top: "up", bottom: "down" }[zone];
  return `${moving ? "Move" : "Split"} ${direction}`;
}

/** The pane a dragged thread or pane already occupies, if any. */
function sourcePaneId(payload: PaneDragPayload): string | null {
  const layout = useChatPaneStore.getState().layout;
  if (!layout) return null;
  if (payload.kind === "pane") return findPane(layout, payload.paneId)?.id ?? null;
  const [thread] = payload.threads;
  return thread
    ? (findPaneByTarget(layout, { kind: "server", threadRef: thread })?.id ?? null)
    : null;
}

function isPaneDropAllowed(
  payload: PaneDragPayload,
  target: PaneDropTarget,
  workspace: { width: number; height: number } | null,
): boolean {
  const layout = useChatPaneStore.getState().layout;
  if (!layout || !findPane(layout, target.paneId)) return false;
  if (payload.kind === "threads" && payload.threads.length !== 1) return false;
  const source = sourcePaneId(payload);
  if (source === target.paneId) return false;
  if (target.zone === "center") return true;
  if (workspace === null) return false;
  if (source === null) return canSplitPane(layout, target.paneId, target.zone, workspace);
  let probeId = 0;
  const moved = movePane(layout, source, target.paneId, target.zone, () => `probe-${probeId++}`);
  return moved !== null && paneLayoutFits(moved, workspace);
}

function findPaneElement(point: { x: number; y: number }): HTMLElement | null {
  return (
    document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>("[data-chat-pane]") ?? null
  );
}

/** The chat workspace's size, which bounds how many panes fit. */
export function workspaceSize() {
  const grid = document.querySelector<HTMLElement>('[data-slot="resizable-grid"]');
  if (!grid) return null;
  const { width, height } = grid.getBoundingClientRect();
  return { width, height };
}

export function findPaneDropTarget(
  point: { x: number; y: number },
  payload: PaneDragPayload,
): PaneDropTarget | null {
  const element = findPaneElement(point);
  const paneId = element?.dataset.chatPane;
  if (!element || !paneId) return null;
  const target = { paneId, zone: resolvePaneDropZone(element.getBoundingClientRect(), point) };
  return isPaneDropAllowed(payload, target, workspaceSize()) ? target : null;
}

let hover: PaneDropTarget | null = null;
const listeners = new Set<() => void>();

export function setPaneDropHover(next: PaneDropTarget | null) {
  if (hover?.paneId === next?.paneId && hover?.zone === next?.zone) return;
  hover = next;
  for (const listener of listeners) listener();
}

export function usePaneDropHover(paneId: string): PaneDropZone | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (hover?.paneId === paneId ? hover.zone : null),
    () => null,
  );
}

/** Applies a drop: an edge splits or moves, the center opens the thread there or swaps panes. */
export function commitPaneDrop(target: PaneDropTarget, payload: PaneDragPayload): boolean {
  const store = useChatPaneStore.getState();
  const source = sourcePaneId(payload);
  if (source !== null) {
    if (target.zone === "center") store.swap(source, target.paneId);
    else store.move(source, target.paneId, target.zone);
    store.focus(source);
    return true;
  }
  if (payload.kind !== "threads" || payload.threads.length !== 1) return false;
  const thread = { kind: "server" as const, threadRef: payload.threads[0]! };
  if (target.zone === "center") {
    store.replace(target.paneId, thread);
    return true;
  }
  return store.split(target.paneId, target.zone, thread) !== null;
}

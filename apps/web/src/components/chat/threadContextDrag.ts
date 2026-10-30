import type { EnvironmentId, ScopedThreadRef } from "@supaterm/contracts";
import { type RefObject, useEffect, useEffectEvent, useSyncExternalStore } from "react";

import {
  commitPaneDrop,
  findPaneDropTarget,
  paneDropVerb,
  setPaneDropHover,
  type PaneDragPayload,
} from "../../chatPanes/paneDrop";

export const THREAD_CONTEXT_DROP_EVENT = "supaterm-thread-context-drop";

export function useThreadContextDrop(
  targetRef: RefObject<EventTarget | null>,
  environmentId: EnvironmentId,
  targetKey: string,
  onDrop: (refs: ReadonlyArray<ScopedThreadRef>, isActive: () => boolean) => void,
) {
  const handleDrop = useEffectEvent(onDrop);
  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    let active = true;
    const listener = (event: Event) =>
      handleDrop((event as CustomEvent<ReadonlyArray<ScopedThreadRef>>).detail, () => active);
    target.addEventListener(THREAD_CONTEXT_DROP_EVENT, listener);
    return () => {
      active = false;
      target.removeEventListener(THREAD_CONTEXT_DROP_EVENT, listener);
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- a new environment or draft target ends the previous drop's imports through isActive
  }, [environmentId, targetKey, targetRef]);
}

const DROP_TARGET_ATTRIBUTE = "data-thread-context-drop";
const DROP_OVER_ATTRIBUTE = "data-thread-context-over";

export interface ThreadContextDragGhost {
  readonly x: number;
  readonly y: number;
  readonly title: string;
  readonly count: number;
  /** What releasing here would do, when the pointer is over a target. */
  readonly verb: string | null;
}

let ghost: ThreadContextDragGhost | null = null;
const listeners = new Set<() => void>();

function setGhost(next: ThreadContextDragGhost | null) {
  if (ghost === next) return;
  ghost = next;
  for (const listener of listeners) listener();
}

export function useThreadContextDragGhost(): ThreadContextDragGhost | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => ghost,
    () => null,
  );
}

let overTarget: HTMLElement | null = null;

function findDropTarget(point: { x: number; y: number }): HTMLElement | null {
  return (
    document
      .elementFromPoint(point.x, point.y)
      ?.closest<HTMLElement>(`[${DROP_TARGET_ATTRIBUTE}]`) ?? null
  );
}

/**
 * One drag carries threads into a composer as context, or onto a chat pane to
 * split or open it; a pane header drag carries the pane itself. The composer
 * sits inside its pane and wins while the pointer is over it.
 */
export function moveThreadContextDrag(
  point: { x: number; y: number },
  label: { title: string; count: number },
  payload: PaneDragPayload,
) {
  const target = payload.kind === "threads" ? findDropTarget(point) : null;
  if (target !== overTarget) {
    overTarget?.removeAttribute(DROP_OVER_ATTRIBUTE);
    target?.setAttribute(DROP_OVER_ATTRIBUTE, "true");
    overTarget = target;
  }
  const paneTarget = target ? null : findPaneDropTarget(point, payload);
  setPaneDropHover(paneTarget);
  const verb = target
    ? "Add as context"
    : paneTarget
      ? paneDropVerb(paneTarget.zone, payload)
      : null;
  setGhost({ x: point.x, y: point.y, ...label, verb });
}

export function endThreadContextDrag() {
  overTarget?.removeAttribute(DROP_OVER_ATTRIBUTE);
  overTarget = null;
  setPaneDropHover(null);
  setGhost(null);
}

export function dropThreadContext(
  point: { x: number; y: number },
  payload: PaneDragPayload,
): boolean {
  const target = payload.kind === "threads" ? findDropTarget(point) : null;
  if (target && payload.kind === "threads" && payload.threads.length > 0) {
    target.dispatchEvent(new CustomEvent(THREAD_CONTEXT_DROP_EVENT, { detail: payload.threads }));
    return true;
  }
  const paneTarget = findPaneDropTarget(point, payload);
  return paneTarget !== null && commitPaneDrop(paneTarget, payload);
}

export function threadContextDropTargetProps() {
  return { [DROP_TARGET_ATTRIBUTE]: "true" } as const;
}

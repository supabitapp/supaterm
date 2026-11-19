import { useRef } from "react";

import { observeResize } from "~/lib/observeResize";

import { filterSidebarV2VisibleThreads } from "../Sidebar.logic";

export interface SidebarRouteReveal {
  observedKey: string | null;
  pendingKey: string | null;
  pendingInPlace?: boolean;
}

export function pendingSidebarRouteReveal(
  reveal: SidebarRouteReveal,
  routeKey: string | null,
  inPlace = false,
): string | null {
  if (routeKey === null) return null;
  if (reveal.observedKey !== routeKey) {
    reveal.observedKey = routeKey;
    reveal.pendingKey = routeKey;
    reveal.pendingInPlace = inPlace;
  }
  return reveal.pendingKey;
}

export function completeSidebarRouteReveal(reveal: SidebarRouteReveal): void {
  reveal.pendingKey = null;
}

export function useActiveRowReveal(
  reveal: SidebarRouteReveal,
  routeKey: string | null,
  inPlace = false,
) {
  const mountRevealOwed = useRef(true);
  pendingSidebarRouteReveal(reveal, routeKey, inPlace);
  const revealRow = (row: HTMLElement | null, rowKey: string): (() => void) | undefined => {
    if (row === null) return undefined;
    if (reveal.pendingKey !== rowKey && !mountRevealOwed.current) return undefined;
    if (row.getClientRects().length === 0) {
      const stopWaiting = observeResize(row, () => {
        if (row.getClientRects().length === 0) return;
        stopWaiting();
        revealRow(row, rowKey);
      });
      return stopWaiting;
    }
    const revealInPlace = reveal.pendingKey === rowKey && reveal.pendingInPlace === true;
    completeSidebarRouteReveal(reveal);
    mountRevealOwed.current = false;
    if (revealInPlace || row.matches(":hover")) return undefined;
    row.scrollIntoView({ block: "nearest" });
    return undefined;
  };
  return revealRow;
}

type RevealableThread = Parameters<typeof filterSidebarV2VisibleThreads>[0][number];

export function resolveSidebarRouteReveal<T extends RevealableThread>(input: {
  readonly reveal: SidebarRouteReveal;
  readonly routeKey: string | null;
  readonly routeKeyInPlace: boolean;
  readonly scopedProjectKeys: ReadonlySet<string> | null;
  readonly findThread: (key: string) => T | undefined;
}): { readonly pendingKey: string | null; readonly widensScope: boolean } {
  const { reveal, routeKey, scopedProjectKeys, findThread } = input;
  const pendingKey = pendingSidebarRouteReveal(reveal, routeKey, input.routeKeyInPlace);
  const thread = pendingKey === null ? undefined : findThread(pendingKey);
  const widensScope =
    thread !== undefined &&
    scopedProjectKeys !== null &&
    filterSidebarV2VisibleThreads([thread], scopedProjectKeys).length === 0 &&
    filterSidebarV2VisibleThreads([thread], null).length === 1;
  return { pendingKey, widensScope };
}

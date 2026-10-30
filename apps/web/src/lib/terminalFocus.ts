import { scopedThreadKey } from "@supaterm/client-runtime/environment";
import type { ScopedThreadRef } from "@supaterm/contracts";

import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";

import { isPaneInputOwner } from "../chatPanes/paneScope";
import { useChatPaneStore } from "../chatPanes/store";

function currentPaneId(): string | null {
  return useChatPaneStore.getState().layout?.focusedPaneId ?? null;
}

export type TerminalFocusOwner = "drawer" | "right-panel";

export function getTerminalFocusOwner(): TerminalFocusOwner | null {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return null;
  if (!activeElement.isConnected) return null;
  const owner = activeElement.closest<HTMLElement>("[data-terminal-owner]")?.dataset.terminalOwner;
  if (owner === "drawer" || owner === "right-panel") return owner;
  return null;
}

export function isTerminalFocused(): boolean {
  return getTerminalFocusOwner() !== null;
}

interface TerminalFocusTarget {
  readonly threadRef: ScopedThreadRef;
  readonly terminalId: string;
  readonly paneId: string | null;
  readonly focus: () => boolean;
}

const focusTargets = new Set<TerminalFocusTarget>();
let pendingFocus: {
  readonly threadKey: string;
  readonly terminalId: string;
  readonly paneId: string | null;
} | null = null;
const enteredThreads = new Map<string | null, string>();
const navigationRequests = new Map<string | null, string>();

function isPending(threadKey: string, terminalId: string, paneId: string | null): boolean {
  return (
    pendingFocus?.threadKey === threadKey &&
    pendingFocus.terminalId === terminalId &&
    pendingFocus.paneId === paneId
  );
}

function focusMountedTarget(threadKey: string, terminalId: string, paneId: string | null): boolean {
  if (!isPaneInputOwner(paneId)) return false;
  for (const target of focusTargets) {
    if (
      target.paneId === paneId &&
      target.terminalId === terminalId &&
      scopedThreadKey(target.threadRef) === threadKey &&
      target.focus()
    ) {
      return true;
    }
  }
  return false;
}

export function focusTerminal(
  threadRef: ScopedThreadRef,
  terminalId: string,
  paneId: string | null = currentPaneId(),
): void {
  const threadKey = scopedThreadKey(threadRef);
  pendingFocus = focusMountedTarget(threadKey, terminalId, paneId)
    ? null
    : { threadKey, terminalId, paneId };
}

export function focusActiveDrawerTerminal(
  threadRef: ScopedThreadRef,
  paneId: string | null = currentPaneId(),
): void {
  const { terminalOpen, activeTerminalId } = selectThreadTerminalUiState(
    useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
    threadRef,
  );
  if (terminalOpen && activeTerminalId) focusTerminal(threadRef, activeTerminalId, paneId);
  else cancelTerminalFocus(threadRef, paneId);
}

export function focusActivePanelTerminal(
  threadRef: ScopedThreadRef,
  paneId: string | null = currentPaneId(),
): void {
  const { isOpen, activeSurfaceId, surfaces } = selectThreadRightPanelState(
    useRightPanelStore.getState().byThreadKey,
    threadRef,
  );
  const surface = isOpen ? surfaces.find((candidate) => candidate.id === activeSurfaceId) : null;
  if (surface?.kind === "terminal") focusTerminal(threadRef, surface.activeTerminalId, paneId);
}

export function focusPanelTerminalAfterClose(
  threadRef: ScopedThreadRef,
  previousActiveSurfaceId: string | null,
  paneId: string | null = currentPaneId(),
): void {
  const { activeSurfaceId } = selectThreadRightPanelState(
    useRightPanelStore.getState().byThreadKey,
    threadRef,
  );
  if (activeSurfaceId !== previousActiveSurfaceId) focusActivePanelTerminal(threadRef, paneId);
}

export function focusTerminalOnNavigation(
  threadRef: ScopedThreadRef,
  terminalId: string,
  paneId: string | null = currentPaneId(),
): void {
  const threadKey = scopedThreadKey(threadRef);
  if (threadKey !== enteredThreads.get(paneId)) navigationRequests.set(paneId, threadKey);
  focusTerminal(threadRef, terminalId, paneId);
}

export function focusTerminalOnThreadEnter(
  threadRef: ScopedThreadRef,
  paneId: string | null = currentPaneId(),
): () => void {
  const threadKey = scopedThreadKey(threadRef);
  const requestedByHandler = navigationRequests.get(paneId) === threadKey;
  navigationRequests.delete(paneId);
  enteredThreads.set(paneId, threadKey);
  if (!requestedByHandler && isPaneInputOwner(paneId)) {
    const { terminalOpen, activeTerminalId } = selectThreadTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
      threadRef,
    );
    if (terminalOpen && activeTerminalId) focusTerminal(threadRef, activeTerminalId, paneId);
  }
  return () => {
    if (enteredThreads.get(paneId) === threadKey) enteredThreads.delete(paneId);
  };
}

function cancelTerminalFocus(threadRef: ScopedThreadRef, paneId: string | null): void {
  if (pendingFocus?.threadKey === scopedThreadKey(threadRef) && pendingFocus.paneId === paneId)
    pendingFocus = null;
}

export function consumePendingTerminalFocus(
  threadRef: ScopedThreadRef,
  terminalId: string,
  paneId: string | null,
): void {
  const threadKey = scopedThreadKey(threadRef);
  if (
    isPending(threadKey, terminalId, paneId) &&
    focusMountedTarget(threadKey, terminalId, paneId)
  ) {
    pendingFocus = null;
  }
}

export function registerTerminalFocusTarget(target: TerminalFocusTarget): () => void {
  focusTargets.add(target);
  if (
    isPending(scopedThreadKey(target.threadRef), target.terminalId, target.paneId) &&
    isPaneInputOwner(target.paneId) &&
    target.focus()
  ) {
    pendingFocus = null;
  }
  return () => {
    focusTargets.delete(target);
  };
}

export function focusTerminalViewport(input: {
  readonly mount: HTMLElement;
  readonly surface: { focus(): void } | null;
  readonly canOperate: boolean;
  readonly visible: boolean;
  readonly paneId: string | null;
}): boolean {
  if (!input.canOperate || !input.visible || !isPaneInputOwner(input.paneId)) return false;
  input.mount.focus({ preventScroll: true });
  input.surface?.focus();
  return input.mount.contains(document.activeElement);
}

import { scopedThreadKey } from "@supaterm/client-runtime/environment";
import type { ScopedThreadRef } from "@supaterm/contracts";

import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";

export type TerminalFocusOwner = "drawer" | "right-panel";

export function getTerminalFocusOwner() {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return null;
  if (!activeElement.isConnected) return null;
  const owner = activeElement.closest<HTMLElement>("[data-terminal-owner]")?.dataset.terminalOwner;
  if (owner === "drawer" || owner === "right-panel") return owner;
  return null;
}

export function isTerminalFocused() {
  return getTerminalFocusOwner() !== null;
}

export function subscribeToTerminalFocusChanges(listener: () => void) {
  window.addEventListener("focusin", listener, true);
  window.addEventListener("focusout", listener, true);
  return () => {
    window.removeEventListener("focusin", listener, true);
    window.removeEventListener("focusout", listener, true);
  };
}

interface TerminalFocusTarget {
  readonly threadRef: ScopedThreadRef;
  readonly terminalId: string;
  readonly element?: HTMLElement;
  /** Returns false when the target cannot take focus yet (hidden, or no operate grant). */
  readonly focus: () => boolean;
}

const focusTargets = new Set<TerminalFocusTarget>();
const lastThreadFocus = new Map<string, "composer" | { terminalId: string }>();
let pendingFocus: { readonly threadKey: string; readonly terminalId: string } | null = null;
let enteredThreadKey: string | null = null;
const lastEnteredThreadByRoot = new WeakMap<HTMLElement, string>();
let navigationRequestThreadKey: string | null = null;

function isPending(threadKey: string, terminalId: string) {
  return pendingFocus?.threadKey === threadKey && pendingFocus.terminalId === terminalId;
}

function focusMountedTarget(threadKey: string, terminalId: string) {
  for (const target of focusTargets) {
    if (
      target.terminalId === terminalId &&
      scopedThreadKey(target.threadRef) === threadKey &&
      target.focus()
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Focuses a thread's terminal when its viewport can take focus, or once it can.
 * Opening, creating or switching to a terminal usually mounts or shows its
 * viewport after the handler returns, so the request waits for the viewport.
 */
export function focusTerminal(threadRef: ScopedThreadRef, terminalId: string) {
  const threadKey = scopedThreadKey(threadRef);
  pendingFocus = focusMountedTarget(threadKey, terminalId) ? null : { threadKey, terminalId };
}

/**
 * Focuses the drawer terminal the store now marks active, after an open, close
 * or switch. A thread whose drawer ended up closed drops its waiting request.
 */
export function focusActiveDrawerTerminal(threadRef: ScopedThreadRef) {
  const { terminalOpen, activeTerminalId } = selectThreadTerminalUiState(
    useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
    threadRef,
  );
  if (terminalOpen && activeTerminalId) focusTerminal(threadRef, activeTerminalId);
  else cancelTerminalFocus(threadRef);
}

/** Focuses the active terminal of the right panel when it shows a terminal surface. */
export function focusActivePanelTerminal(threadRef: ScopedThreadRef) {
  const { isOpen, activeSurfaceId, surfaces } = selectThreadRightPanelState(
    useRightPanelStore.getState().byThreadKey,
    threadRef,
  );
  const surface = isOpen ? surfaces.find((candidate) => candidate.id === activeSurfaceId) : null;
  if (surface?.kind === "terminal") focusTerminal(threadRef, surface.activeTerminalId);
}

/**
 * After a right panel surface closes, focuses the terminal surface the panel
 * fell back to. A terminal surface that was already active keeps its focus as is.
 */
export function focusPanelTerminalAfterClose(
  threadRef: ScopedThreadRef,
  previousActiveSurfaceId: string | null,
) {
  const { activeSurfaceId } = selectThreadRightPanelState(
    useRightPanelStore.getState().byThreadKey,
    threadRef,
  );
  if (activeSurfaceId !== previousActiveSurfaceId) focusActivePanelTerminal(threadRef);
}

/**
 * Focuses a terminal from a handler that may also navigate to its thread (a
 * sidebar terminal reveal). When it does, that thread's entry keeps this request
 * instead of focusing the drawer.
 */
export function focusTerminalOnNavigation(threadRef: ScopedThreadRef, terminalId: string) {
  const threadKey = scopedThreadKey(threadRef);
  navigationRequestThreadKey = threadKey === enteredThreadKey ? null : threadKey;
  focusTerminal(threadRef, terminalId);
}

/** Restores composer or terminal focus; explicit terminal navigation takes precedence. */
export function restoreFocusOnThreadEnter(
  threadRef: ScopedThreadRef,
  content: {
    readonly root: HTMLElement;
    readonly focusComposer: () => void;
    /** False for a split pane that does not own input: it only remembers focus. */
    readonly restoresFocus?: boolean;
  },
) {
  const threadKey = scopedThreadKey(threadRef);
  const restoresFocus = content.restoresFocus ?? true;
  const requestedByHandler =
    navigationRequestThreadKey === threadKey ||
    (lastEnteredThreadByRoot.get(content.root) === threadKey &&
      pendingFocus?.threadKey === threadKey);
  lastEnteredThreadByRoot.set(content.root, threadKey);
  if (restoresFocus) {
    if (!requestedByHandler) pendingFocus = null;
    navigationRequestThreadKey = null;
    enteredThreadKey = threadKey;
  }
  const previous = lastThreadFocus.get(threadKey);
  const remember = () => {
    const element = content.root.ownerDocument.activeElement;
    if (!element) return;
    const terminal = Array.from(focusTargets).find((target) => target.element?.contains(element));
    if (terminal) {
      if (scopedThreadKey(terminal.threadRef) === threadKey)
        lastThreadFocus.set(threadKey, { terminalId: terminal.terminalId });
    } else if (
      content.root.contains(element) &&
      element.closest('[data-workspace-area="composer"]')
    ) {
      lastThreadFocus.set(threadKey, "composer");
    }
  };
  content.root.ownerDocument.addEventListener("focusin", remember);
  if (restoresFocus && !requestedByHandler) {
    const drawer = selectThreadTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
      threadRef,
    );
    const panel = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef);
    const panelTerminal = panel.isOpen
      ? panel.surfaces.find((surface) => surface.id === panel.activeSurfaceId)
      : null;
    if (previous === "composer") {
      content.focusComposer();
    } else if (
      previous &&
      ((drawer.terminalOpen &&
        drawer.terminalGroups
          .find((group) => group.id === drawer.activeTerminalGroupId)
          ?.terminalIds.includes(previous.terminalId)) ||
        (panelTerminal?.kind === "terminal" &&
          panelTerminal.terminalIds.includes(previous.terminalId)))
    ) {
      focusTerminal(threadRef, previous.terminalId);
    } else if (drawer.terminalOpen && drawer.activeTerminalId) {
      focusTerminal(threadRef, drawer.activeTerminalId);
    } else content.focusComposer();
  }
  if (restoresFocus && requestedByHandler) remember();
  return () => {
    content.root.ownerDocument.removeEventListener("focusin", remember);
    if (restoresFocus && enteredThreadKey === threadKey) enteredThreadKey = null;
  };
}

function cancelTerminalFocus(threadRef: ScopedThreadRef) {
  if (pendingFocus?.threadKey === scopedThreadKey(threadRef)) pendingFocus = null;
}

/**
 * Retries a waiting request once a mounted viewport can take it: when it is
 * shown (a viewport kept mounted while hidden has `display: none`) or when the
 * operate grant arrives. Neither ever invents a request.
 */
export function consumePendingTerminalFocus(threadRef: ScopedThreadRef, terminalId: string) {
  const threadKey = scopedThreadKey(threadRef);
  if (isPending(threadKey, terminalId) && focusMountedTarget(threadKey, terminalId)) {
    pendingFocus = null;
  }
}

export function registerTerminalFocusTarget(target: TerminalFocusTarget) {
  focusTargets.add(target);
  if (isPending(scopedThreadKey(target.threadRef), target.terminalId) && target.focus()) {
    pendingFocus = null;
  }
  return () => {
    focusTargets.delete(target);
  };
}

/**
 * A viewport's `focus` for its target. Focus lands on the mount until the
 * surface exists, and the surface takes it over from there.
 */
export function focusTerminalViewport(input: {
  readonly mount: HTMLElement;
  readonly surface: { focus(): void } | null;
  readonly canOperate: boolean;
  readonly visible: boolean;
}) {
  if (!input.canOperate || !input.visible) return false;
  input.mount.focus({ preventScroll: true });
  input.surface?.focus();
  return input.mount.contains(document.activeElement);
}

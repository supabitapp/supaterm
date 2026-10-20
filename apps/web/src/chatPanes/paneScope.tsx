import { useNavigate } from "@tanstack/react-router";
import { createContext, use, type ReactNode } from "react";

import type { ComposerHandleRef } from "../composerHandleContext";
import type { ChatComposerHandle } from "../components/chat/ChatComposer";
import { useChatPaneStore } from "./store";
import { buildThreadRouteParams, type ThreadRouteTarget } from "../threadRoutes";

export interface PaneScope {
  readonly paneId: string;
  /** Changes whenever the pane moves or resizes, for surfaces positioned in window coordinates. */
  readonly layoutVersion: string;
  /** The pane is narrower than the right panel's inline layout needs. */
  readonly narrow: boolean;
  /** The workspace is too small for the split, so only this, the focused pane, shows. */
  readonly collapsed: boolean;
}

const PaneScopeContext = createContext<PaneScope | null>(null);

export function PaneScopeProvider(props: {
  readonly value: PaneScope;
  readonly children: ReactNode;
}) {
  return <PaneScopeContext value={props.value}>{props.children}</PaneScopeContext>;
}

export function usePaneScope(): PaneScope | null {
  return use(PaneScopeContext);
}

export function usePaneLayoutVersion(): string | null {
  return use(PaneScopeContext)?.layoutVersion ?? null;
}

/**
 * Whether a pane receives window-level keyboard, paste, and menu input. Outside
 * a split every pane does; inside one only the focused pane does, so a shortcut
 * or a digit key never acts in two threads at once.
 */
export function isPaneInputOwner(paneId: string | null): boolean {
  if (paneId === null) return true;
  const layout = useChatPaneStore.getState().layout;
  return layout === null || layout.cells.length < 2 || layout.focusedPaneId === paneId;
}

/** A stable check for listeners, read when the event arrives rather than when it was registered. */
export function usePaneInputOwner(): () => boolean {
  const paneId = use(PaneScopeContext)?.paneId ?? null;
  return () => isPaneInputOwner(paneId);
}

export function useIsPaneInputOwner(): boolean {
  const paneId = use(PaneScopeContext)?.paneId ?? null;
  return useChatPaneStore((state) => {
    if (paneId === null || state.layout === null || state.layout.cells.length < 2) return true;
    return state.layout.focusedPaneId === paneId;
  });
}

/**
 * Opens a thread from work a pane started, such as a send, a fork, or a saved edit. Work that
 * finishes after the user moved to another pane changes its own pane instead of replacing the
 * thread the user is now in.
 */
export function usePaneThreadNavigation() {
  const paneId = use(PaneScopeContext)?.paneId ?? null;
  const navigate = useNavigate();
  return async (target: ThreadRouteTarget, options?: { readonly replace?: boolean }) => {
    if (!isPaneInputOwner(paneId)) {
      useChatPaneStore.getState().retarget(paneId!, target);
      return;
    }
    const replace = options?.replace ?? false;
    if (target.kind === "server") {
      await navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(target.threadRef),
        replace,
      });
    } else {
      await navigate({ to: "/draft/$draftId", params: { draftId: target.draftId }, replace });
    }
  };
}

const paneComposers = new Map<string, ComposerHandleRef>();

export function registerPaneComposer(paneId: string, ref: ComposerHandleRef): () => void {
  paneComposers.set(paneId, ref);
  return () => {
    if (paneComposers.get(paneId) === ref) paneComposers.delete(paneId);
  };
}

export function focusPaneComposer(paneId: string) {
  paneComposers.get(paneId)?.current?.focusAtEnd();
}

/**
 * The command palette's composer handle. It resolves to the focused pane's
 * composer, so palette actions and focus restoration land in the thread the
 * user is working in.
 */
export function createFocusedComposerRef(): ComposerHandleRef {
  let fallback: ChatComposerHandle | null = null;
  return {
    get current() {
      const layout = useChatPaneStore.getState().layout;
      const focused = layout ? paneComposers.get(layout.focusedPaneId) : undefined;
      return focused?.current ?? fallback;
    },
    set current(handle) {
      fallback = handle;
    },
  };
}

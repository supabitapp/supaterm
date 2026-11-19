import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeThreadRef,
} from "@supaterm/client-runtime/environment";
import type { ScopedThreadRef } from "@supaterm/contracts";
import { useNavigate } from "@tanstack/react-router";
import { use, useEffect, useState } from "react";
import { BackgroundThreadContext } from "./chat/backgroundThread";

import ChatView from "./ChatView";
import { waitForDraftHeroTransition } from "./chat/draftHeroTransition";
import { ThreadTimelineLoading } from "./chat/ThreadTimelineLoading";
import { isPaneInputOwner } from "../chatPanes/paneScope";
import { useChatPaneStore } from "../chatPanes/store";
import {
  resolveDraftPromotionNavigationTarget,
  useComposerDraftStore,
} from "../composerDraftStore";
import { useSidebarPendingFileDropStore } from "../sidebarPendingFileDropStore";
import { useEnvironmentThreadRefs, useQuietThreadShell } from "../state/entities";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { useEnvironmentShellStatus } from "../state/shell";
import { threadFamilies } from "../state/threads";
import { usePendingThreadCreation, useThreadOutboxLoaded } from "../state/threadOutbox";
import { useThreadState } from "../state/entities";
import {
  buildThreadRouteParams,
  isThreadRouteSnapshotAuthoritative,
  resolveThreadRouteRenderState,
  type ThreadRouteTarget,
} from "../threadRoutes";

function useOpenThreadFamily(threadRef: ScopedThreadRef | null, missing: boolean) {
  const key = threadRef === null ? null : scopedThreadKey(threadRef);
  const [mountedKey, setMountedKey] = useState<string | null>(null);
  const nextKey = missing || mountedKey === key ? key : null;
  if (nextKey !== mountedKey) setMountedKey(nextKey);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- holds the open thread's family in the thread family registry until the route leaves it
  useEffect(() => {
    const ref = mountedKey === null ? null : parseScopedThreadKey(mountedKey);
    if (ref === null) return;
    return threadFamilies.mount(appAtomRegistry, ref.environmentId, ref.threadId);
  }, [mountedKey]);
}

/**
 * Unkeyed, and rendered from the `_chat` layout rather than the leaf routes, so navigating between
 * server threads reuses one ChatView instance. Draft promotion runs in the draft store; this only
 * follows the redirect it leaves behind. Only the focused pane follows the URL; a background pane
 * changes its own thread, so a draft promoting behind the user never moves the URL.
 */
export function ThreadRouteView({ target, paneId }: { target: ThreadRouteTarget; paneId: string }) {
  const navigate = useNavigate();
  const background = use(BackgroundThreadContext);
  const draftId = target.kind === "draft" ? target.draftId : null;
  const draftSession = useComposerDraftStore((store) =>
    draftId === null ? null : store.getDraftSession(draftId),
  );
  const draftRedirect = useComposerDraftStore((store) =>
    draftId === null ? null : store.getPromotedDraftRedirect(draftId),
  );
  const draftThreadRef = draftSession
    ? (draftSession.promotedTo ?? scopeThreadRef(draftSession.environmentId, draftSession.threadId))
    : null;
  const serverThreadRef = target.kind === "server" ? target.threadRef : null;
  const serverThreadShell = useQuietThreadShell(serverThreadRef);
  const pendingCreation = usePendingThreadCreation(serverThreadRef ?? draftThreadRef);
  const outboxLoaded = useThreadOutboxLoaded();
  const pendingRedirect =
    draftSession && pendingCreation && !pendingCreation.payload.background
      ? resolveDraftPromotionNavigationTarget({
          serverThreadRef: null,
          serverThread: null,
          pendingThreadRef: scopeThreadRef(
            pendingCreation.payload.environmentId,
            pendingCreation.payload.input.threadId,
          ),
        })
      : null;
  const redirectTarget: ScopedThreadRef | null =
    target.kind !== "draft" ? null : draftSession ? pendingRedirect : draftRedirect;

  const shellStatus = useEnvironmentShellStatus(serverThreadRef?.environmentId ?? null);
  const environmentThreadRefs = useEnvironmentThreadRefs(serverThreadRef?.environmentId ?? null);
  const bootstrapComplete = isThreadRouteSnapshotAuthoritative(shellStatus);
  const draftThread = useComposerDraftStore((store) =>
    serverThreadRef ? store.getDraftThreadByRef(serverThreadRef) : null,
  );
  const serverThreadDraftId = useComposerDraftStore((store) =>
    serverThreadRef ? store.getDraftIdByRef(serverThreadRef) : null,
  );
  const [handoffKey, setHandoffKey] = useState<{ threadKey: string; key: string } | null>(null);
  const nextHandoffKey =
    draftId !== null && draftSession === null && draftRedirect
      ? handoffKey?.key === draftId
        ? handoffKey
        : { threadKey: scopedThreadKey(draftRedirect), key: draftId }
      : serverThreadRef && handoffKey?.threadKey === scopedThreadKey(serverThreadRef)
        ? handoffKey
        : serverThreadRef && serverThreadDraftId
          ? { threadKey: scopedThreadKey(serverThreadRef), key: serverThreadDraftId }
          : null;
  if (nextHandoffKey !== handoffKey) {
    setHandoffKey(nextHandoffKey);
  }
  const environmentHasDraftThreads = useComposerDraftStore((store) =>
    serverThreadRef ? store.hasDraftThreadsInEnvironment(serverThreadRef.environmentId) : false,
  );
  const unlistedThreadRef =
    target.kind === "server" && serverThreadShell === null && draftThread === null
      ? target.threadRef
      : null;
  const unlistedThreadDetail = useThreadState(unlistedThreadRef);
  useOpenThreadFamily(serverThreadRef, bootstrapComplete && unlistedThreadRef !== null);
  const renderState = resolveThreadRouteRenderState({
    bootstrapComplete,
    serverThreadExists: serverThreadShell !== null,
    serverThreadDeleted: serverThreadShell?.deletedAt != null,
    unlistedThreadDetail,
    draftThreadExists: draftThread !== null,
    pendingThreadExists: pendingCreation !== null,
    outboxLoaded,
  });
  const environmentHasAnyThreads = environmentThreadRefs.length > 0 || environmentHasDraftThreads;
  const draftGone = target.kind === "draft" && draftSession === null && draftRedirect === null;

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- moves the URL or this pane's own target, outside React
  useEffect(() => {
    if (background) return;
    if (draftGone) {
      if (useChatPaneStore.getState().close(paneId, { remember: false })) return;
      void navigate({ to: "/", replace: true });
      return;
    }
    if (!redirectTarget) return;
    let cancelled = false;
    void waitForDraftHeroTransition().then(() => {
      if (cancelled) return;
      if (!isPaneInputOwner(paneId)) {
        useChatPaneStore.getState().retarget(paneId, { kind: "server", threadRef: redirectTarget });
        return;
      }
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(redirectTarget),
        replace: true,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [background, draftGone, navigate, paneId, redirectTarget]);

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- clears pending file drops and navigates the router home once a server thread is confirmed missing
  useEffect(() => {
    if (target.kind !== "server" || !bootstrapComplete) {
      return;
    }
    if (renderState === "missing") {
      const { clearPendingFileDropsForThread } = useSidebarPendingFileDropStore.getState();
      clearPendingFileDropsForThread(target.threadRef);
      if (useChatPaneStore.getState().close(paneId, { remember: false })) return;
      if (environmentHasAnyThreads && !background) {
        void navigate({ to: "/", replace: true });
      }
    }
  }, [
    background,
    bootstrapComplete,
    environmentHasAnyThreads,
    navigate,
    paneId,
    renderState,
    target,
  ]);

  let view: React.ReactNode = null;
  if (target.kind === "draft") {
    if (draftSession) {
      view = (
        <ChatView
          key={target.draftId}
          draftId={target.draftId}
          environmentId={draftSession.environmentId}
          threadId={draftSession.threadId}
          routeKind="draft"
          forceExpandedMobileComposer
        />
      );
    } else if (draftRedirect) {
      view = (
        <ChatView
          key={target.draftId}
          environmentId={draftRedirect.environmentId}
          threadId={draftRedirect.threadId}
          routeKind="server"
        />
      );
    }
  } else if (renderState === "ready" || (renderState === "loading" && serverThreadShell !== null)) {
    view = (
      <ChatView
        key={nextHandoffKey?.key}
        environmentId={target.threadRef.environmentId}
        threadId={target.threadRef.threadId}
        routeKind="server"
      />
    );
  } else if (renderState === "loading") {
    view = <ThreadTimelineLoading />;
  }

  return view;
}

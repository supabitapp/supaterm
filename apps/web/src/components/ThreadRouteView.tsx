import { scopedThreadKey, scopeThreadRef } from "@supaterm/client-runtime/environment";
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
import { useEnvironmentShellStatus } from "../state/shell";
import { usePendingThreadCreation, useThreadOutboxLoaded } from "../state/threadOutbox";
import { useThreadState } from "../state/entities";
import {
  buildThreadRouteParams,
  isThreadRouteSnapshotAuthoritative,
  resolveThreadRouteRenderState,
  type ThreadRouteTarget,
} from "../threadRoutes";

/**
 * Unkeyed, and rendered from the `_chat` layout rather than the leaf routes, so navigating between
 * server threads reuses one ChatView instance. Draft promotion runs in the draft store; this only
 * follows the redirect it leaves behind. Only the focused pane follows the URL; a background pane
 * changes its own thread, so a draft promoting behind the user never moves the URL.
 */
export function ThreadRouteView({ target, paneId }: { target: ThreadRouteTarget; paneId: string }) {
  const navigate = useNavigate();
  // Under Settings or Usage the thread stays mounted but must not move the route.
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
  const backgroundSubmissionPending = useComposerDraftStore(
    (store) =>
      draftThreadRef !== null &&
      store.backgroundSubmissionThreadKeys[scopedThreadKey(draftThreadRef)] === true,
  );
  // A send queued while the host is offline opens its thread before the host creates it; the
  // draft stays until the store promotes it.
  const pendingRedirect =
    draftSession && pendingCreation && !pendingCreation.payload.background
      ? resolveDraftPromotionNavigationTarget({
          serverThreadRef: null,
          serverThread: null,
          backgroundSubmissionPending,
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
  // Reached from the sidebar before finalize, the thread still has its draft.
  const serverThreadDraftId = useComposerDraftStore((store) =>
    serverThreadRef ? store.getDraftIdByRef(serverThreadRef) : null,
  );
  // The ChatView that carried a draft keeps its key through the redirect to its thread, and only
  // until the route leaves that thread, so later visits reuse the shared unkeyed ChatView.
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
  // Until the shell lists the thread, its own load (HTTP, then the socket)
  // decides whether it exists. Read only then: once listed, ChatView keeps
  // this stream open and its updates need not re-render the route.
  const unlistedThreadRef =
    target.kind === "server" && serverThreadShell === null && draftThread === null
      ? target.threadRef
      : null;
  const unlistedThreadDetail = useThreadState(unlistedThreadRef);
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

  // oxlint-disable-next-line supaterm/react-effect-budget -- moves the URL or this pane's own target, outside React
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
      // Same slot and key as the server route renders, so the swap keeps this instance.
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

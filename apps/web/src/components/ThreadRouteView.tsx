import { BackgroundThreadContext } from "./chat/backgroundThread";
import { scopedThreadKey } from "@supaterm/client-runtime/environment";
import type { ScopedThreadRef } from "@supaterm/contracts";
import { useNavigate } from "@tanstack/react-router";
import { use, useEffect, useState } from "react";

import ChatView from "./ChatView";
import { ThreadTimelineLoading } from "./chat/ThreadTimelineLoading";
import { isPaneInputOwner } from "../chatPanes/paneScope";
import { useChatPaneStore } from "../chatPanes/store";
import { useComposerDraftStore } from "../composerDraftStore";
import { useSidebarPendingFileDropStore } from "../sidebarPendingFileDropStore";
import { useEnvironmentThreadRefs, useQuietThreadShell } from "../state/entities";
import { useEnvironmentShellStatus } from "../state/shell";
import { usePendingThreadCreation, useThreadOutboxLoaded } from "../state/threadOutbox";
import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import { useThreadState } from "../state/entities";
import {
  buildThreadRouteParams,
  isThreadRouteSnapshotAuthoritative,
  resolveThreadRouteRenderState,
  type ThreadRouteTarget,
} from "../threadRoutes";

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
  const serverThreadRef: ScopedThreadRef | null =
    target.kind === "server" ? target.threadRef : null;
  const serverThread = useQuietThreadShell(serverThreadRef);
  const pendingCreation = usePendingThreadCreation(
    serverThreadRef ??
      (draftSession ? scopeThreadRef(draftSession.environmentId, draftSession.threadId) : null),
  );
  const outboxLoaded = useThreadOutboxLoaded();
  const shellStatus = useEnvironmentShellStatus(serverThreadRef?.environmentId ?? null);
  const serverThreadShell = serverThread;
  const environmentThreadRefs = useEnvironmentThreadRefs(serverThreadRef?.environmentId ?? null);
  const bootstrapComplete = isThreadRouteSnapshotAuthoritative(shellStatus);
  const draftThread = useComposerDraftStore((store) =>
    serverThreadRef ? store.getDraftThreadByRef(serverThreadRef) : null,
  );
  const promotedDraftId = useComposerDraftStore((store) =>
    target.kind === "server" ? store.getDraftIdByRef(target.threadRef) : null,
  );
  // The draft record is removed once the promoted thread has started, which
  // is after the route swap. Latch the key so the element that carried the
  // draft keeps its identity for as long as this thread stays on screen.
  const [chatViewKey, setChatViewKey] = useState<{ threadKey: string; key: string } | null>(null);
  const serverThreadKey = target.kind === "server" ? scopedThreadKey(target.threadRef) : null;
  const nextChatViewKey =
    draftId !== null && draftSession === null && draftRedirect
      ? chatViewKey?.key === draftId
        ? chatViewKey
        : { threadKey: scopedThreadKey(draftRedirect), key: draftId }
      : serverThreadKey === null
        ? null
        : chatViewKey?.threadKey === serverThreadKey
          ? chatViewKey
          : promotedDraftId
            ? { threadKey: serverThreadKey, key: promotedDraftId }
            : null;
  if (nextChatViewKey !== chatViewKey) {
    setChatViewKey(nextChatViewKey);
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

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Apply the draft store's completed promotion redirect to this pane's router target.
  useEffect(() => {
    if (background || target.kind !== "draft" || draftSession || !draftRedirect) return;
    if (!isPaneInputOwner(paneId)) {
      useChatPaneStore.getState().retarget(paneId, { kind: "server", threadRef: draftRedirect });
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(draftRedirect),
      replace: true,
    });
  }, [background, draftRedirect, draftSession, navigate, paneId, target.kind]);

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- redirects the pane and router when its draft target disappears
  useEffect(() => {
    if (background || target.kind !== "draft" || draftSession || draftRedirect) {
      return;
    }
    if (useChatPaneStore.getState().close(paneId, { remember: false })) return;
    void navigate({ to: "/", replace: true });
  }, [background, draftRedirect, draftSession, navigate, paneId, target.kind]);

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- removes an authoritatively missing thread from its mounted pane and browser route
  useEffect(() => {
    if (background || target.kind !== "server" || !bootstrapComplete) {
      return;
    }
    if (renderState === "missing") {
      const { clearPendingFileDropsForThread } = useSidebarPendingFileDropStore.getState();
      clearPendingFileDropsForThread(target.threadRef);
      if (useChatPaneStore.getState().close(paneId, { remember: false })) return;
      if (environmentHasAnyThreads) {
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
        key={nextChatViewKey?.key}
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

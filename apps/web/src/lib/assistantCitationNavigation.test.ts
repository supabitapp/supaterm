import { EnvironmentId, MessageId, ThreadId, type AssistantCitation } from "@supaterm/contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import { describe, expect, it } from "vite-plus/test";

import { findPaneByTarget, type PaneLayoutSize } from "../chatPanes/layout";
import { useChatPaneStore } from "../chatPanes/store";
import {
  assistantCitationFromLocation,
  assistantCitationNavigation,
  revealSideChatCitation,
} from "./assistantCitationNavigation";

const citation: AssistantCitation = {
  version: 1,
  environmentId: EnvironmentId.make("environment-one"),
  threadId: ThreadId.make("thread-one"),
  messageId: MessageId.make("assistant-one"),
  text: "first line\n\tsecond line (with a #hash & spaces) 🚀",
  start: 12,
  end: 59,
  prefix: "Before:\n",
  suffix: "\nAfter.",
};

function createCitationRouter(initialEntry = "/environment-one/thread-one") {
  const root = createRootRoute();
  const thread = createRoute({ getParentRoute: () => root, path: "/$environmentId/$threadId" });
  return createRouter({
    routeTree: root.addChildren([thread]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
}

describe("assistant citation navigation", () => {
  it("preserves encoded quote whitespace through router navigation and reload", async () => {
    const router = createCitationRouter();
    await router.navigate(assistantCitationNavigation(citation, null));

    expect(assistantCitationFromLocation(router.state.location.href)).toEqual(citation);
    let href = router.history.location.href;
    for (let reload = 0; reload < 3; reload++) {
      const reloaded = createCitationRouter(href);
      await reloaded.load();
      await reloaded.navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: citation.environmentId, threadId: citation.threadId },
        hash: true,
        replace: true,
      });
      href = reloaded.history.location.href;
      expect(assistantCitationFromLocation(href)).toEqual(citation);
    }
  });

  it("reactivates an identical citation instead of deduplicating its navigation", async () => {
    const router = createCitationRouter();
    await router.navigate(assistantCitationNavigation(citation, null));
    const previous = router.state.location;
    await router.navigate(assistantCitationNavigation(citation, null));

    expect(router.state.location.href).toBe(previous.href);
    expect(router.state.location.state.assistantCitationActivation).not.toBe(
      previous.state.assistantCitationActivation,
    );
    expect(router.history.length).toBe(3);
    expect(assistantCitationFromLocation(router.state.location.href)).toEqual(citation);
  });

  it("opens a side chat citation on its parent thread with the side chat beside it", async () => {
    resetPanes();
    const router = createCitationRouter("/environment-one/thread-parent");
    await router.navigate(assistantCitationNavigation(sideChatCitation, sideChatShell));
    expect(router.state.location.pathname).toBe("/environment-one/thread-parent");
    await revealAtRoute(router);

    expect(assistantCitationFromLocation(router.state.location.href)).toEqual(sideChatCitation);
    const layout = useChatPaneStore.getState().layout!;
    const parentPane = findPaneByTarget(layout, threadTarget(parentThreadId))!;
    expect(layout.focusedPaneId).toBe(parentPane.id);
    expect(findPaneByTarget(layout, threadTarget(sideChatCitation.threadId))?.sideChatOf).toBe(
      parentPane.id,
    );
  });

  it("shows the quote on the side chat's own route without room beside its parent", async () => {
    resetPanes();
    const router = createCitationRouter("/environment-one/thread-parent");
    await router.navigate(assistantCitationNavigation(sideChatCitation, sideChatShell));
    const activation = router.state.location.state.assistantCitationActivation;
    await revealAtRoute(router, sideChatCitation.threadId, { width: 600, height: 900 });

    expect(router.state.location.pathname).toBe("/environment-one/side-chat-one");
    expect(assistantCitationFromLocation(router.state.location.href)).toEqual(sideChatCitation);
    expect(router.state.location.state.assistantCitationActivation).toBe(activation);
  });

  it("keeps quotes from forks on their own thread", () => {
    const forkShell = { lineage: { ...sideChatShell.lineage, sideChat: false } };

    expect(assistantCitationNavigation(sideChatCitation, forkShell).params.threadId).toBe(
      sideChatCitation.threadId,
    );
  });

  it("leaves an unrelated route alone", async () => {
    resetPanes();
    const router = createCitationRouter("/environment-one/thread-other");
    await router.navigate({
      ...assistantCitationNavigation(sideChatCitation, null),
      params: { environmentId: citation.environmentId, threadId: ThreadId.make("thread-other") },
    });
    await revealAtRoute(router);

    expect(router.state.location.pathname).toBe("/environment-one/thread-other");
    expect(useChatPaneStore.getState().layout?.cells).toHaveLength(1);
  });

  it("ignores a reveal for a side chat the location no longer quotes", async () => {
    resetPanes();
    const router = createCitationRouter("/environment-one/thread-parent");
    await router.navigate(assistantCitationNavigation(sideChatCitation, sideChatShell));
    await revealAtRoute(router, ThreadId.make("side-chat-two"));

    expect(useChatPaneStore.getState().layout?.cells).toHaveLength(1);
  });
});

const parentThreadId = ThreadId.make("thread-parent");
const sideChatCitation = { ...citation, threadId: ThreadId.make("side-chat-one") };
const sideChatShell = {
  lineage: {
    parentThreadId,
    relationshipToParent: "fork" as const,
    rootThreadId: parentThreadId,
    sideChat: true,
  },
};

function threadTarget(threadId: ThreadId) {
  return { kind: "server" as const, threadRef: scopeThreadRef(citation.environmentId, threadId) };
}

function resetPanes() {
  useChatPaneStore.setState({
    layout: null,
    closed: [],
    parkedSideChats: [],
    openToSide: null,
    historyMode: "replace",
  });
}

/** What the routed pane's ChatView does once the side chat shell is known. */
function revealAtRoute(
  router: ReturnType<typeof createCitationRouter>,
  sideChatThreadId = sideChatCitation.threadId,
  workspace: PaneLayoutSize = { width: 1600, height: 900 },
) {
  const { pathname, state } = router.state.location;
  const routeThreadRef = scopeThreadRef(
    citation.environmentId,
    ThreadId.make(pathname.split("/").at(-1) ?? ""),
  );
  useChatPaneStore
    .getState()
    .reconcileRoute({ kind: "server", threadRef: routeThreadRef }, workspace);
  return revealSideChatCitation(
    router,
    routeThreadRef,
    sideChatThreadId,
    parentThreadId,
    state.assistantCitationActivation ?? state.__TSR_key ?? "",
    workspace,
  );
}

import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import { pipe } from "effect/Function";
import type {
  AssistantCitation,
  OrchestrationV2ThreadShell,
  ScopedThreadRef,
  ThreadId,
} from "@supaterm/contracts";
import { useRouter, type AnyRouter } from "@tanstack/react-router";
import {
  formatAssistantCitationHref,
  parseAssistantCitationHref,
} from "@supaterm/shared/assistantCitations";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Result from "effect/Result";
import { useEffect } from "react";

import type { PaneLayoutSize } from "../chatPanes/layout";
import { workspaceSize } from "../chatPanes/paneDrop";
import { useChatPaneStore } from "../chatPanes/store";
import { useQuietThreadShell } from "~/state/entities";
import { randomUUID } from "./utils";

declare module "@tanstack/react-router" {
  interface HistoryState {
    assistantCitationActivation?: string;
  }
}

const CITATION_HASH_PREFIX = "assistant-citation=";

/** Base64url keeps router hash normalization from decoding quote whitespace or source IDs. */
function assistantCitationHash(citation: AssistantCitation) {
  return `${CITATION_HASH_PREFIX}${Base64Url.encode(formatAssistantCitationHref(citation))}`;
}

export function assistantCitationFromLocation(href: string) {
  const hashIndex = href.indexOf("#");
  if (hashIndex === -1) return null;
  const hash = href.slice(hashIndex + 1);
  if (!hash.startsWith(CITATION_HASH_PREFIX) || hash.length > 140_000) return null;
  try {
    return pipe(
      hash.slice(CITATION_HASH_PREFIX.length),
      Base64Url.decodeString,
      Result.getOrThrow,
      parseAssistantCitationHref,
    );
  } catch {
    return null;
  }
}

/** Return paths drop the quote hash so going back does not reveal its source again. */
export function withoutAssistantCitationHash(href: string) {
  const hashIndex = href.indexOf("#");
  if (hashIndex === -1 || !href.startsWith(CITATION_HASH_PREFIX, hashIndex + 1)) return href;
  return href.slice(0, hashIndex);
}

type SourceThread = Pick<OrchestrationV2ThreadShell, "lineage"> | null;

function sideChatParentId(sourceThread: SourceThread) {
  return sourceThread?.lineage.sideChat ? sourceThread.lineage.parentThreadId : null;
}

/** Side chat quotes open on their parent thread, with the side chat beside it. */
export function assistantCitationRoute(citation: AssistantCitation, sourceThread: SourceThread) {
  return {
    to: "/$environmentId/$threadId" as const,
    params: {
      environmentId: citation.environmentId,
      threadId: sideChatParentId(sourceThread) ?? citation.threadId,
    },
    hash: assistantCitationHash(citation),
    resetScroll: false,
  };
}

/** A fresh activation lets the same link reveal its source again after dismissal. */
export function assistantCitationNavigation(
  citation: AssistantCitation,
  sourceThread: SourceThread,
) {
  return {
    ...assistantCitationRoute(citation, sourceThread),
    state: { assistantCitationActivation: randomUUID() },
  };
}

/**
 * Shows the location's side chat quote beside `parentThreadId`, whose route it is on; the side
 * chat's pane reveals it. Without room there, the side chat's own route shows it instead.
 */
export function revealSideChatCitation(
  router: Pick<AnyRouter, "navigate" | "state">,
  routeThreadRef: ScopedThreadRef,
  sideChatThreadId: ThreadId,
  parentThreadId: ThreadId,
  activation: string,
  workspace: PaneLayoutSize | null,
) {
  const { location } = router.state;
  const citation = assistantCitationFromLocation(location.href);
  if (
    citation === null ||
    citation.threadId !== sideChatThreadId ||
    citation.environmentId !== routeThreadRef.environmentId ||
    routeThreadRef.threadId !== parentThreadId
  ) {
    return;
  }
  const shown = useChatPaneStore.getState().showSideChatBesideParent(
    {
      parent: { kind: "server", threadRef: routeThreadRef },
      sideChat: {
        kind: "server",
        threadRef: scopeThreadRef(citation.environmentId, citation.threadId),
      },
    },
    workspace,
  );
  if (shown) return;
  return router.navigate({
    to: "/$environmentId/$threadId",
    params: { environmentId: citation.environmentId, threadId: citation.threadId },
    hash: true,
    state: (state) => ({ ...state, assistantCitationActivation: activation }),
    replace: true,
    resetScroll: false,
  });
}

export function useSideChatCitationReveal(
  routeThreadRef: ScopedThreadRef | null,
  citation: AssistantCitation | null,
  activation: string,
) {
  const router = useRouter();
  const sourceRef =
    routeThreadRef && citation?.environmentId === routeThreadRef.environmentId
      ? scopeThreadRef(citation.environmentId, citation.threadId)
      : null;
  const parentThreadId = sideChatParentId(useQuietThreadShell(sourceRef));
  const environmentId = routeThreadRef?.environmentId;
  const threadId = routeThreadRef?.threadId;
  const sideChatThreadId = sourceRef?.threadId;
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- places a side chat quote's pane beside its parent once per activation, including after its shell loads
  useEffect(() => {
    if (
      environmentId === undefined ||
      threadId === undefined ||
      sideChatThreadId === undefined ||
      parentThreadId === null
    ) {
      return;
    }
    void revealSideChatCitation(
      router,
      scopeThreadRef(environmentId, threadId),
      sideChatThreadId,
      parentThreadId,
      activation,
      workspaceSize(),
    );
  }, [router, environmentId, threadId, sideChatThreadId, parentThreadId, activation]);
}

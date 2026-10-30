import type {
  OrchestrationThreadSearchMatch,
  OrchestrationV2SearchThreadResult,
  ScopedThreadRef,
} from "@supaterm/contracts";
import { scopedThreadKey } from "@supaterm/client-runtime/environment";
import {
  findSearchTokenRanges,
  messagePhrase,
  messageSearchTokens,
} from "@supaterm/shared/paletteSearch";
import { create } from "zustand";
import { useChatPaneStore } from "../../chatPanes/store";
import type { ThreadFindPositionReader, ThreadFindStart } from "./threadFind";

export interface ThreadFindLocalSelection {
  readonly base: OrchestrationV2SearchThreadResult;
  readonly baseNavigationId: number;
  readonly activeIndex: number;
  readonly match: NonNullable<OrchestrationV2SearchThreadResult["match"]>;
  readonly navigationId: number;
}

/** Find is open in at most one thread: the one the chat view shows. */
export interface ThreadFindState {
  readonly threadKey: string | null;
  readonly query: string;
  readonly offset: number;
  readonly start: ThreadFindStart | undefined;
  readonly focusRequestId: number;
  readonly navigationId: number;
  readonly requestId: number;
  readonly localSelection: ThreadFindLocalSelection | null;
}

export const CLOSED_THREAD_FIND: ThreadFindState = {
  threadKey: null,
  query: "",
  offset: 0,
  start: undefined,
  focusRequestId: 0,
  navigationId: 0,
  requestId: 0,
  localSelection: null,
};

const makeStore = () => create<ThreadFindState>(() => CLOSED_THREAD_FIND);
export const useThreadFindStore = makeStore();
const scopedStores = new Map<string, ReturnType<typeof makeStore>>();
export function currentThreadFindScope(): string {
  return useChatPaneStore.getState().layout?.focusedPaneId ?? "root";
}
export function getThreadFindStore(scope = currentThreadFindScope()) {
  if (scope === "root") return useThreadFindStore;
  let store = scopedStores.get(scope);
  if (!store) {
    store = makeStore();
    scopedStores.set(scope, store);
  }
  return store;
}
interface ThreadFindTimeline {
  readonly threadKey: string;
  readonly readPosition: ThreadFindPositionReader;
}
const attachedTimelines = new Map<string, ThreadFindTimeline>();
export function attachThreadFindTimeline(
  timeline: ThreadFindTimeline,
  scope = currentThreadFindScope(),
): () => void {
  attachedTimelines.set(scope, timeline);
  return () => {
    if (attachedTimelines.get(scope) === timeline) attachedTimelines.delete(scope);
  };
}
function timelineFor(threadKey: string, scope: string): ThreadFindTimeline | null {
  const timeline = attachedTimelines.get(scope);
  return timeline?.threadKey === threadKey ? timeline : null;
}
export function openFocusedThreadFind(): void {
  const scope = currentThreadFindScope();
  const timeline = attachedTimelines.get(scope);
  if (timeline) openThreadFind(timeline.threadKey, scope);
}

function readThreadFindPosition(
  threadKey: string,
  query: string,
  scope: string,
): ThreadFindStart | undefined {
  return timelineFor(threadKey, scope)?.readPosition(query);
}

/** Opens find, or refocuses it and restarts its search from the viewport when already open. */
export function openThreadFind(threadKey: string, scope = currentThreadFindScope()): void {
  const previous = getThreadFindStore(scope).getState();
  const current = previous.threadKey === threadKey ? previous : CLOSED_THREAD_FIND;
  const query = current.query.trim();
  const start = query ? readThreadFindPosition(threadKey, query, scope) : undefined;
  getThreadFindStore(scope).setState({
    ...current,
    threadKey,
    focusRequestId: previous.focusRequestId + 1,
    ...(query
      ? {
          start,
          offset: 0,
          localSelection: null,
          navigationId: current.navigationId + 1,
          requestId: current.navigationId + 1,
        }
      : {}),
  });
}

export interface PendingThreadFind {
  readonly query: string;
  /** Where find starts, such as the message a palette result came from. */
  readonly start?: ThreadFindStart;
}

/**
 * Opens find on `query` in the thread, such as at the message a search result
 * came from. The thread's view shows it once it is on screen.
 */
export function openThreadFindOnQuery(
  threadKey: string,
  find: PendingThreadFind,
  scope = currentThreadFindScope(),
): void {
  const previous = getThreadFindStore(scope).getState();
  getThreadFindStore(scope).setState({
    ...(previous.threadKey === threadKey ? previous : CLOSED_THREAD_FIND),
    threadKey,
    query: find.query,
    offset: 0,
    start: find.start,
    localSelection: null,
    focusRequestId: previous.focusRequestId + 1,
    navigationId: previous.navigationId + 1,
    requestId: previous.navigationId + 1,
  });
}

export function setThreadFindQuery(
  threadKey: string,
  query: string,
  scope = currentThreadFindScope(),
): void {
  const start = readThreadFindPosition(threadKey, query.trim(), scope);
  getThreadFindStore(scope).setState((previous) => ({
    query,
    offset: 0,
    start,
    localSelection: null,
    navigationId: previous.navigationId + 1,
    requestId: previous.navigationId + 1,
  }));
}

export function closeThreadFind(scope = currentThreadFindScope()): void {
  getThreadFindStore(scope).setState(CLOSED_THREAD_FIND);
}

/**
 * Find belongs to the thread it was opened in: a route showing anything else
 * closes it. Settings and Usage draw over the thread, so they keep it.
 */
export function retainThreadFindForRoute(route: {
  readonly modalPage: boolean;
  readonly threadRef: ScopedThreadRef | null;
}): void {
  if (route.modalPage) return;
  const scope = currentThreadFindScope();
  const { threadKey } = getThreadFindStore(scope).getState();
  const shownKey = route.threadRef ? scopedThreadKey(route.threadRef) : null;
  if (threadKey !== null && threadKey !== shownKey) closeThreadFind(scope);
}

/** Whether find is open in `thread`, as long as find is available there. */
export function useThreadFindOpen(thread: ScopedThreadRef | null, enabled: boolean): boolean {
  const openThreadKey = getThreadFindStore()((state) => state.threadKey);
  return enabled && thread !== null && openThreadKey === scopedThreadKey(thread);
}

/**
 * The find a message search result opens, at the matched message: the whole
 * query when the snippet holds it as typed ("vp run dev"), else its longest
 * word, as the most telling ("sidebar" in "fix sidebar"), written as the
 * snippet writes it ("Café" for "cafe", since find matches accents).
 */
export function findForMessageMatch(
  match: Pick<OrchestrationThreadSearchMatch, "snippet" | "messageId">,
  query: string,
): PendingThreadFind {
  const start = match.messageId ? { start: { entryId: match.messageId, occurrence: 0 } } : {};
  // Apostrophes are straight in the query; straightening keeps offsets.
  const together = messagePhrase(query)?.exec(match.snippet.replace(/[\u2018\u2019]/g, "'"));
  if (together) {
    return {
      query: match.snippet.slice(together.index, together.index + together[0].length),
      ...start,
    };
  }
  const word =
    messageSearchTokens(query).long.reduce(
      (longest, token) => (token.length > longest.length ? token : longest),
      "",
    ) || query;
  const ranges = findSearchTokenRanges(match.snippet, word);
  // A whole word first, as search ranked it: "Café", not "Cafe" in "Cafeteria".
  const shown =
    ranges.find((range) => !/[\p{L}\p{N}]/u.test(match.snippet[range.end] ?? "")) ?? ranges[0];
  return { query: shown ? match.snippet.slice(shown.start, shown.end) : word, ...start };
}

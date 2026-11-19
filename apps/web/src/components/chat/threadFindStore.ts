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
import type { ThreadFindPositionReader, ThreadFindStart } from "./threadFind";
import { registerThreadOverlay } from "./threadOverlayRetention";

export interface ThreadFindLocalSelection {
  readonly base: OrchestrationV2SearchThreadResult;
  readonly baseNavigationId: number;
  readonly activeIndex: number;
  readonly match: NonNullable<OrchestrationV2SearchThreadResult["match"]>;
  readonly navigationId: number;
}

export interface ThreadFindState {
  readonly query: string;
  readonly offset: number;
  readonly start: ThreadFindStart | undefined;
  readonly focusRequestId: number;
  readonly navigationId: number;
  readonly requestId: number;
  readonly localSelection: ThreadFindLocalSelection | null;
}

export const CLOSED_THREAD_FIND: ThreadFindState = {
  query: "",
  offset: 0,
  start: undefined,
  focusRequestId: 0,
  navigationId: 0,
  requestId: 0,
  localSelection: null,
};

/** Each thread with find open, by thread key: split panes show several threads, each with its own find. */
export const useThreadFindStore = create<{ readonly finds: ReadonlyMap<string, ThreadFindState> }>(
  () => ({ finds: new Map() }),
);

function threadFind(threadKey: string) {
  return useThreadFindStore.getState().finds.get(threadKey);
}

function writeThreadFind(threadKey: string, find: ThreadFindState) {
  useThreadFindStore.setState((state) => ({ finds: new Map(state.finds).set(threadKey, find) }));
}

/** What find needs from the timeline that shows a thread. */
interface ThreadFindTimeline {
  readonly threadKey: string;
  readonly readPosition: ThreadFindPositionReader;
  /** Opening find is manual navigation: it releases live follow. */
  readonly navigate: () => void;
}

const attachedTimelines = new Map<string, ThreadFindTimeline>();

function timelineFor(threadKey: string) {
  return attachedTimelines.get(threadKey) ?? null;
}

/** Attaches the timeline showing a thread; returns the detach. */
export function attachThreadFindTimeline(timeline: ThreadFindTimeline) {
  attachedTimelines.set(timeline.threadKey, timeline);
  return () => {
    if (attachedTimelines.get(timeline.threadKey) === timeline) {
      attachedTimelines.delete(timeline.threadKey);
    }
  };
}

function readThreadFindPosition(threadKey: string, query: string) {
  return timelineFor(threadKey)?.readPosition(query);
}

function announceOpening(threadKey: string) {
  if (threadFind(threadKey) === undefined) timelineFor(threadKey)?.navigate();
}

/** Opens find, or refocuses it and restarts its search from the viewport when already open. */
export function openThreadFind(threadKey: string) {
  const current = threadFind(threadKey) ?? CLOSED_THREAD_FIND;
  const query = current.query.trim();
  const start = query ? readThreadFindPosition(threadKey, query) : undefined;
  announceOpening(threadKey);
  writeThreadFind(threadKey, {
    ...current,
    focusRequestId: current.focusRequestId + 1,
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
export function openThreadFindOnQuery(threadKey: string, find: PendingThreadFind) {
  const previous = threadFind(threadKey) ?? CLOSED_THREAD_FIND;
  announceOpening(threadKey);
  writeThreadFind(threadKey, {
    ...previous,
    query: find.query,
    offset: 0,
    start: find.start,
    localSelection: null,
    focusRequestId: previous.focusRequestId + 1,
    navigationId: previous.navigationId + 1,
    requestId: previous.navigationId + 1,
  });
}

/** Updates the thread's find while it is open. */
export function updateThreadFind(
  threadKey: string,
  update: (previous: ThreadFindState) => ThreadFindState,
) {
  const previous = threadFind(threadKey);
  if (previous !== undefined) writeThreadFind(threadKey, update(previous));
}

export function setThreadFindQuery(threadKey: string, query: string) {
  const start = readThreadFindPosition(threadKey, query.trim());
  updateThreadFind(threadKey, (previous) => ({
    ...previous,
    query,
    offset: 0,
    start,
    localSelection: null,
    navigationId: previous.navigationId + 1,
    requestId: previous.navigationId + 1,
  }));
}

export function closeThreadFind(threadKey: string) {
  useThreadFindStore.setState((state) => {
    if (!state.finds.has(threadKey)) return state;
    const finds = new Map(state.finds);
    finds.delete(threadKey);
    return { finds };
  });
}

registerThreadOverlay((shownThreadKeys) => {
  const { finds } = useThreadFindStore.getState();
  const shown = [...finds].filter(([threadKey]) => shownThreadKeys.has(threadKey));
  if (shown.length !== finds.size) useThreadFindStore.setState({ finds: new Map(shown) });
});

/** Whether find is open in `thread`, as long as find is available there. */
export function useThreadFindOpen(thread: ScopedThreadRef | null, enabled: boolean) {
  const threadKey = thread ? scopedThreadKey(thread) : null;
  const open = useThreadFindStore((state) => threadKey !== null && state.finds.has(threadKey));
  return enabled && open;
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
) {
  const start = match.messageId ? { start: { entryId: match.messageId, occurrence: 0 } } : {};
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
  const shown =
    ranges.find((range) => !/[\p{L}\p{N}]/u.test(match.snippet[range.end] ?? "")) ?? ranges[0];
  return { query: shown ? match.snippet.slice(shown.start, shown.end) : word, ...start };
}

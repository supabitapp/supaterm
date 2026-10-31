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

function threadFind(threadKey: string): ThreadFindState | undefined {
  return useThreadFindStore.getState().finds.get(threadKey);
}

function writeThreadFind(threadKey: string, find: ThreadFindState | null): void {
  useThreadFindStore.setState((state) => {
    if (find === null && !state.finds.has(threadKey)) return state;
    const finds = new Map(state.finds);
    if (find === null) finds.delete(threadKey);
    else finds.set(threadKey, find);
    return { finds };
  });
}

/** What find needs from the timeline that shows a thread. */
interface ThreadFindTimeline {
  readonly threadKey: string;
  readonly readPosition: ThreadFindPositionReader;
  /** Opening find is manual navigation: it releases live follow. */
  readonly navigate: () => void;
}

// Split panes mount one timeline per pane, so each shown thread keeps its own.
const attachedTimelines = new Map<string, ThreadFindTimeline>();

function timelineFor(threadKey: string): ThreadFindTimeline | null {
  return attachedTimelines.get(threadKey) ?? null;
}

/** Attaches the timeline showing a thread; returns the detach. */
export function attachThreadFindTimeline(timeline: ThreadFindTimeline): () => void {
  attachedTimelines.set(timeline.threadKey, timeline);
  return () => {
    if (attachedTimelines.get(timeline.threadKey) === timeline) {
      attachedTimelines.delete(timeline.threadKey);
    }
  };
}

function readThreadFindPosition(threadKey: string, query: string): ThreadFindStart | undefined {
  return timelineFor(threadKey)?.readPosition(query);
}

/**
 * Navigates the timeline showing the thread when find newly opens there. A
 * timeline that starts showing the thread later (a search result opened find
 * before the route switched or the thread painted) releases follow itself as
 * it opens on the thread.
 */
function announceOpening(threadKey: string): void {
  if (threadFind(threadKey) === undefined) timelineFor(threadKey)?.navigate();
}

/** Opens find, or refocuses it and restarts its search from the viewport when already open. */
export function openThreadFind(threadKey: string): void {
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
export function openThreadFindOnQuery(threadKey: string, find: PendingThreadFind): void {
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
): void {
  const previous = threadFind(threadKey);
  if (previous !== undefined) writeThreadFind(threadKey, update(previous));
}

export function setThreadFindQuery(threadKey: string, query: string): void {
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

export function closeThreadFind(threadKey: string): void {
  writeThreadFind(threadKey, null);
}

registerThreadOverlay((shownThreadKeys) => {
  const { finds } = useThreadFindStore.getState();
  const shown = [...finds].filter(([threadKey]) => shownThreadKeys.has(threadKey));
  if (shown.length !== finds.size) useThreadFindStore.setState({ finds: new Map(shown) });
});

/** Whether find is open in `thread`, as long as find is available there. */
export function useThreadFindOpen(thread: ScopedThreadRef | null, enabled: boolean): boolean {
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

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { useLayoutEffect } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  RunId,
  ThreadId,
  type OrchestrationV2SearchThreadInput,
  type OrchestrationV2SearchThreadResult,
} from "@supaterm/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@supaterm/shared/keybindings";
import { act, fakeTimers, render } from "../../../test/render";
import { PaneScopeProvider, usePaneInputOwner } from "../../chatPanes/paneScope";
import { useChatPaneStore } from "../../chatPanes/store";
import { useChatShortcuts } from "./useChatShortcuts";
import { startThreadOverlayRetention } from "./threadOverlayRetention";
import { useThreadFind } from "./useThreadFind";
import { orchestrationEnvironment } from "~/state/orchestration";
import { scopedThreadKey } from "@supaterm/client-runtime/environment";
import type { ThreadFindPositionReader } from "./threadFind";
import {
  attachThreadFindTimeline,
  closeThreadFind,
  openThreadFind,
  useThreadFindStore,
} from "./threadFindStore";

const queries = vi.hoisted(() => ({
  results: new Map<string, OrchestrationV2SearchThreadResult>(),
  pending: false,
  refresh: vi.fn(),
}));
vi.mock("~/state/orchestration", () => ({
  orchestrationEnvironment: {
    threadFindProgressive: vi.fn(
      (input: { environmentId: EnvironmentId; input: OrchestrationV2SearchThreadInput }) => input,
    ),
    threadFind: vi.fn(
      (input: { environmentId: EnvironmentId; input: OrchestrationV2SearchThreadInput }) => input,
    ),
  },
}));
vi.mock("~/state/queries", () => ({ useDebouncedValue: <T,>(value: T) => value }));
const threadDetail = vi.hoisted(() => ({
  content: undefined as { visibleTurnItems: []; runs: [] } | undefined,
}));
vi.mock("~/state/entities", () => ({
  useThreadProjection: (ref: unknown) =>
    ref === null || threadDetail.content === undefined
      ? null
      : { projection: threadDetail.content },
}));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: (atom: { environmentId: EnvironmentId } | null) => ({
    data: atom === null ? null : (queries.results.get(atom.environmentId) ?? null),
    isPending: queries.pending,
    error: null,
    refresh: queries.refresh,
  }),
}));

vi.mock("../ui/toast", () => ({ toastManager: { add: vi.fn() } }));

let find: ReturnType<typeof useThreadFind>;
let shownThreadKey = "";
let readPosition: ThreadFindPositionReader | null = null;
const a = EnvironmentId.make("environment:a");
const b = EnvironmentId.make("environment:b");
const threadId = ThreadId.make("shared-thread");
const runId = RunId.make("run:plan");
function Probe({
  environmentId,
  enabled = true,
  progressive = false,
}: {
  environmentId: EnvironmentId;
  enabled?: boolean;
  progressive?: boolean;
}) {
  const state = useThreadFind({
    thread: { environmentId, threadId },
    enabled,
    progressive,
  });
  const threadKey = scopedThreadKey({ environmentId, threadId });
  useLayoutEffect(() => {
    find = state;
    shownThreadKey = threadKey;
  });
  useLayoutEffect(
    () =>
      attachThreadFindTimeline({
        threadKey,
        readPosition: (query) => readPosition?.(query),
        navigate: () => {},
      }),
    [threadKey],
  );
  return null;
}
const openFind = () => openThreadFind(shownThreadKey);
function setup() {
  queries.results.clear();
  queries.pending = false;
  threadDetail.content = undefined;
  readPosition = null;
  useThreadFindStore.setState({ finds: new Map() });
  vi.clearAllMocks();
}

describe("V2 find state", () => {
  function messageResult(index: number, snapshotSequence = 9): OrchestrationV2SearchThreadResult {
    return {
      snapshotSequence,
      totalMatches: 10,
      activeIndex: index,
      match: { entryId: `message:${index + 2}`, runId, occurrence: 0 },
    };
  }

  it("reveals an early match and updates its count without requesting another jump", async () => {
    setup();
    await using screen = await render(<Probe environmentId={a} progressive />);
    await act(async () => openFind());
    await act(async () => find.barProps.onQueryChange("needle"));
    const partial: OrchestrationV2SearchThreadResult = {
      complete: false,
      snapshotSequence: 9,
      totalMatches: 1,
      activeIndex: 0,
      match: { entryId: "early", runId, occurrence: 2 },
    };
    queries.pending = true;
    queries.results.set(a, partial);
    await screen.rerender(<Probe environmentId={a} progressive />);
    expect(find.barProps.counting).toBe(true);
    expect(find.barProps.status).toBeNull();
    expect(find.timelineProps.activeFindMatch).toEqual(partial.match);
    const match = find.timelineProps.activeFindMatch;
    const navigationId = find.timelineProps.findNavigationId;
    const requests = vi.mocked(orchestrationEnvironment.threadFindProgressive).mock.calls.length;
    await act(async () => {
      find.barProps.onNext();
      find.barProps.onPrevious();
    });
    expect(orchestrationEnvironment.threadFindProgressive).toHaveBeenCalledTimes(requests);
    queries.results.set(a, { ...partial, complete: true, totalMatches: 123, activeIndex: 42 });
    await screen.rerender(<Probe environmentId={a} progressive />);
    expect(find.barProps.counting).toBe(false);
    expect(find.barProps.matchCount).toBe(123);
    expect(find.barProps.activeIndex).toBe(42);
    expect(find.timelineProps.activeFindMatch).toBe(match);
    expect(find.timelineProps.findNavigationId).toBe(navigationId);
    expect(orchestrationEnvironment.threadFind).not.toHaveBeenCalled();
    queries.pending = false;
    await screen.rerender(<Probe environmentId={a} progressive />);
    await act(async () => find.barProps.onNext());
    expect(orchestrationEnvironment.threadFindProgressive).toHaveBeenCalledTimes(requests + 1);
  });

  it("coalesces incoming pages until the progressive scan finishes", async () => {
    setup();
    using _timers = fakeTimers();
    queries.pending = true;
    await using screen = await render(<Probe environmentId={a} progressive />);
    await act(async () => openFind());
    await act(async () => find.barProps.onQueryChange("needle"));
    queries.results.set(a, { ...messageResult(0), complete: false, totalMatches: 1 });
    threadDetail.content = { visibleTurnItems: [], runs: [] };
    await screen.rerender(<Probe environmentId={a} progressive />);
    const requests = vi.mocked(orchestrationEnvironment.threadFindProgressive).mock.calls.length;
    await act(async () => vi.advanceTimersByTime(300));
    expect(orchestrationEnvironment.threadFindProgressive).toHaveBeenCalledTimes(requests);
    expect(queries.refresh).not.toHaveBeenCalled();
    queries.results.set(a, messageResult(0));
    queries.pending = false;
    await screen.rerender(<Probe environmentId={a} progressive />);
    expect(orchestrationEnvironment.threadFindProgressive).toHaveBeenCalledTimes(requests + 1);
    expect(orchestrationEnvironment.threadFindProgressive).toHaveBeenLastCalledWith({
      environmentId: a,
      input: {
        threadId,
        query: "needle",
        skills: [],
        start: { entryId: "message:2", occurrence: 0 },
      },
    });
    expect(find.timelineProps.activeFindMatch?.entryId).toBe("message:2");
  });

  it("requests a fresh jump when the same search wraps to the same match from a new position", async () => {
    setup();
    queries.results.set(a, messageResult(0));
    await using _screen = await render(<Probe environmentId={a} />);
    await act(async () => openFind());
    readPosition = () => ({
      entryId: "reading",
      occurrence: 0,
    });
    await act(async () => find.barProps.onQueryChange("COD4"));
    const firstNavigationId = find.timelineProps.findNavigationId;
    const firstMatch = find.timelineProps.activeFindMatch;
    readPosition = () => ({ entryId: "bottom", occurrence: 0 });
    await act(async () => find.barProps.onQueryChange("COD4"));
    expect(find.timelineProps.findNavigationId).toBeGreaterThan(firstNavigationId);
    expect(find.timelineProps.activeFindMatch).toEqual(firstMatch);
    expect(orchestrationEnvironment.threadFind).toHaveBeenLastCalledWith({
      environmentId: a,
      input: { threadId, query: "COD4", skills: [], start: { entryId: "bottom", occurrence: 0 } },
    });
    const repeatedNavigationId = find.timelineProps.findNavigationId;
    readPosition = () => ({
      entryId: "new-bottom",
      occurrence: 0,
    });
    await act(async () => openFind());
    expect(find.timelineProps.findNavigationId).toBeGreaterThan(repeatedNavigationId);
    expect(find.timelineProps.activeFindMatch).toEqual(firstMatch);
    expect(orchestrationEnvironment.threadFind).toHaveBeenLastCalledWith({
      environmentId: a,
      input: {
        threadId,
        query: "COD4",
        skills: [],
        start: { entryId: "new-bottom", occurrence: 0 },
      },
    });
  });

  it("cycles cached entries immediately, wraps, and accumulates clicks in one event", async () => {
    setup();
    const initial = {
      ...messageResult(0),
      totalMatches: 5,
      match: { entryId: "first", runId, occurrence: 0 },
      navigation: [
        { entryId: "first", runId, startIndex: 0, count: 3 },
        { entryId: "second", runId, startIndex: 3, count: 2 },
      ],
    };
    queries.results.set(a, initial);
    await using _screen = await render(<Probe environmentId={a} />);
    await act(async () => openFind());
    await act(async () => find.barProps.onQueryChange("COD4"));
    const requests = vi.mocked(orchestrationEnvironment.threadFind).mock.calls.length;
    await act(async () => {
      find.barProps.onNext();
      find.barProps.onNext();
    });
    expect(find.barProps.activeIndex).toBe(2);
    expect(find.timelineProps.activeFindMatch).toEqual({ entryId: "first", runId, occurrence: 2 });
    expect(find.timelineProps.findNavigationId).toBe(3);
    await act(async () => find.barProps.onNext());
    expect(find.timelineProps.activeFindMatch).toEqual({ entryId: "second", runId, occurrence: 0 });
    await act(async () => {
      find.barProps.onNext();
      find.barProps.onNext();
    });
    expect(find.barProps.activeIndex).toBe(0);
    await act(async () => find.barProps.onPrevious());
    expect(find.barProps.activeIndex).toBe(4);
    expect(find.timelineProps.activeFindMatch).toEqual({ entryId: "second", runId, occurrence: 1 });
    expect(orchestrationEnvironment.threadFind).toHaveBeenCalledTimes(requests);
    expect(queries.refresh).not.toHaveBeenCalled();
  });

  it("does not let an older background response undo a cached step", async () => {
    setup();
    const initial = {
      ...messageResult(0),
      match: { entryId: "first", runId, occurrence: 0 },
      navigation: [{ entryId: "first", runId, startIndex: 0, count: 3 }],
    };
    queries.results.set(a, initial);
    await using screen = await render(<Probe environmentId={a} />);
    await act(async () => openFind());
    await act(async () => find.barProps.onQueryChange("COD4"));
    const requests = vi.mocked(orchestrationEnvironment.threadFind).mock.calls.length;
    await act(async () => find.barProps.onNext());
    queries.results.set(a, {
      ...initial,
      snapshotSequence: 10,
      totalMatches: 11,
      activeIndex: 1,
      navigation: [{ entryId: "first", runId, startIndex: 1, count: 3 }],
    });
    await screen.rerender(<Probe environmentId={a} />);
    expect(find.timelineProps.activeFindMatch).toEqual({ entryId: "first", runId, occurrence: 1 });
    expect(find.barProps.activeIndex).toBe(2);
    expect(find.barProps.matchCount).toBe(11);
    expect(find.timelineProps.findNavigationId).toBe(2);
    await act(async () => find.barProps.onNext());
    expect(find.timelineProps.activeFindMatch?.occurrence).toBe(2);
    expect(find.barProps.activeIndex).toBe(3);
    expect(orchestrationEnvironment.threadFind).toHaveBeenCalledTimes(requests);
  });

  it("fetches the next window from the locally selected match and retains it while pending", async () => {
    setup();
    const initial = {
      ...messageResult(0),
      match: { entryId: "first", runId, occurrence: 0 },
      navigation: [{ entryId: "first", runId, startIndex: 0, count: 2 }],
    };
    queries.results.set(a, initial);
    await using screen = await render(<Probe environmentId={a} />);
    await act(async () => openFind());
    await act(async () => find.barProps.onQueryChange("COD4"));
    await act(async () => find.barProps.onNext());
    expect(find.timelineProps.activeFindMatch?.occurrence).toBe(1);
    queries.pending = true;
    queries.results.delete(a);
    await act(async () => {
      find.barProps.onNext();
      find.barProps.onNext();
    });
    expect(orchestrationEnvironment.threadFind).toHaveBeenLastCalledWith({
      environmentId: a,
      input: {
        threadId,
        query: "COD4",
        skills: [],
        start: { entryId: "first", occurrence: 1 },
        offset: 2,
      },
    });
    expect(find.barProps.activeIndex).toBe(1);
    expect(find.timelineProps.findNavigationId).toBe(2);
    queries.pending = false;
    queries.results.set(a, messageResult(3));
    await screen.rerender(<Probe environmentId={a} />);
    expect(find.barProps.activeIndex).toBe(3);
    expect(find.timelineProps.findNavigationId).toBe(4);
  });

  it("refreshes around the cached selection when live matches are inserted before it", async () => {
    setup();
    using _timers = fakeTimers();
    const initial = {
      ...messageResult(0),
      match: { entryId: "first", runId, occurrence: 0 },
      navigation: [
        { entryId: "first", runId, startIndex: 0, count: 1 },
        { entryId: "second", runId, startIndex: 1, count: 1 },
      ],
    };
    queries.results.set(a, initial);
    await using screen = await render(<Probe environmentId={a} />);
    await act(async () => openFind());
    await act(async () => find.barProps.onQueryChange("COD4"));
    await act(async () => find.barProps.onNext());
    expect(find.timelineProps.activeFindMatch?.entryId).toBe("second");
    threadDetail.content = { runs: [], visibleTurnItems: [] };
    await screen.rerender(<Probe environmentId={a} />);
    await act(async () => vi.advanceTimersByTime(300));
    expect(orchestrationEnvironment.threadFind).toHaveBeenLastCalledWith({
      environmentId: a,
      input: { threadId, query: "COD4", skills: [], start: { entryId: "second", occurrence: 0 } },
    });
    queries.results.set(a, {
      ...initial,
      snapshotSequence: 10,
      totalMatches: 11,
      activeIndex: 2,
      match: { entryId: "second", runId, occurrence: 0 },
      navigation: [
        { entryId: "inserted", runId, startIndex: 1, count: 1 },
        { entryId: "second", runId, startIndex: 2, count: 1 },
      ],
    });
    await screen.rerender(<Probe environmentId={a} />);
    expect(find.barProps.matchCount).toBe(11);
    expect(find.barProps.activeIndex).toBe(2);
    expect(find.timelineProps.activeFindMatch?.entryId).toBe("second");
    expect(find.timelineProps.findNavigationId).toBe(2);
    await act(async () => find.barProps.onPrevious());
    expect(find.timelineProps.activeFindMatch?.entryId).toBe("inserted");
  });

  it("asks the server rather than using stale navigation counts during live updates", async () => {
    setup();
    const initial = {
      ...messageResult(0),
      navigation: [{ entryId: "message:2", runId, startIndex: 0, count: 10 }],
    };
    queries.results.set(a, initial);
    await using screen = await render(<Probe environmentId={a} />);
    await act(async () => openFind());
    await act(async () => find.barProps.onQueryChange("COD4"));
    threadDetail.content = { runs: [], visibleTurnItems: [] };
    await screen.rerender(<Probe environmentId={a} />);
    await act(async () => find.barProps.onNext());
    expect(orchestrationEnvironment.threadFind).toHaveBeenLastCalledWith({
      environmentId: a,
      input: {
        threadId,
        query: "COD4",
        skills: [],
        start: { entryId: "message:2", occurrence: 0 },
        offset: 1,
      },
    });
  });

  it("starts from the viewport and steps from the server-selected match", async () => {
    setup();
    queries.results.set(a, messageResult(4));
    await using _screen = await render(<Probe environmentId={a} />);
    await act(async () => openFind());
    readPosition = () => ({
      entryId: "message:6",
      occurrence: 1,
    });
    await act(async () => find.barProps.onQueryChange("COD4"));
    expect(orchestrationEnvironment.threadFind).toHaveBeenLastCalledWith({
      environmentId: a,
      input: {
        threadId,
        query: "COD4",
        skills: [],
        start: { entryId: "message:6", occurrence: 1 },
      },
    });
    expect(find.barProps.activeIndex).toBe(4);
    queries.results.set(a, messageResult(5));
    await act(async () => find.barProps.onNext());
    expect(orchestrationEnvironment.threadFind).toHaveBeenLastCalledWith({
      environmentId: a,
      input: {
        threadId,
        query: "COD4",
        skills: [],
        start: { entryId: "message:6", occurrence: 0 },
        offset: 1,
      },
    });
    expect(find.timelineProps.activeFindMatch?.entryId).toBe("message:7");
    queries.results.set(a, messageResult(4));
    await act(async () => find.barProps.onPrevious());
    expect(find.barProps.activeIndex).toBe(4);
    expect(orchestrationEnvironment.threadFind).toHaveBeenLastCalledWith({
      environmentId: a,
      input: {
        threadId,
        query: "COD4",
        skills: [],
        start: { entryId: "message:7", occurrence: 0 },
        offset: -1,
      },
    });
  });

  it("accumulates rapid navigation against the same match until the response arrives", async () => {
    setup();
    queries.results.set(a, messageResult(4));
    await using screen = await render(<Probe environmentId={a} />);
    await act(async () => openFind());
    await act(async () => find.barProps.onQueryChange("COD4"));
    queries.pending = true;
    queries.results.delete(a);
    await act(async () => find.barProps.onNext());
    await act(async () => find.barProps.onNext());
    expect(orchestrationEnvironment.threadFind).toHaveBeenLastCalledWith({
      environmentId: a,
      input: {
        threadId,
        query: "COD4",
        skills: [],
        start: { entryId: "message:6", occurrence: 0 },
        offset: 2,
      },
    });
    expect(find.timelineProps.findNavigationId).toBe(1);
    queries.pending = false;
    queries.results.set(a, messageResult(6));
    await screen.rerender(<Probe environmentId={a} />);
    expect(find.timelineProps.findNavigationId).toBe(3);
    expect(find.barProps.activeIndex).toBe(6);
  });

  it("refreshes continuous updates without shifting the current match or showing Searching", async () => {
    setup();
    using _timers = fakeTimers();
    queries.results.set(a, messageResult(4));
    await using screen = await render(<Probe environmentId={a} />);
    await act(async () => openFind());
    await act(async () => find.barProps.onQueryChange("COD4"));
    for (let i = 0; i < 3; i++) {
      threadDetail.content = { visibleTurnItems: [], runs: [] };
      await screen.rerender(<Probe environmentId={a} />);
      await act(async () => vi.advanceTimersByTime(100));
    }
    expect(orchestrationEnvironment.threadFind).toHaveBeenLastCalledWith({
      environmentId: a,
      input: {
        threadId,
        query: "COD4",
        skills: [],
        start: { entryId: "message:6", occurrence: 0 },
      },
    });
    const updated = { ...messageResult(5, 10), totalMatches: 11, match: messageResult(4).match };
    queries.results.set(a, updated);
    threadDetail.content = undefined;
    await screen.rerender(<Probe environmentId={a} />);
    expect(find.barProps.matchCount).toBe(11);
    expect(find.barProps.activeIndex).toBe(5);
    expect(find.timelineProps.activeFindMatch?.entryId).toBe("message:6");
    expect(find.timelineProps.findNavigationId).toBe(1);
    expect(find.barProps.status).toBeNull();
    await act(async () => find.barProps.onNext());
    expect(orchestrationEnvironment.threadFind).toHaveBeenLastCalledWith({
      environmentId: a,
      input: {
        threadId,
        query: "COD4",
        skills: [],
        start: { entryId: "message:6", occurrence: 0 },
        offset: 1,
      },
    });
  });

  it("keeps pending navigation when incoming content triggers a refresh", async () => {
    setup();
    using _timers = fakeTimers();
    queries.results.set(a, messageResult(4));
    await using screen = await render(<Probe environmentId={a} />);
    await act(async () => openFind());
    await act(async () => find.barProps.onQueryChange("COD4"));
    queries.pending = true;
    queries.results.delete(a);
    await act(async () => find.barProps.onNext());
    threadDetail.content = { visibleTurnItems: [], runs: [] };
    await screen.rerender(<Probe environmentId={a} />);
    await act(async () => vi.advanceTimersByTime(300));
    expect(queries.refresh).toHaveBeenCalledTimes(1);
    expect(orchestrationEnvironment.threadFind).toHaveBeenLastCalledWith({
      environmentId: a,
      input: {
        threadId,
        query: "COD4",
        skills: [],
        start: { entryId: "message:6", occurrence: 0 },
        offset: 1,
      },
    });
    queries.pending = false;
    queries.results.set(a, { ...messageResult(6, 10), totalMatches: 11 });
    threadDetail.content = undefined;
    await screen.rerender(<Probe environmentId={a} />);
    expect(find.timelineProps.activeFindMatch?.entryId).toBe("message:8");
    expect(find.timelineProps.findNavigationId).toBe(2);
    expect(find.barProps.matchCount).toBe(11);
  });

  it("does not navigate the previous result while a new match is loading", async () => {
    setup();
    queries.results.set(a, messageResult(0));
    await using screen = await render(<Probe environmentId={a} />);
    await act(async () => openFind());
    await act(async () => find.barProps.onQueryChange("COD4"));
    queries.pending = true;
    queries.results.delete(a);
    await act(async () => find.barProps.onNext());
    expect(find.timelineProps.activeFindMatch?.entryId).toBe("message:2");
    expect(find.timelineProps.findNavigationId).toBe(1);
    expect(find.barProps.status).toBeNull();
    expect(find.barProps.activeIndex).toBe(0);
    expect(find.barProps.matchCount).toBe(10);
    queries.pending = false;
    queries.results.set(a, messageResult(1));
    await screen.rerender(<Probe environmentId={a} />);
    expect(find.timelineProps.activeFindMatch?.entryId).toBe("message:3");
    expect(find.timelineProps.findNavigationId).toBe(2);
  });

  it("keeps the reading-position start when Enter is pressed before results arrive", async () => {
    setup();
    queries.pending = true;
    await using _screen = await render(<Probe environmentId={a} />);
    await act(async () => openFind());
    readPosition = () => ({
      entryId: "message:6",
      occurrence: 1,
    });
    await act(async () => find.barProps.onQueryChange("COD4"));
    await act(async () => find.barProps.onNext());
    expect(orchestrationEnvironment.threadFind).toHaveBeenLastCalledWith({
      environmentId: a,
      input: {
        threadId,
        query: "COD4",
        skills: [],
        start: { entryId: "message:6", occurrence: 1 },
      },
    });
  });

  it("shows Searching only when the query has no result yet", async () => {
    setup();
    queries.pending = true;
    await using screen = await render(<Probe environmentId={a} />);
    await act(async () => openFind());
    await act(async () => find.barProps.onQueryChange("COD4"));
    expect(find.barProps.status).toBe("loading");
    queries.pending = false;
    queries.results.set(a, messageResult(0));
    await screen.rerender(<Probe environmentId={a} />);
    expect(find.barProps.status).toBeNull();
    queries.pending = true;
    queries.results.delete(a);
    await act(async () => find.barProps.onQueryChange("different query"));
    expect(find.barProps.status).toBe("loading");
    expect(find.barProps.matchCount).toBe(0);

    expect(find.timelineProps.findQuery).toBe("");
    expect(find.timelineProps.findExpanded).toBe(true);
    await act(async () => find.barProps.onQueryChange(""));
    expect(find.timelineProps.findExpanded).toBe(false);
  });

  it("keeps search unavailable when the server does not support it", async () => {
    setup();
    await using _screen = await render(<Probe environmentId={a} enabled={false} />);
    await act(async () => {
      openFind();
      openFind();
    });
    expect(find.barProps.open).toBe(false);
    expect(find.timelineProps.activeFindMatch).toBeNull();
    expect(orchestrationEnvironment.threadFind).not.toHaveBeenCalled();
  });

  it("hides search while support is gone and shows the same find when it returns", async () => {
    setup();
    await using screen = await render(<Probe environmentId={a} />);
    await act(async () => openFind());
    await act(async () => find.barProps.onQueryChange("needle"));
    expect(find.barProps.open).toBe(true);
    vi.mocked(orchestrationEnvironment.threadFind).mockClear();
    await screen.rerender(<Probe environmentId={a} enabled={false} />);
    expect(find.barProps.open).toBe(false);
    expect(find.timelineProps.activeFindMatch).toBeNull();
    expect(find.timelineProps.findQuery).toBe("");
    expect(orchestrationEnvironment.threadFind).not.toHaveBeenCalled();
    await screen.rerender(<Probe environmentId={a} />);
    expect(find.barProps.open).toBe(true);
    expect(find.barProps.query).toBe("needle");
  });

  it("preserves plan item ID and run ownership for navigation", async () => {
    setup();
    queries.results.set(a, {
      snapshotSequence: 9,
      totalMatches: 1,
      activeIndex: 0,
      match: { entryId: "plan-item", runId, occurrence: 0 },
    });
    await using _screen = await render(<Probe environmentId={a} />);
    await act(async () => {
      openFind();
    });
    await act(async () => {
      find.barProps.onQueryChange("needle");
    });
    expect(find.timelineProps.activeFindMatch).toEqual({
      entryId: "plan-item",
      runId,
      occurrence: 0,
    });
    await act(async () => {
      closeThreadFind(shownThreadKey);
    });
    expect(find.timelineProps.activeFindMatch).toBeNull();
    expect(find.timelineProps.findQuery).toBe("");
  });

  it("drops results on environment changes even when the thread IDs are identical", async () => {
    setup();
    queries.results.set(a, {
      snapshotSequence: 1,
      totalMatches: 3,
      activeIndex: 0,
      match: null,
    });
    queries.results.set(b, {
      snapshotSequence: 2,
      totalMatches: 0,
      activeIndex: 0,
      match: null,
    });
    await using screen = await render(<Probe environmentId={a} />);
    await act(async () => {
      openFind();
    });
    await act(async () => {
      find.barProps.onQueryChange("needle");
    });
    expect(find.barProps.matchCount).toBe(3);
    await screen.rerender(<Probe environmentId={b} />);
    expect(find.barProps.open).toBe(false);
    expect(find.timelineProps.activeFindMatch).toBeNull();
    await act(async () => {
      openFind();
    });
    await act(async () => {
      find.barProps.onQueryChange("needle");
    });
    expect(find.barProps.matchCount).toBe(0);
    await screen.rerender(<Probe environmentId={a} />);
    expect(find.barProps).toMatchObject({ open: true, query: "needle", matchCount: 3 });
  });
});

const paneFinds = new Map<EnvironmentId, ReturnType<typeof useThreadFind>>();

function FindPane({ environmentId }: { environmentId: EnvironmentId }) {
  const threadKey = scopedThreadKey({ environmentId, threadId });
  const state = useThreadFind({ thread: { environmentId, threadId }, enabled: true });
  const isInputOwner = usePaneInputOwner();
  useChatShortcuts({
    enabled: true,
    isInputOwner,
    keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
    scriptKeybindings: [],
    getShortcutContext: () => ({
      terminalFocus: false,
      terminalOpen: false,
      previewFocus: false,
      previewOpen: false,
      isWeb: true,
      isDesktop: false,
      modelPickerOpen: false,
    }),
    threadFindActive: state.barProps.open,
    composerRef: { current: null },
    branchToolbarRef: { current: null },
    composerShortcutAvailability: { draftProjectControls: true, branchPicker: true },
    closeThreadFind: state.barProps.onClose,
    commands: { "chat.find": () => openThreadFind(threadKey) },
    fallback: () => undefined,
  });
  useLayoutEffect(() => {
    paneFinds.set(environmentId, state);
  });
  return null;
}

const paneTarget = (environmentId: EnvironmentId) => ({
  kind: "server" as const,
  threadRef: { environmentId, threadId },
});
const paneScope = (paneId: string) => ({
  paneId,
  layoutVersion: paneId,
  narrow: false,
  collapsed: false,
  element: null,
});
const threadPath = (environmentId: EnvironmentId) =>
  `/${encodeURIComponent(environmentId)}/${threadId}`;
const pressFind = () =>
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "f",
      code: "KeyF",
      metaKey: navigator.platform.includes("Mac"),
      ctrlKey: !navigator.platform.includes("Mac"),
      bubbles: true,
      cancelable: true,
    }),
  );
const paneFind = (environmentId: EnvironmentId) => paneFinds.get(environmentId)!.barProps;

/** Panes for threads in environments a and b, a focused, on a router that follows focus. */
async function renderSplit(resources: AsyncDisposableStack) {
  resources.defer(() => {
    useChatPaneStore.setState({ layout: null, closed: [], openToSide: null });
    paneFinds.clear();
  });
  const store = useChatPaneStore.getState();
  store.reconcileRoute(paneTarget(a), { width: 1600, height: 900 });
  const paneA = useChatPaneStore.getState().layout!.focusedPaneId;
  const paneB = store.split(paneA, "right", paneTarget(b))!;
  store.focus(paneA);

  const root = createRootRoute();
  const router = createRouter({
    routeTree: root.addChildren(
      ["/$environmentId/$threadId", "/pull-requests", "/settings"].map((path) =>
        createRoute({ getParentRoute: () => root, path }),
      ),
    ),
    history: createMemoryHistory({ initialEntries: [threadPath(a)] }),
  });
  resources.defer(startThreadOverlayRetention(router));
  resources.use(
    await render(
      <>
        <RouterProvider router={router} />
        <PaneScopeProvider value={paneScope(paneA)}>
          <FindPane environmentId={a} />
        </PaneScopeProvider>
        <PaneScopeProvider value={paneScope(paneB)}>
          <FindPane environmentId={b} />
        </PaneScopeProvider>
      </>,
      { router: false },
    ),
  );
  const visit = (href: string) => act(() => router.history.push(href));
  return { paneA, paneB, visit };
}

describe("find in split panes", () => {
  it("opens with Cmd+F only in the focused pane, and each pane keeps its own find", async () => {
    setup();
    await using resources = new AsyncDisposableStack();
    const { paneA, paneB, visit } = await renderSplit(resources);

    await act(pressFind);
    expect(paneFind(a).open).toBe(true);
    expect(paneFind(b).open).toBe(false);
    await act(() => paneFind(a).onQueryChange("needle"));

    // Focus moves the URL to the focused pane's thread.
    await act(() => useChatPaneStore.getState().focus(paneB));
    await visit(threadPath(b));
    expect(paneFind(a)).toMatchObject({ open: true, query: "needle" });
    expect(paneFind(b).open).toBe(false);

    await act(pressFind);
    await act(() => paneFind(b).onQueryChange("thread"));
    expect(paneFind(a)).toMatchObject({ open: true, query: "needle" });
    expect(paneFind(b)).toMatchObject({ open: true, query: "thread" });

    await act(() => useChatPaneStore.getState().focus(paneA));
    await visit(threadPath(a));
    expect(paneFind(a)).toMatchObject({ open: true, query: "needle" });
    expect(paneFind(b)).toMatchObject({ open: true, query: "thread" });
  });

  it("closes find in a thread once no route or pane shows it", async () => {
    setup();
    await using resources = new AsyncDisposableStack();
    const { paneA, visit } = await renderSplit(resources);
    await act(() => {
      openThreadFind(scopedThreadKey({ environmentId: a, threadId }));
      openThreadFind(scopedThreadKey({ environmentId: b, threadId }));
    });

    await visit("/settings");
    expect(paneFind(a).open).toBe(true);
    expect(paneFind(b).open).toBe(true);

    await visit(threadPath(b));
    await act(() => useChatPaneStore.getState().close(paneA));
    expect(paneFind(a).open).toBe(false);
    expect(paneFind(b).open).toBe(true);

    await visit("/pull-requests");
    expect(paneFind(b).open).toBe(false);
  });
});

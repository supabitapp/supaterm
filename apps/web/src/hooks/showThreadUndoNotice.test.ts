import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { toastManager } from "../components/ui/toast";
import { announce, cancelAnnouncement } from "../lib/announce";
import {
  releaseThreadUndoShortcut,
  showThreadUndoNotice,
  threadUndoNoticeSummary,
  threadUndoClaimsShortcut,
  undoLatestThreadAction,
  useThreadUndoNotice,
} from "./showThreadUndoNotice";
import * as ThreadUndo from "./threadUndo";

vi.mock("../lib/announce", () => ({ announce: vi.fn(), cancelAnnouncement: vi.fn() }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setup() {
  const add = vi.spyOn(toastManager, "add").mockReturnValue("error-toast");
  const undo = vi.fn(async () => AsyncResult.success(undefined));
  const claim = ThreadUndo.begin("pin", "env/thread");
  const options = { action: "Unpinned" as const, failureTitle: "Restore failed", undo, claim };
  return { add, undo, claim, options };
}

function notice() {
  const value = useThreadUndoNotice.getState().notice;
  if (!value) throw new Error("Undo notice is missing");
  return value;
}

describe("thread undo notice", () => {
  it("aggregates consecutive actions without success toasts and restores the group once", async () => {
    const { add, undo, options } = setup();
    showThreadUndoNotice({
      ...options,
      action: "Done",
      claim: ThreadUndo.begin("mark-done", "env/a"),
    });
    showThreadUndoNotice({
      ...options,
      action: "Done",
      claim: ThreadUndo.begin("mark-done", "env/b"),
    });
    expect(notice()).toMatchObject({ action: "Done", count: 2 });
    expect(add).not.toHaveBeenCalled();
    const group = notice();
    await group.undo();
    await group.undo();
    expect(undo).toHaveBeenCalledTimes(2);
    expect(undoLatestThreadAction()).toBe(false);
  });

  it("drops invalidated claims immediately and rejects a captured stale undo", async () => {
    const { undo, options } = setup();
    showThreadUndoNotice(options);
    const stale = notice();
    ThreadUndo.invalidate("pin", "env/thread");
    expect(useThreadUndoNotice.getState().notice).toBeNull();
    showThreadUndoNotice({ ...options, claim: ThreadUndo.begin("pin", "env/thread") });
    await stale.undo();
    expect(undo).not.toHaveBeenCalled();
    await notice().undo();
    expect(undo).toHaveBeenCalledOnce();
  });

  it("does not show a notice for a late completion after a newer action", () => {
    const { add, options } = setup();
    ThreadUndo.invalidate("pin", "env/thread");
    showThreadUndoNotice(options);
    expect(useThreadUndoNotice.getState().notice).toBeNull();
    expect(add).not.toHaveBeenCalled();
  });

  it("keeps the group available until five seconds after the latest action", async () => {
    const { undo, claim, options } = setup();
    showThreadUndoNotice(options);
    vi.advanceTimersByTime(4_000);
    const second = ThreadUndo.begin("pin", "env/second");
    showThreadUndoNotice({ ...options, claim: second });
    const group = notice();
    vi.advanceTimersByTime(4_999);
    expect(notice().count).toBe(2);
    vi.advanceTimersByTime(1);
    expect(useThreadUndoNotice.getState().notice).toBeNull();
    expect(claim.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(false);
    await group.undo();
    expect(undo).not.toHaveBeenCalled();
  });

  it("reports a failed restore and releases its claim", async () => {
    const { add, claim, options } = setup();
    showThreadUndoNotice({
      ...options,
      undo: async () => AsyncResult.failure(Cause.fail(new Error("offline"))),
    });
    await notice().undo();
    expect(add).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "error", title: "Restore failed", description: "offline" }),
    );
    expect(claim.isCurrent()).toBe(false);
  });

  it("reports a rejected restore promise", async () => {
    const { add, options } = setup();
    showThreadUndoNotice({
      ...options,
      undo: async () => {
        throw new Error("disconnected");
      },
    });
    await notice().undo();
    expect(add).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "error", description: "disconnected" }),
    );
  });

  it("does not report interrupted restores as errors", async () => {
    const { add, options } = setup();
    showThreadUndoNotice({ ...options, undo: async () => AsyncResult.failure(Cause.interrupt()) });
    await notice().undo();
    expect(add).not.toHaveBeenCalled();
  });

  it("undoes the latest kind first, then reveals the preceding group", async () => {
    const { options } = setup();
    const older = vi.fn(async () => AsyncResult.success(undefined));
    const newer = vi.fn(async () => AsyncResult.success(undefined));
    showThreadUndoNotice({
      ...options,
      action: "Done",
      undo: older,
      claim: ThreadUndo.begin("mark-done", "env/a"),
    });
    showThreadUndoNotice({
      ...options,
      action: "Snoozed",
      undo: newer,
      claim: ThreadUndo.begin("snooze", "env/b"),
    });
    expect(undoLatestThreadAction()).toBe(true);
    expect(newer).toHaveBeenCalledOnce();
    expect(older).not.toHaveBeenCalled();
    expect(notice().action).toBe("Done");
    await notice().undo();
    expect(older).toHaveBeenCalledOnce();
    expect(undoLatestThreadAction()).toBe(false);
  });

  it("claims mod+z from text fields until the user types, then again for a new notice", () => {
    const { options } = setup();
    expect(threadUndoClaimsShortcut()).toBe(false);
    showThreadUndoNotice(options);
    expect(threadUndoClaimsShortcut()).toBe(true);
    releaseThreadUndoShortcut();
    expect(threadUndoClaimsShortcut()).toBe(false);
    showThreadUndoNotice({ ...options, claim: ThreadUndo.begin("pin", "env/next") });
    expect(threadUndoClaimsShortcut()).toBe(true);
  });

  it("stops claiming mod+z once nothing is left to undo", async () => {
    const { options } = setup();
    showThreadUndoNotice(options);
    await notice().undo();
    expect(threadUndoClaimsShortcut()).toBe(false);
    showThreadUndoNotice({ ...options, claim: ThreadUndo.begin("pin", "env/expiring") });
    vi.advanceTimersByTime(5_000);
    expect(threadUndoClaimsShortcut()).toBe(false);
  });

  it("announces each new summary once, and cancels it when the notice clears", async () => {
    const { options } = setup();
    vi.mocked(announce).mockClear();
    vi.mocked(cancelAnnouncement).mockClear();
    showThreadUndoNotice(options);
    expect(announce).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/^Unpinned 1 thread, /),
      "thread-undo-notice",
    );
    ThreadUndo.invalidate("pin", "env/other");
    expect(announce).toHaveBeenCalledOnce();
    showThreadUndoNotice({ ...options, claim: ThreadUndo.begin("pin", "env/second") });
    expect(announce).toHaveBeenLastCalledWith(
      expect.stringMatching(/^Unpinned 2 threads, /),
      "thread-undo-notice",
    );
    await notice().undo();
    expect(cancelAnnouncement).toHaveBeenCalledWith("thread-undo-notice");
  });

  it("words a Done group as marking threads done", () => {
    expect(threadUndoNoticeSummary({ action: "Done", count: 1 })).toBe("Marked 1 thread as Done");
    expect(threadUndoNoticeSummary({ action: "Done", count: 2 })).toBe("Marked 2 threads as Done");
    expect(threadUndoNoticeSummary({ action: "Discarded", count: 2 })).toBe("Discarded 2 drafts");
  });
});

import { ThreadId, type WorktreeSetupSnapshot } from "@supaterm/contracts";
import { resolveVisibleWorktreeSetup } from "@supaterm/client-runtime/worktree-setup";
import { describe, expect, it } from "vite-plus/test";
import {
  finishWorktreeSetupExit,
  nextWorktreeSetupPresence,
  resolveWorktreeSetupSnapshot,
} from "./worktree-setup-state";

const threadId = ThreadId.make("setup-thread");
const running: WorktreeSetupSnapshot = {
  threadId,
  sequence: 1,
  phase: "running",
  startedAt: "2026-09-17T00:00:00.000Z",
  endedAt: null,
  branch: "feature",
  baseRef: "main",
  worktreePath: null,
  setupScript: null,
  stages: [],
  error: null,
};

describe("mobile worktree setup handoff", () => {
  it("keeps the finished setup after its card retires once the turn starts", () => {
    const done = { ...running, phase: "done" as const, sequence: 2 };
    const held = resolveWorktreeSetupSnapshot(threadId, done, running);
    expect(held).toBe(done);
    expect(
      resolveVisibleWorktreeSetup({
        live: held,
        recorded: null,
        turnStarted: false,
        followUpSent: false,
      }),
    ).toBe(done);
    const retired = resolveVisibleWorktreeSetup({
      live: held,
      recorded: null,
      turnStarted: true,
      followUpSent: false,
    });
    expect(retired).toBeNull();
    expect(resolveWorktreeSetupSnapshot(threadId, undefined, held)).toBe(done);

    const card = { snapshot: done, turnStarted: false, onCancel: () => {}, onWorkLocally: null };
    const shown = nextWorktreeSetupPresence({ setup: null, exiting: false, generation: 0 }, card);
    expect(nextWorktreeSetupPresence(shown, { ...card, onCancel: () => {} })).toBe(shown);
    const leaving = nextWorktreeSetupPresence(shown, retired && { ...card, snapshot: retired });
    expect(leaving).toEqual({ setup: card, exiting: true, generation: 0 });
    expect(nextWorktreeSetupPresence(leaving, null)).toBe(leaving);
    expect(finishWorktreeSetupExit(leaving, 0)).toEqual({
      setup: null,
      exiting: false,
      generation: 1,
    });

    const returned = { ...card, turnStarted: true, snapshot: { ...done, sequence: 3 } };
    const leavingAgain = nextWorktreeSetupPresence(
      nextWorktreeSetupPresence(leaving, returned),
      null,
    );
    expect(leavingAgain).toEqual({ setup: returned, exiting: true, generation: 1 });
    expect(finishWorktreeSetupExit(leavingAgain, 0)).toBe(leavingAgain);
  });

  it.each(["failed", "cancelled"] as const)(
    "retains %s details after the stream closes",
    (phase) => {
      const settled = { ...running, phase, sequence: 3 };
      const held = resolveWorktreeSetupSnapshot(threadId, settled, running);
      expect(resolveWorktreeSetupSnapshot(threadId, null, held)).toBe(settled);
      expect(resolveWorktreeSetupSnapshot(threadId, running, held)).toBe(settled);
      expect(
        resolveVisibleWorktreeSetup({
          live: held,
          recorded: null,
          turnStarted: false,
          followUpSent: false,
        }),
      ).toBe(settled);
      expect(
        resolveVisibleWorktreeSetup({
          live: held,
          recorded: null,
          turnStarted: false,
          followUpSent: true,
        }),
      ).toBeNull();
    },
  );

  it("does not carry a previous thread's progress across navigation", () => {
    const otherId = ThreadId.make("other-thread");
    expect(resolveWorktreeSetupSnapshot(otherId, running, running)).toBeNull();
    const other = { ...running, threadId: otherId };
    expect(resolveWorktreeSetupSnapshot(otherId, other, running)).toBe(other);
  });
});

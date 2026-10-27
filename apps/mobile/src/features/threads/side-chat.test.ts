import { EnvironmentId, ProviderInstanceId, RunId, ThreadId } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadShellFixture } from "../../test-fixtures";
import { parentSideChats, parseSideChatCommand, sideChatMergeBackBlockReason } from "./side-chat";

const parent = makeThreadShellFixture({ id: ThreadId.make("parent"), title: "Refactor" });
const lineage = {
  parentThreadId: parent.id,
  rootThreadId: parent.id,
  relationshipToParent: "fork" as const,
};

function sideChat(id: string, overrides: Parameters<typeof makeThreadShellFixture>[0] = {}) {
  return makeThreadShellFixture({ id: ThreadId.make(id), sideChat: true, lineage, ...overrides });
}

describe("parseSideChatCommand", () => {
  it("takes the question after /side or /btw and nothing else", () => {
    expect(parseSideChatCommand("/side why is CI red?")).toBe("why is CI red?");
    expect(parseSideChatCommand("  /btw\nwhat changed")).toBe("what changed");
    expect(parseSideChatCommand("/side")).toBe("");
    expect(parseSideChatCommand("/sidebar open")).toBeNull();
    expect(parseSideChatCommand("ask /side later")).toBeNull();
  });
});

describe("parentSideChats", () => {
  it("lists the parent's open side chats, the one asked most recently first", () => {
    const older = sideChat("older", { latestUserMessageAt: "2026-01-01T00:01:00.000Z" });
    const newer = sideChat("newer", { latestUserMessageAt: "2026-01-01T00:05:00.000Z" });
    const unasked = sideChat("unasked", { createdAt: "2026-01-01T00:03:00.000Z" });
    const archived = sideChat("archived", { archivedAt: "2026-01-01T00:09:00.000Z" });
    const elsewhere = sideChat("elsewhere", { environmentId: EnvironmentId.make("other") });
    const fork = makeThreadShellFixture({ id: ThreadId.make("fork"), lineage });

    expect(
      parentSideChats([older, archived, fork, unasked, elsewhere, newer], parent).map(
        (thread) => thread.id,
      ),
    ).toEqual([newer.id, unasked.id, older.id]);
  });
});

describe("sideChatMergeBackBlockReason", () => {
  it("waits for a working or queued parent to go idle", () => {
    const runtime = {
      status: "running" as const,
      providerName: "Codex",
      providerInstanceId: ProviderInstanceId.make("codex"),
      runtimeMode: "approval-required" as const,
      activeRunId: null,
      lastError: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(sideChatMergeBackBlockReason({ ...parent, runtime })).toBe(
      "Available when Refactor is idle",
    );
    expect(
      sideChatMergeBackBlockReason({ ...parent, runtime: { ...runtime, status: "idle" } }),
    ).toBe(null);
    expect(
      sideChatMergeBackBlockReason({
        ...parent,
        latestRun: {
          runId: RunId.make("run-queued"),
          status: "queued",
          requestedAt: null,
          startedAt: null,
          completedAt: null,
          assistantMessageId: null,
        },
      }),
    ).toBe("Available when Refactor is idle");
    expect(sideChatMergeBackBlockReason(null)).toBe("The parent thread is gone");
  });
});

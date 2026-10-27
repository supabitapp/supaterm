import {
  ContextHandoffId,
  EnvironmentId,
  ProviderDriverKind,
  RunId,
  ThreadId,
} from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture } from "../../test-fixtures";
import {
  hasPendingSideChatMerge,
  isSideChatParentBusy,
  latestSideChat,
  parseSideChatCommand,
  sideChatContextNote,
} from "./sideChat.logic";

const environmentId = EnvironmentId.make("environment-side-chat");
const parentId = ThreadId.make("thread-parent");
const sideChatId = ThreadId.make("thread-side-chat");

function sideChatOf(id: string, parentThreadId: ThreadId, latestUserMessageAt: string) {
  return makeThreadFixture({
    id: ThreadId.make(id),
    environmentId,
    sideChat: true,
    latestUserMessageAt,
    lineage: { rootThreadId: parentThreadId, parentThreadId, relationshipToParent: "fork" },
  });
}

describe("parseSideChatCommand", () => {
  it("reads the question after /side or /btw", () => {
    expect(parseSideChatCommand("/side why is the build slow?")).toBe("why is the build slow?");
    expect(parseSideChatCommand("  /btw\n what changed\n in auth?  ")).toBe(
      "what changed\n in auth?",
    );
    expect(parseSideChatCommand("/side")).toBe("");
    expect(parseSideChatCommand("/btw   ")).toBe("");
  });

  it("leaves other prompts and commands alone", () => {
    expect(parseSideChatCommand("/sidebar open")).toBeNull();
    expect(parseSideChatCommand("/model")).toBeNull();
    expect(parseSideChatCommand("ask /side later")).toBeNull();
    expect(parseSideChatCommand("")).toBeNull();
  });
});

describe("latestSideChat", () => {
  it("picks the parent's side chat asked in most recently that is not archived", () => {
    const older = sideChatOf("side-older", parentId, "2026-10-01T00:00:00.000Z");
    const newer = sideChatOf("side-newer", parentId, "2026-10-02T00:00:00.000Z");
    const archived = {
      ...sideChatOf("side-archived", parentId, "2026-10-03T00:00:00.000Z"),
      archivedAt: "2026-10-03T00:00:00.000Z",
    };
    const otherParent = sideChatOf(
      "side-other",
      ThreadId.make("thread-other"),
      "2026-10-04T00:00:00.000Z",
    );
    const fork = makeThreadFixture({
      id: ThreadId.make("thread-fork"),
      environmentId,
      latestUserMessageAt: "2026-10-05T00:00:00.000Z",
      lineage: { rootThreadId: parentId, parentThreadId: parentId, relationshipToParent: "fork" },
    });

    expect(latestSideChat([older, newer, archived, otherParent, fork], parentId)?.id).toBe(
      newer.id,
    );
    expect(latestSideChat([otherParent, fork], parentId)).toBeNull();
  });
});

describe("isSideChatParentBusy", () => {
  it("holds merge-back while the parent runs or has a run queued", () => {
    const idle = makeThreadFixture({ id: parentId, environmentId });
    const runId = RunId.make("run-1");
    const queued = makeThreadFixture({
      id: parentId,
      environmentId,
      latestRun: {
        runId,
        status: "queued",
        requestedAt: null,
        startedAt: null,
        completedAt: null,
        assistantMessageId: null,
      },
    });
    const finished = makeThreadFixture({
      id: parentId,
      environmentId,
      latestRun: {
        runId,
        status: "completed",
        requestedAt: null,
        startedAt: null,
        completedAt: "2026-10-01T00:00:00.000Z",
        assistantMessageId: null,
      },
    });

    expect(isSideChatParentBusy(idle)).toBe(false);
    expect(isSideChatParentBusy(finished)).toBe(false);
    expect(isSideChatParentBusy(queued)).toBe(true);
  });
});

describe("sideChatContextNote", () => {
  const forkTransfer = {
    type: "fork" as const,
    targetThreadId: sideChatId,
    resolution: null,
  };

  it("names what of the parent the side chat started from", () => {
    expect(sideChatContextNote([{ ...forkTransfer, snapshot: "live" }], sideChatId)).toBe(
      "Includes the parent's run in progress",
    );
    expect(sideChatContextNote([forkTransfer], sideChatId)).toBe(
      "Starts from the parent's last finished run",
    );
    expect(
      sideChatContextNote(
        [
          {
            ...forkTransfer,
            resolution: {
              strategy: "native_fork",
              providerThreadRef: {
                driver: ProviderDriverKind.make("codex"),
                nativeId: "provider-thread",
                strength: "strong",
              },
            },
          },
        ],
        sideChatId,
      ),
    ).toBe("Starts from the parent's last finished run");
    expect(
      sideChatContextNote(
        [
          {
            ...forkTransfer,
            resolution: {
              strategy: "portable_context",
              contextHandoffId: ContextHandoffId.make("handoff"),
            },
          },
        ],
        sideChatId,
      ),
    ).toBe("Starts from a summary of the parent");
  });

  it("says nothing without the side chat's own fork transfer", () => {
    expect(sideChatContextNote([], sideChatId)).toBeNull();
    expect(
      sideChatContextNote([{ ...forkTransfer, targetThreadId: parentId }], sideChatId),
    ).toBeNull();
  });
});

describe("hasPendingSideChatMerge", () => {
  it("finds a merge-back from the side chat still waiting for the parent", () => {
    const merge = {
      type: "merge_back" as const,
      sourceThreadId: sideChatId,
      status: "pending" as const,
    };
    expect(hasPendingSideChatMerge([merge], sideChatId)).toBe(true);
    expect(hasPendingSideChatMerge([{ ...merge, status: "consumed" }], sideChatId)).toBe(false);
    expect(hasPendingSideChatMerge([{ ...merge, sourceThreadId: parentId }], sideChatId)).toBe(
      false,
    );
  });
});

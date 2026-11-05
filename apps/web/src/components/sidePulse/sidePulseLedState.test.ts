import { EnvironmentId, ProviderInstanceId, RunId, ThreadId } from "@supaterm/contracts";
import { scopedThreadKey } from "@supaterm/client-runtime/environment";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/models";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture, type ThreadFixtureOverrides } from "../../test-fixtures";
import { selectSidePulseLedState } from "./sidePulseLedState";

const NOW = "2026-03-10T12:00:00.000Z";
const EARLIER = "2026-03-10T11:00:00.000Z";
const LATER = "2026-03-10T13:00:00.000Z";
const connected = EnvironmentId.make("environment-test");
const offline = EnvironmentId.make("environment-offline");

function thread(id: string, overrides: ThreadFixtureOverrides = {}): EnvironmentThreadShell {
  return makeThreadFixture({ id: ThreadId.make(id), title: id, ...overrides });
}

function runtime(status: "running" | "idle" | "failed") {
  return {
    runtime: {
      status,
      activeRunId: null,
      providerInstanceId: ProviderInstanceId.make("codex"),
      providerName: "Codex",
      lastError: null,
      updatedAt: NOW,
    },
  };
}

function finished(status: "completed" | "failed", lastVisitedAt: string) {
  return {
    ...runtime(status === "failed" ? "failed" : "idle"),
    latestRun: {
      runId: RunId.make(`run-${status}`),
      status,
      assistantMessageId: null,
      requestedAt: NOW,
      startedAt: NOW,
      completedAt: NOW,
    },
    lastVisitedAt,
  };
}

const unseenReply = thread("unseen-reply", finished("completed", EARLIER));

function ledState(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  viewing?: EnvironmentThreadShell,
) {
  return selectSidePulseLedState({
    threads,
    connectedEnvironmentIds: [connected],
    viewingThreadKey:
      viewing === undefined
        ? null
        : scopedThreadKey({ environmentId: viewing.environmentId, threadId: viewing.id }),
    now: NOW,
  });
}

describe("selectSidePulseLedState", () => {
  it.each([
    ["shows no threads as idle", [], "idle"],
    ["shows an idle session as idle", [thread("idle", runtime("idle"))], "idle"],
    ["shows a reply that was seen as idle", [thread("seen", finished("completed", LATER))], "idle"],
    ["shows a reply nobody has seen as done", [unseenReply], "done"],
    [
      "shows a running agent over an unseen reply",
      [unseenReply, thread("running", runtime("running"))],
      "working",
    ],
    [
      "shows an agent waiting on its subagents as working",
      [thread("parent", { ...runtime("running"), blockedOnThreadWait: true })],
      "working",
    ],
    [
      "shows an approval request over running agents",
      [
        thread("running", runtime("running")),
        thread("approval", { ...runtime("running"), hasPendingApprovals: true }),
      ],
      "attention",
    ],
    [
      "shows a question as attention",
      [thread("question", { hasPendingUserInput: true })],
      "attention",
    ],
    [
      "shows a failure nobody has seen as attention",
      [thread("failed", finished("failed", EARLIER))],
      "attention",
    ],
    [
      "shows a failure that was seen as idle",
      [thread("failed", finished("failed", LATER))],
      "idle",
    ],
    [
      "shows work the agent is waiting on in the background as working",
      [
        thread("watching", {
          ...finished("completed", EARLIER),
          pendingBackgroundTasks: [
            { taskId: "watch", description: "Watch PR", kind: "monitor", awaited: true },
          ],
        }),
      ],
      "working",
    ],
    [
      "ignores a subagent's question to its parent",
      [
        thread("parent", runtime("running")),
        thread("child", {
          hasPendingUserInput: true,
          lineage: {
            rootThreadId: ThreadId.make("parent"),
            parentThreadId: ThreadId.make("parent"),
            relationshipToParent: "subagent",
          },
        }),
      ],
      "working",
    ],
    [
      "counts a reply on a thread marked done as seen",
      [thread("marked-done", { ...finished("completed", EARLIER), doneOverride: "done" })],
      "idle",
    ],
    [
      "ignores threads that are archived, snoozed, or offline",
      [
        thread("archived", { ...runtime("running"), archivedAt: NOW }),
        thread("snoozed", { ...finished("completed", EARLIER), snoozedUntil: LATER }),
        thread("offline", { ...runtime("running"), environmentId: offline }),
      ],
      "idle",
    ],
  ] as const)("%s", (_name, threads, expected) => {
    expect(ledState(threads)).toBe(expected);
  });

  it("counts the reply on screen in a focused window as seen", () => {
    expect(ledState([unseenReply], unseenReply)).toBe("idle");
    expect(ledState([unseenReply], thread("other"))).toBe("done");
  });
});

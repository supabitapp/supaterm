import { describe, expect, it } from "vite-plus/test";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@supaterm/contracts";

import { pendingThreadCreation } from "./pendingThreadCreation";
import type { PendingThreadTurn } from "./threadOutbox";

const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt" };

function entry(status: PendingThreadTurn["status"]): PendingThreadTurn {
  return {
    id: "message",
    scope: "environment:thread",
    createdAt: "2026-10-18T00:00:00Z",
    position: 1,
    status,
    attempted: status !== "pending",
    attempts: status === "pending" ? 0 : 1,
    retryAt: 0,
    error: status === "failed" ? "Provider error" : null,
    paused: false,
    pauseUntil: 0,
    payload: {
      environmentId: EnvironmentId.make("environment"),
      input: {
        commandId: CommandId.make("command"),
        threadId: ThreadId.make("thread"),
        message: {
          messageId: MessageId.make("message"),
          role: "user",
          text: "Say hi.",
          attachments: [],
        },
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        dispatchMode: "queue",
        bootstrap: {
          createThread: {
            projectId: ProjectId.make("project"),
            title: "Say hi.",
            modelSelection,
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt: "2026-10-18T00:00:00Z",
          },
        },
      },
      localAttachments: [],
    },
  };
}

describe("pendingThreadCreation", () => {
  it("presents one outbox entry as the same object on every read", () => {
    const pending = entry("pending");
    expect(pendingThreadCreation(pending)).not.toBeNull();
    expect(pendingThreadCreation(pending)).toBe(pendingThreadCreation(pending));
  });

  it("presents a replaced entry afresh", () => {
    const pending = pendingThreadCreation(entry("pending"));
    const failed = pendingThreadCreation(entry("failed"));
    expect(failed).not.toBe(pending);
    expect(failed?.outcome).toMatchObject({ kind: "failed", reason: "Provider error" });
  });
});

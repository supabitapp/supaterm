import {
  EnvironmentId,
  OrchestrationV2ThreadShell,
  ProviderInstanceId,
  RunId,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { presentThreadShell } from "./models.ts";
import { v2ThreadShell } from "./orchestrationV2TestFixtures.ts";
import { resolveThreadRowStatus } from "./threadRowStatus.ts";

const environmentId = EnvironmentId.make("environment-1");
const decodeThreadShell = Schema.decodeUnknownSync(OrchestrationV2ThreadShell);

describe("resolveThreadRowStatus", () => {
  const runtime = {
    status: "running" as const,
    activeRunId: null,
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerName: "Codex",
    lastError: null,
    updatedAt: "2026-03-09T10:00:00.000Z",
  };

  const idle = { hasPendingApprovals: false, hasPendingUserInput: false, runtime: null };

  it("presents decoded thread waits as Waiting while preserving requests and older servers", () => {
    const raw = {
      ...v2ThreadShell,
      status: "running",
      activeRunId: RunId.make("run-wait"),
      latestRunId: RunId.make("run-wait"),
    };
    const present = (shell: unknown) => presentThreadShell(environmentId, decodeThreadShell(shell));

    expect(resolveThreadRowStatus(present(raw))).toBe("working");
    const blocked = present({ ...raw, blockedOnThreadWait: true });
    expect(
      resolveThreadRowStatus({
        ...blocked,
        hasPendingApprovals: true,
        hasPendingUserInput: true,
      }),
    ).toBe("approval");
    expect(resolveThreadRowStatus({ ...blocked, hasPendingUserInput: true })).toBe("input");
    expect(resolveThreadRowStatus(blocked)).toBe("waiting");
    expect(resolveThreadRowStatus(present({ ...raw, blockedOnThreadWait: false }))).toBe("working");
  });

  it("keeps usage-limit stops Limited until the thread recovers", () => {
    const limited = {
      ...runtime,
      status: "failed" as const,
      lastError: "Plan limit reached",
      lastErrorClass: "usage_limit" as const,
    };
    expect(resolveThreadRowStatus({ ...idle, runtime: limited })).toBe("limited");
    expect(resolveThreadRowStatus({ ...idle, runtime: { ...limited, status: "running" } })).toBe(
      "working",
    );
    expect(resolveThreadRowStatus({ ...idle, runtime: { ...limited, status: "completed" } })).toBe(
      "ready",
    );
  });

  it("reports failed only while the latest run failed", () => {
    expect(
      resolveThreadRowStatus({
        ...idle,
        runtime: { ...runtime, status: "failed" as const, lastError: "boom" },
      }),
    ).toBe("failed");
    expect(
      resolveThreadRowStatus({
        ...idle,
        runtime: { ...runtime, status: "completed" as const, lastError: "persisted" },
      }),
    ).toBe("ready");
    expect(
      resolveThreadRowStatus({
        ...idle,
        runtime: { ...runtime, status: "idle" as const, lastError: "persisted" },
      }),
    ).toBe("waiting");
  });

  it.each([
    { roster: "dev server", task: { kind: "command" }, status: "ready" },
    { roster: "dev server watchdog", task: { kind: "monitor" }, status: "ready" },
    { roster: "awaited command", task: { kind: "command", awaited: true }, status: "waiting" },
  ] as const)(
    "presents an unseen completion with a $roster roster as $status",
    ({ task, status }) => {
      const thread = presentThreadShell(environmentId, {
        ...v2ThreadShell,
        latestRunId: RunId.make("run-background-completion"),
        status: "completed",
        latestRunCompletedAt: DateTime.makeUnsafe("2026-06-20T01:00:00.000Z"),
        lastVisitedAt: DateTime.makeUnsafe("2026-06-20T00:59:00.000Z"),
        pendingBackgroundTasks: [{ taskId: "background-work", ...task }],
      });

      expect(resolveThreadRowStatus(thread)).toBe(status);
    },
  );
});

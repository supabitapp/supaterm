import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  OrchestratorMcpDelegateTaskInput,
  OrchestratorMcpDelegateTaskResult,
  OrchestratorMcpRequestSecretInput,
  OrchestratorMcpRequestSecretResult,
  OrchestratorMcpClientRequestId,
} from "./orchestratorMcp.ts";

const decodeDelegateTaskInput = Schema.decodeUnknownSync(OrchestratorMcpDelegateTaskInput);
const decodeDelegateTaskResult = Schema.decodeUnknownSync(OrchestratorMcpDelegateTaskResult);

describe("orchestrator MCP contracts", () => {
  it("decodes cross-provider delegated task requests and durable results", () => {
    const request = decodeDelegateTaskInput({
      task: "Inspect the workspace and report the result.",
      target: {
        providerInstanceId: "claudeAgent",
        model: "claude-sonnet-4-6",
      },
      mode: "wait",
      timeoutMs: 5_000,
      clientRequestId: "delegate-1",
      runtimeMode: "inherit",
      interactionMode: "inherit",
    });
    const result = decodeDelegateTaskResult({
      taskId: "node-task-1",
      childThreadId: "thread-child-1",
      childRunId: "run-child-1",
      childNodeId: "node-task-1",
      status: "completed",
      workState: "result_available",
      hasPendingChildRuns: false,
      providerInstanceId: "claudeAgent",
      model: "claude-sonnet-4-6",
      summary: "Workspace inspected.",
      resultContextTransferId: "context-transfer-result-1",
      latestTerminalRunId: "run-child-1",
      latestTerminalStatus: "completed",
      latestTerminalSummary: "Workspace inspected.",
      latestTerminalResultContextTransferId: "context-transfer-result-1",
      hasPendingQuestion: false,
      pendingApproval: null,
      waitTimedOut: false,
    });

    expect(request.target?.providerInstanceId).toBe("claudeAgent");
    expect(result.status).toBe("completed");
    expect(result.summary).toBe("Workspace inspected.");
    expect(result.pendingApproval).toBeNull();
    const pendingApproval = {
      requestId: "request-approval-1",
      kind: "command",
      runId: "run-child-1",
    };
    expect(
      decodeDelegateTaskResult({
        ...result,
        pendingApproval: { ...pendingApproval, input: { command: "private command" } },
      }).pendingApproval,
    ).toEqual(pendingApproval);
    expect(() =>
      decodeDelegateTaskResult({
        ...result,
        pendingApproval: { ...pendingApproval, kind: "user_input" },
      }),
    ).toThrow();
  });
});

const decodeSecretRequest = Schema.decodeUnknownSync(OrchestratorMcpRequestSecretInput);
const decodeSecretResult = Schema.decodeUnknownSync(OrchestratorMcpRequestSecretResult);
const decodeRequestId = Schema.decodeUnknownSync(OrchestratorMcpClientRequestId);

describe("private file requests", () => {
  it("requires explicit file delivery and returns only its path", () => {
    const input = { label: "CLI token", reason: "Authenticate the requested CLI" };
    expect(() => decodeSecretRequest(input)).toThrow();
    expect(() => decodeSecretRequest({ ...input, delivery: "secretRef" })).toThrow();
    expect(decodeSecretRequest({ ...input, delivery: "file" }).delivery).toBe("file");
    expect(() => decodeSecretResult({ status: "saved", secretRef: "private" })).toThrow();
    expect(
      decodeSecretResult({ status: "saved", file: "/private/token", value: "hidden" }),
    ).toEqual({ status: "saved", file: "/private/token" });
  });
});

describe("idempotent request keys", () => {
  it("keeps a retry key with paired Unicode and rejects malformed surrogates", () => {
    expect(decodeRequestId("launch-😀")).toBe("launch-😀");
    expect(() => decodeRequestId("launch-\ud800")).toThrow();
    expect(() => decodeRequestId("launch-\udc00")).toThrow();
  });
});

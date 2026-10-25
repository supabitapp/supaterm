import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  NodeId,
  type OrchestrationV2ProviderCapabilities,
  type OrchestrationV2ThreadProjection,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  RunAttemptId,
  RunId,
  ThreadId,
} from "@supaterm/contracts";
import * as Effect from "effect/Effect";

import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import { CursorProviderCapabilitiesV2 } from "@supaterm/provider-cursor/testing";
import * as CommandPolicy from "./CommandPolicy.ts";

const commandId = CommandId.make("command-policy-test");
const threadId = ThreadId.make("command-policy-thread");
const activeRunId = RunId.make("command-policy-active-run");
const activeAttemptId = RunAttemptId.make("command-policy-active-attempt");
const rootNodeId = NodeId.make("command-policy-root-node");
const userMessageId = MessageId.make("command-policy-user-message");

const baseCapabilities: OrchestrationV2ProviderCapabilities = CodexProviderCapabilitiesV2;

function capabilities(
  override: (current: OrchestrationV2ProviderCapabilities) => OrchestrationV2ProviderCapabilities,
): OrchestrationV2ProviderCapabilities {
  return override(baseCapabilities);
}

function dispatchProjection(
  sessionCapabilities?: OrchestrationV2ProviderCapabilities,
): OrchestrationV2ThreadProjection {
  const providerThreadId = ProviderThreadId.make("command-policy-provider-thread");
  const providerSessionId = ProviderSessionId.make("command-policy-provider-session");
  return {
    runs:
      sessionCapabilities === undefined
        ? []
        : [
            {
              id: activeRunId,
              status: "running",
              providerThreadId,
              activeAttemptId,
              rootNodeId,
              userMessageId,
            },
          ],
    providerTurns:
      sessionCapabilities === undefined
        ? []
        : [{ runAttemptId: activeAttemptId, nodeId: rootNodeId, ordinal: 1, status: "running" }],
    messages: [{ id: userMessageId, text: "first", attachments: [] }],
    providerThreads:
      sessionCapabilities === undefined ? [] : [{ id: providerThreadId, providerSessionId }],
    providerSessions:
      sessionCapabilities === undefined
        ? []
        : [{ id: providerSessionId, capabilities: sessionCapabilities }],
  } as unknown as OrchestrationV2ThreadProjection;
}

it("resolves automatic message delivery from authoritative provider capabilities", () => {
  assert.deepEqual(
    CommandPolicy.resolveMessageDispatchIntent(
      dispatchProjection(),
      { type: "start_immediately" },
      "auto",
    ),
    { type: "start_immediately" },
  );
  assert.deepEqual(
    CommandPolicy.resolveMessageDispatchIntent(
      dispatchProjection(baseCapabilities),
      { type: "start_immediately" },
      "auto",
    ),
    { type: "steer_active", targetRunId: activeRunId },
  );
  assert.deepEqual(
    CommandPolicy.resolveMessageDispatchIntent(
      dispatchProjection(
        capabilities((current) => ({
          ...current,
          turns: {
            ...current.turns,
            supportsActiveSteering: false,
            supportsQueuedMessages: true,
            supportsSteeringByInterruptRestart: true,
          },
        })),
      ),
      { type: "start_immediately" },
      "auto",
    ),
    { type: "queue_after_active" },
  );
  assert.deepEqual(
    CommandPolicy.resolveMessageDispatchIntent(
      dispatchProjection(
        capabilities((current) => ({
          ...current,
          turns: {
            ...current.turns,
            supportsActiveSteering: false,
            supportsQueuedMessages: false,
            supportsSteeringByInterruptRestart: true,
          },
        })),
      ),
      { type: "start_immediately" },
      "auto",
    ),
    { type: "restart_active", targetRunId: activeRunId },
  );
});

it.each(["preparing", "starting", "waiting"] as const)(
  "queues an automatic message while the run is %s",
  (status) => {
    const projection = dispatchProjection(baseCapabilities);
    assert.deepEqual(
      CommandPolicy.resolveMessageDispatchIntent(
        { ...projection, runs: projection.runs.map((run) => ({ ...run, status })) },
        { type: "start_immediately" },
        "auto",
      ),
      { type: "queue_after_active" },
    );
  },
);

it.each([
  { state: "missing", override: null },
  { state: "pending", override: { status: "pending" } },
  { state: "interrupted", override: { status: "interrupted" } },
  { state: "failed", override: { status: "failed" } },
  { state: "cancelled", override: { status: "cancelled" } },
  { state: "previous-attempt", override: { runAttemptId: RunAttemptId.make("previous-attempt") } },
  { state: "child-node", override: { nodeId: NodeId.make("child-node") } },
] as const)("queues automatic delivery when the root provider turn is $state", ({ override }) => {
  const projection = dispatchProjection(baseCapabilities);
  const providerTurns =
    override === null ? [] : projection.providerTurns.map((turn) => ({ ...turn, ...override }));
  assert.deepEqual(
    CommandPolicy.resolveMessageDispatchIntent(
      { ...projection, providerTurns },
      { type: "start_immediately" },
      "auto",
    ),
    { type: "queue_after_active" },
  );
  for (const deliveryIntent of ["steer", "restart"] as const) {
    assert.deepEqual(
      CommandPolicy.resolveMessageDispatchIntent(
        { ...projection, providerTurns },
        { type: "start_immediately" },
        deliveryIntent,
      ),
      {
        type: deliveryIntent === "steer" ? "steer_active" : "restart_active",
        targetRunId: activeRunId,
      },
    );
  }
});

it.each([
  { earlierStatus: "completed", latestStatus: "pending", expected: "queue_after_active" },
  { earlierStatus: "pending", latestStatus: "running", expected: "steer_active" },
] as const)(
  "uses the latest root provider turn when it is $latestStatus",
  ({ earlierStatus, latestStatus, expected }) => {
    const projection = dispatchProjection(baseCapabilities);
    const turn = projection.providerTurns[0]!;
    for (const providerTurns of [
      [
        { ...turn, ordinal: 1, status: earlierStatus },
        { ...turn, ordinal: 2, status: latestStatus },
      ],
      [
        { ...turn, ordinal: 2, status: latestStatus },
        { ...turn, ordinal: 1, status: earlierStatus },
      ],
    ]) {
      assert.deepEqual(
        CommandPolicy.resolveMessageDispatchIntent(
          { ...projection, providerTurns },
          { type: "start_immediately" },
          "auto",
        ),
        expected === "steer_active"
          ? { type: "steer_active", targetRunId: activeRunId }
          : { type: "queue_after_active" },
      );
    }
  },
);

it.each([
  { status: "running", expected: "steer_active" },
  { status: "waiting", expected: "steer_active" },
  { status: "preparing", expected: "queue_after_active" },
  { status: "starting", expected: "queue_after_active" },
] as const)("resolves completed-turn delivery while the run is $status", ({ status, expected }) => {
  const projection = dispatchProjection(baseCapabilities);
  assert.deepEqual(
    CommandPolicy.resolveMessageDispatchIntent(
      {
        ...projection,
        runs: projection.runs.map((run) => ({ ...run, status })),
        providerTurns: projection.providerTurns.map((turn) => ({ ...turn, status: "completed" })),
      },
      { type: "start_immediately" },
      "auto",
    ),
    expected === "steer_active"
      ? { type: "steer_active", targetRunId: activeRunId }
      : { type: "queue_after_active" },
  );
});

it.each(["/compact", " /LOGOUT "])("queues a steer sent while %s runs", (text) => {
  const projection = dispatchProjection(baseCapabilities);
  const maintenance = {
    ...projection,
    messages: [{ id: userMessageId, text, attachments: [] }],
  } as unknown as OrchestrationV2ThreadProjection;
  for (const deliveryIntent of ["auto", "steer"] as const) {
    assert.deepEqual(
      CommandPolicy.resolveMessageDispatchIntent(
        maintenance,
        { type: "start_immediately" },
        deliveryIntent,
      ),
      { type: "queue_after_active" },
    );
  }
  assert.deepEqual(
    CommandPolicy.resolveMessageDispatchIntent(maintenance, {
      type: "steer_active",
      targetRunId: activeRunId,
    }),
    { type: "queue_after_active" },
  );
  assert.deepEqual(
    CommandPolicy.resolveMessageDispatchIntent(
      maintenance,
      { type: "start_immediately" },
      "restart",
    ),
    { type: "restart_active", targetRunId: activeRunId },
  );
});

const layer = it.layer(CommandPolicy.layer);

layer("CommandPolicyV2", (it) => {
  it.effect("falls back to portable context when Cursor cannot fork natively", () =>
    Effect.gen(function* () {
      const policy = yield* CommandPolicy.CommandPolicyV2;

      const result = yield* policy.decideForkExecution({
        commandId,
        threadId,
        providerInstanceId: ProviderInstanceId.make("cursor"),
        capabilities: CursorProviderCapabilitiesV2,
        sameProvider: true,
        hasStrongNativeSource: true,
        sourceRunStatus: "completed",
        fromSpecificTurn: true,
      });

      assert.equal(result, "portable_context");
    }),
  );

  it.effect("forks a running source natively only where the provider allows it", () =>
    Effect.gen(function* () {
      const policy = yield* CommandPolicy.CommandPolicyV2;
      const decide = (
        forkWhileSourceActive: "none" | "stable" | "live" | undefined,
        input: { liveSnapshot?: boolean; hasNativeCutoff?: boolean; sourceActive?: boolean },
      ) =>
        policy.decideForkExecution({
          commandId,
          threadId,
          providerInstanceId: ProviderInstanceId.make("codex"),
          capabilities: {
            ...baseCapabilities,
            threads: { ...baseCapabilities.threads, forkWhileSourceActive },
          },
          sameProvider: true,
          hasStrongNativeSource: true,
          sourceRunStatus: input.liveSnapshot === true ? "running" : "completed",
          fromSpecificTurn: input.liveSnapshot !== true,
          sourceActive: input.sourceActive ?? true,
          hasNativeCutoff: input.hasNativeCutoff ?? true,
          liveSnapshot: input.liveSnapshot ?? false,
        });

      assert.equal(yield* decide(undefined, { sourceActive: false }), "native_fork");
      assert.equal(yield* decide(undefined, {}), "portable_context");
      assert.equal(yield* decide("none", {}), "portable_context");
      assert.equal(yield* decide("stable", {}), "native_fork");
      assert.equal(yield* decide("stable", { hasNativeCutoff: false }), "portable_context");
      assert.equal(yield* decide("stable", { liveSnapshot: true }), "portable_context");
      assert.equal(yield* decide("live", { liveSnapshot: true }), "native_fork");
    }),
  );
});

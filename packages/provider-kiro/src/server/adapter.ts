import * as HostProcess from "@supaterm/shared/HostProcess";
import { resolveSelfInvocation, type SelfInvocation } from "@supaterm/shared/nodeRuntime";
import {
  type ModelSelection,
  ProviderDriverKind,
  type OrchestrationV2ProviderCapabilities,
} from "@supaterm/contracts";
import { KiroSettings } from "../settings.ts";
import { getModelSelectionStringOptionValue } from "@supaterm/shared/model";
import type * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import type * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import type * as EffectAcpSchema from "effect-acp/compat";
import * as EffectAcpErrors from "effect-acp/errors";

import type * as AcpSessionRuntime from "@supaterm/provider-acp/server/AcpSessionRuntime";
import {
  AcpProviderCapabilitiesV2,
  makeAcpAdapterV2,
  type AcpAdapterV2Flavor,
  type AcpAdapterV2RuntimeInput,
  type AcpAdapterV2SubagentUpdate,
} from "@supaterm/provider-acp/server/adapter";
import type { AcpToolCallState } from "@supaterm/provider-acp/server/runtimeModel";
import { makeAcpNativeLoggerFactory } from "@supaterm/provider-acp/server/nativeLogging";
import {
  ProviderAdapterDriverCreateError,
  type ProviderAdapterDriver,
  type ProviderAdapterDriverCreateInput,
} from "@supaterm/provider-core/server/adapterDriver";
import { makeProviderFailure } from "@supaterm/provider-core/server/failure";
import type * as IdAllocator from "@supaterm/provider-core/server/IdAllocator";
import { mergeProviderInstanceEnvironment } from "@supaterm/provider-core/server/instanceEnvironment";
import type * as McpProviderSessions from "@supaterm/provider-core/server/McpProviderSessions";
import * as ProviderEventLoggers from "@supaterm/provider-core/server/ProviderEventLoggers";
import type * as ProviderHost from "@supaterm/provider-core/server/ProviderHost";
import {
  KIRO_AGENT_CONFIG_ID,
  KIRO_AUTOPILOT_CONFIG_ID,
  KIRO_EFFORT_CONFIG_ID,
  KIRO_MODEL_CONFIG_ID,
  kiroApprovalOptions,
  kiroAutopilotValue,
  kiroPermissionDisposition,
  makeKiroAcpRuntime,
} from "./acpSupport.ts";

export const KIRO_PROVIDER = ProviderDriverKind.make("kiro");
const KIRO_DEFAULT_MODEL = "default";
const KIRO_COMPACT_METHOD = "_kiro/session/compact";
const KIRO_STEER_METHOD = "_session/steer";
const KIRO_FALLBACK_DEFAULT_MODEL = "auto";
const DEFAULT_KIRO_SETTINGS = Schema.decodeSync(KiroSettings)({});

const KiroProviderCapabilitiesV2 = {
  ...AcpProviderCapabilitiesV2,
  sessions: {
    ...AcpProviderCapabilitiesV2.sessions,
    supportsModelSwitchInSession: true,
  },
  threads: {
    ...AcpProviderCapabilitiesV2.threads,
    canForkThread: true,
    canForkFromTurn: true,
  },
  turns: {
    ...AcpProviderCapabilitiesV2.turns,
    supportsActiveSteering: true,
    activeSteeringInterruptsTools: false,
    activeSteeringAcceptsAttachments: false,
  },
  tools: {
    ...AcpProviderCapabilitiesV2.tools,
    supportsMcpTools: true,
  },
  subagents: {
    ...AcpProviderCapabilitiesV2.subagents,
    supportsSubagents: true,
    emitsSubagentLifecycle: true,
  },
} satisfies OrchestrationV2ProviderCapabilities;

const KiroCompactResult = Schema.Struct({ success: Schema.Boolean });
const decodeKiroCompactResult = Schema.decodeUnknownOption(KiroCompactResult);

const decodeKiroExtensionMethods = Schema.decodeUnknownOption(
  Schema.Struct({ kiro: Schema.Struct({ extensionMethods: Schema.Array(Schema.String) }) }),
);

const kiroCompactSession = {
  supported: (
    initializeResult: AcpSessionRuntime.AcpSessionRuntimeStartResult["initializeResult"],
  ) =>
    Option.exists(decodeKiroExtensionMethods(initializeResult.agentCapabilities?._meta), (meta) =>
      meta.kiro.extensionMethods.includes(KIRO_COMPACT_METHOD),
    ),
  compact: (runtime: AcpSessionRuntime.AcpSessionRuntime["Service"], sessionId: string) =>
    runtime.request(KIRO_COMPACT_METHOD, { sessionId }).pipe(
      Effect.flatMap((result) =>
        Option.exists(decodeKiroCompactResult(result), (decoded) => decoded.success)
          ? Effect.void
          : Effect.fail(
              new EffectAcpErrors.AcpRequestError({
                code: -32603,
                errorMessage: "Kiro could not compact the conversation.",
                method: KIRO_COMPACT_METHOD,
                data: result,
              }),
            ),
      ),
    ),
};

const KiroSteerResult = Schema.Struct({ queued: Schema.Literal(true), messageId: Schema.String });
const decodeKiroSteerResult = Schema.decodeUnknownOption(KiroSteerResult);
const KiroSteeringInjected = Schema.Struct({
  kiro: Schema.Struct({ kind: Schema.Literal("steering_injected"), messageId: Schema.String }),
});
const decodeKiroSteeringInjected = Schema.decodeUnknownOption(KiroSteeringInjected);

const kiroSteering = {
  send: (
    runtime: AcpSessionRuntime.AcpSessionRuntime["Service"],
    sessionId: string,
    text: string,
  ) =>
    runtime.request(KIRO_STEER_METHOD, { sessionId, message: text }).pipe(
      Effect.flatMap((result) =>
        Option.match(decodeKiroSteerResult(result), {
          onSome: (decoded) => Effect.succeed(decoded.messageId),
          onNone: () =>
            Effect.fail(
              new EffectAcpErrors.AcpRequestError({
                code: -32603,
                errorMessage: "Kiro did not queue the steering message.",
                method: KIRO_STEER_METHOD,
                data: result,
              }),
            ),
        }),
      ),
    ),
  injectedSteerId: (notification: EffectAcpSchema.SessionNotification) =>
    notification.update.sessionUpdate === "session_info_update"
      ? Option.getOrUndefined(decodeKiroSteeringInjected(notification.update._meta))?.kiro.messageId
      : undefined,
};

const decodeKiroForkCapability = Schema.decodeUnknownOption(
  Schema.Struct({ kiro: Schema.Struct({ messageId: Schema.Literal(true) }) }),
);
const decodeKiroUserMessageId = Schema.decodeUnknownOption(
  Schema.Struct({
    kiro: Schema.Struct({
      kind: Schema.Literal("user_message_id_assigned"),
      userMessageId: Schema.String,
    }),
  }),
);

const kiroForkFromTurn = {
  supported: (
    initializeResult: AcpSessionRuntime.AcpSessionRuntimeStartResult["initializeResult"],
  ) =>
    Option.isSome(
      decodeKiroForkCapability(
        initializeResult.agentCapabilities?.sessionCapabilities?.fork?._meta,
      ),
    ),
  nativeTurnId: (notification: EffectAcpSchema.SessionNotification) =>
    notification.update.sessionUpdate === "session_info_update"
      ? Option.getOrUndefined(decodeKiroUserMessageId(notification.update._meta))?.kiro
          .userMessageId
      : undefined,
  forkMeta: (messageId: string) => ({ kiro: { messageId } }),
};

export interface KiroAdapterV2Options {
  readonly instanceId: Parameters<typeof makeAcpAdapterV2>[0]["instanceId"];
  readonly settings: KiroSettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly selfInvocation: SelfInvocation;
  readonly nativeLogging?: Parameters<typeof makeAcpAdapterV2>[0]["nativeLogging"];
  /**
   * Kiro's id for "Kiro default" (the provider snapshot's `--list-models`
   * default). Absent, it is `auto`.
   */
  readonly defaultModel?: Effect.Effect<string>;
  /** Replaces the `kiro-cli` launch (replay tests). Kiro's session setup still applies. */
  readonly makeRuntime?: (
    input: AcpAdapterV2RuntimeInput,
  ) => Effect.Effect<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    EffectAcpErrors.AcpError,
    ChildProcessSpawner.ChildProcessSpawner | SecureRandom.SecureRandom | Scope.Scope
  >;
  readonly assertComplete?: Effect.Effect<void, EffectAcpErrors.AcpError>;
  readonly testHooks?: Parameters<typeof makeAcpAdapterV2>[0]["testHooks"];
}

const findKiroModelOption = (configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>) =>
  configOptions.find((option) => option.id === KIRO_MODEL_CONFIG_ID || option.category === "model");

const applyKiroModel = Effect.fn("KiroAdapterV2.applyKiroModel")(function* (
  runtime: AcpSessionRuntime.AcpSessionRuntime["Service"],
  modelSelection: ModelSelection,
  defaultModel: Effect.Effect<string>,
  agentSwitched: boolean,
) {
  const modelOption = findKiroModelOption(yield* runtime.getConfigOptions);
  const current = modelOption?.type === "select" ? modelOption.currentValue : undefined;
  const selected = modelSelection.model.trim();
  const isDefault = selected.length === 0 || selected === KIRO_DEFAULT_MODEL;
  if (isDefault && modelOption?.type !== "select" && !agentSwitched) {
    return current;
  }
  const requested = isDefault ? yield* defaultModel : selected;
  if (requested === current) {
    return current;
  }
  yield* runtime.setConfigOption(modelOption?.id ?? KIRO_MODEL_CONFIG_ID, requested, {
    allowUnlistedValue: true,
  });
  return requested;
});

const KIRO_MODEL_ADVERT_BOUND = "2 seconds";

const applyKiroEffort = Effect.fn("KiroAdapterV2.applyKiroEffort")(function* (
  runtime: AcpSessionRuntime.AcpSessionRuntime["Service"],
  modelSelection: ModelSelection,
  appliedModel: string | undefined,
) {
  const requested = getModelSelectionStringOptionValue(modelSelection, "reasoningEffort");
  if (requested === undefined) return;
  const advertised = yield* runtime.configOptionChanges.pipe(
    Stream.filter((configOptions) => {
      const modelOption = findKiroModelOption(configOptions);
      return (
        appliedModel === undefined ||
        (modelOption?.type === "select" && modelOption.currentValue === appliedModel)
      );
    }),
    Stream.runHead,
    Effect.timeoutOption(KIRO_MODEL_ADVERT_BOUND),
    Effect.map(Option.flatten),
  );
  if (Option.isNone(advertised)) {
    return yield* Effect.logWarning("Kiro did not advertise the model's reasoning effort", {
      waitedForWrittenModel: appliedModel !== undefined,
    });
  }
  const effortOption = advertised.value.find((option) => option.id === KIRO_EFFORT_CONFIG_ID);
  if (effortOption?.type !== "select" || !selectValues(effortOption).includes(requested)) {
    return;
  }
  yield* runtime.setConfigOption(KIRO_EFFORT_CONFIG_ID, requested).pipe(
    Effect.catchTags({
      AcpRequestError: (error) =>
        Effect.logWarning("Kiro rejected the reasoning effort", {
          value: requested,
          code: error.code,
        }),
    }),
  );
});

const applyKiroAgent = Effect.fn("KiroAdapterV2.applyKiroAgent")(function* (
  runtime: AcpSessionRuntime.AcpSessionRuntime["Service"],
  modelSelection: ModelSelection,
) {
  const requested = getModelSelectionStringOptionValue(modelSelection, KIRO_AGENT_CONFIG_ID);
  if (requested === undefined) return false;
  const agentOption = (yield* runtime.getConfigOptions).find(
    (option) => option.id === KIRO_AGENT_CONFIG_ID,
  );
  if (agentOption?.type !== "select" || agentOption.currentValue === requested) return false;
  if (!selectValues(agentOption).includes(requested)) {
    yield* Effect.logWarning("Kiro does not list the thread's agent", {
      listedAgents: selectValues(agentOption).length,
    });
    return false;
  }
  yield* runtime.setConfigOption(KIRO_AGENT_CONFIG_ID, requested);
  return true;
});

const applyKiroModelSelection =
  (defaultModel: Effect.Effect<string>): NonNullable<AcpAdapterV2Flavor["applyModelSelection"]> =>
  ({ runtime, modelSelection }) =>
    applyKiroAgent(runtime, modelSelection).pipe(
      Effect.flatMap((agentSwitched) =>
        applyKiroModel(runtime, modelSelection, defaultModel, agentSwitched),
      ),
      Effect.tap((appliedModel) => applyKiroEffort(runtime, modelSelection, appliedModel)),
    );

function selectValues(
  option: Extract<EffectAcpSchema.SessionConfigOption, { readonly type: "select" }>,
): ReadonlyArray<string> {
  return option.options.flatMap((entry) =>
    "value" in entry ? [entry.value] : entry.options.map((choice) => choice.value),
  );
}

const isAcpRequestError = Schema.is(EffectAcpErrors.AcpRequestError);

function isKiroPromptActivity(update: EffectAcpSchema.SessionUpdate): boolean {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
    case "agent_message":
    case "agent_thought_chunk":
    case "agent_thought":
    case "tool_call":
    case "tool_call_update":
    case "tool_call_content_chunk":
    case "plan_update":
      return true;
    case "session_info_update": {
      const kiro = update._meta?.kiro;
      return (
        typeof kiro === "object" && kiro !== null && "kind" in kiro && kiro.kind === "turn_start"
      );
    }
    default:
      return false;
  }
}

const KIRO_CANCEL_HOLD_BOUND = "2 seconds";

const KIRO_CLOUD_CONFIG_TOOL_ID = "fetch_cloud_config";

function makeKiroCloudConfigFilter() {
  const running = new Set<string>();
  return (notification: EffectAcpSchema.SessionNotification): boolean => {
    const { update } = notification;
    if (
      update.sessionUpdate !== "tool_call" &&
      update.sessionUpdate !== "tool_call_update" &&
      update.sessionUpdate !== "tool_call_content_chunk"
    ) {
      return false;
    }
    const key = `${notification.sessionId}\n${update.toolCallId}`;
    const kiro = update._meta?.kiro;
    const toolId =
      typeof kiro === "object" && kiro !== null && "toolId" in kiro ? kiro.toolId : null;
    if (toolId === KIRO_CLOUD_CONFIG_TOOL_ID) running.add(key);
    else if (!running.has(key)) return false;
    if ("status" in update && (update.status === "completed" || update.status === "failed")) {
      running.delete(key);
    }
    return true;
  };
}

const KIRO_STEERING_NOTE = "[STEERING steer-";
const decodeKiroSteeringInfo = Schema.decodeUnknownOption(
  Schema.Struct({ kiro: Schema.Struct({ kind: Schema.String }) }),
);

function steeringNotePrefixLength(text: string): number {
  for (let length = Math.min(text.length, KIRO_STEERING_NOTE.length - 1); length > 0; length -= 1) {
    if (KIRO_STEERING_NOTE.startsWith(text.slice(-length))) return length;
  }
  return 0;
}

function makeKiroSteeringNoteFilter() {
  const sessions = new Map<string, { held: string; inNote: boolean }>();
  return (
    notification: EffectAcpSchema.SessionNotification,
  ): EffectAcpSchema.SessionNotification => {
    const { update } = notification;
    if (update.sessionUpdate === "session_info_update") {
      const kind = Option.getOrUndefined(decodeKiroSteeringInfo(update._meta))?.kiro.kind;
      if (kind === "steering_injected") {
        sessions.set(notification.sessionId, { held: "", inNote: false });
      } else if (kind === "steering_cleared") sessions.delete(notification.sessionId);
      return notification;
    }
    const state = sessions.get(notification.sessionId);
    if (
      state === undefined ||
      update.sessionUpdate !== "agent_message_chunk" ||
      update.content.type !== "text"
    ) {
      return notification;
    }
    let pending = state.held + update.content.text;
    let visible = "";
    state.held = "";
    while (pending.length > 0) {
      if (state.inNote) {
        const end = pending.indexOf("]");
        if (end < 0) break;
        pending = pending.slice(end + 1);
        state.inNote = false;
        continue;
      }
      const start = pending.indexOf(KIRO_STEERING_NOTE);
      if (start >= 0) {
        visible += pending.slice(0, start).trimEnd();
        pending = pending.slice(start + KIRO_STEERING_NOTE.length);
        state.inNote = true;
        continue;
      }
      const held = steeringNotePrefixLength(pending);
      visible += pending.slice(0, pending.length - held);
      state.held = pending.slice(pending.length - held);
      break;
    }
    return {
      ...notification,
      update: { ...update, content: { ...update.content, text: visible } },
    };
  };
}

const decodeKiroAgentSubtask = Schema.decodeUnknownOption(
  Schema.Struct({
    kiro: Schema.Struct({ agentSubtaskId: Schema.String, kind: Schema.optionalKey(Schema.String) }),
  }),
);
const decodeKiroSubagentInput = Schema.decodeUnknownOption(
  Schema.Struct({ name: Schema.String, prompt: Schema.String }),
);

function normalizeKiroSessionUpdate(
  notification: EffectAcpSchema.SessionNotification,
): EffectAcpSchema.SessionNotification {
  const { update } = notification;
  const subtask = decodeKiroAgentSubtask("_meta" in update ? update._meta : undefined);
  return Option.isSome(subtask) && subtask.value.kiro.kind !== "agent-subtask"
    ? { ...notification, sessionId: subtask.value.kiro.agentSubtaskId }
    : notification;
}

function extractKiroSubagentUpdate(tool: AcpToolCallState): AcpAdapterV2SubagentUpdate | undefined {
  const subtask = decodeKiroAgentSubtask(tool.data.meta);
  if (Option.isNone(subtask) || subtask.value.kiro.kind !== "agent-subtask") return undefined;
  const input = decodeKiroSubagentInput(tool.data.rawInput);
  const status =
    tool.status === "failed" ? "failed" : tool.status === "completed" ? "completed" : "running";
  return {
    nativeTaskId: tool.toolCallId,
    childSessionId: subtask.value.kiro.agentSubtaskId,
    prompt: Option.isSome(input) ? input.value.prompt : (tool.title ?? "Kiro sub-agent"),
    title: Option.isSome(input) ? input.value.name : null,
    model: null,
    status,
    result: typeof tool.data.rawOutput === "string" ? tool.data.rawOutput : null,
  };
}

function kiroPromptFailure(cause: unknown) {
  return makeProviderFailure({
    cause,
    ...(isAcpRequestError(cause) ? { message: cause.errorMessage, code: String(cause.code) } : {}),
    class: "provider_error",
  });
}

function makeKiroAcpAdapterFlavor(options: KiroAdapterV2Options): AcpAdapterV2Flavor {
  const makeRuntime =
    options.makeRuntime ??
    ((input: AcpAdapterV2RuntimeInput) => {
      const { runtimePolicy: _runtimePolicy, processEnvironment, ...runtimeInput } = input;
      return makeKiroAcpRuntime({
        ...runtimeInput,
        settings: options.settings,
        environment: { ...options.environment, ...processEnvironment },
      });
    });
  const stripSteeringNote = makeKiroSteeringNoteFilter();
  return {
    driver: KIRO_PROVIDER,
    runtimeHarness: "Kiro",
    capabilities: KiroProviderCapabilitiesV2,
    clientCapabilitiesMeta: { kiro: { hooks: { enabled: true, v2: true } } },
    makeRuntime,
    promptFailure: kiroPromptFailure,
    ignoreSessionUpdate: makeKiroCloudConfigFilter(),
    normalizeSessionUpdate: (notification) =>
      stripSteeringNote(normalizeKiroSessionUpdate(notification)),
    extractSubagentUpdate: extractKiroSubagentUpdate,
    modelOptionArrivesLate: true,
    applyModelSelection: applyKiroModelSelection(
      options.defaultModel ?? Effect.succeed(KIRO_FALLBACK_DEFAULT_MODEL),
    ),
    ownedModelOptionIds: ["reasoningEffort", KIRO_AGENT_CONFIG_ID],
    sessionConfigForPolicy: (policy) => [
      { id: KIRO_AUTOPILOT_CONFIG_ID, value: kiroAutopilotValue(policy) },
    ],
    cancelAfterPromptStarts: { isStart: isKiroPromptActivity, bound: KIRO_CANCEL_HOLD_BOUND },
    permissionDisposition: kiroPermissionDisposition,
    approvalOptions: kiroApprovalOptions,
    compactSession: kiroCompactSession,
    steering: kiroSteering,
    forkFromTurn: kiroForkFromTurn,
    ...(options.assertComplete === undefined ? {} : { assertComplete: options.assertComplete }),
  };
}

export const makeKiroAdapterV2 = Effect.fn("makeKiroAdapterV2")(function* (
  options: KiroAdapterV2Options,
) {
  return yield* makeAcpAdapterV2({
    instanceId: options.instanceId,
    flavor: makeKiroAcpAdapterFlavor(options),
    selfInvocation: options.selfInvocation,
    ...(options.nativeLogging === undefined ? {} : { nativeLogging: options.nativeLogging }),
    ...(options.testHooks === undefined ? {} : { testHooks: options.testHooks }),
  });
});

export type KiroAdapterV2DriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | SecureRandom.SecureRandom
  | FileSystem.FileSystem
  | IdAllocator.IdAllocatorV2
  | Path.Path
  | McpProviderSessions.McpProviderSessions
  | ProviderEventLoggers.ProviderEventLoggers
  | ProviderHost.ProviderHost;

/** `defaultModel` reads Kiro's id for "Kiro default" from the provider snapshot. */
export const makeKiroAdapterV2Driver = (
  defaultModel: Effect.Effect<string>,
): ProviderAdapterDriver<KiroSettings, KiroAdapterV2DriverEnv> => ({
  driverKind: KIRO_PROVIDER,
  configSchema: KiroSettings,
  defaultConfig: (): KiroSettings => DEFAULT_KIRO_SETTINGS,
  create: Effect.fn("KiroAdapterV2Driver.create")(
    function* (input: ProviderAdapterDriverCreateInput<KiroSettings>) {
      const hostEnvironment = yield* HostProcess.Environment;
      const selfInvocation = yield* resolveSelfInvocation();
      const providerEventLoggers = yield* ProviderEventLoggers.ProviderEventLoggers;
      const makeNativeLogger = yield* makeAcpNativeLoggerFactory();
      return yield* makeKiroAdapterV2({
        instanceId: input.instanceId,
        settings: { ...input.config, enabled: input.enabled },
        environment: yield* mergeProviderInstanceEnvironment(input.environment, hostEnvironment),
        selfInvocation,
        defaultModel,
        nativeLogging: (threadId) =>
          makeNativeLogger({
            nativeEventLogger: providerEventLoggers.native,
            provider: KIRO_PROVIDER,
            threadId,
          }),
      });
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterDriverCreateError({
              driver: KIRO_PROVIDER,
              instanceId: input.instanceId,
              detail: "Failed to create Kiro ACP adapter.",
              cause,
            }),
        ),
      ),
  ),
});

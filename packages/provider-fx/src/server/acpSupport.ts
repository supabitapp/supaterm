import type * as EffectAcpSchema from "effect-acp/compat";
import {
  type ModelSelection,
  type ProviderOptionDescriptor,
  ProviderDriverKind,
  type RuntimeMode,
} from "@supaterm/contracts";
import type { FxSettings } from "../settings.ts";
import { getModelSelectionStringOptionValue } from "@supaterm/shared/model";
import type * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";

import * as AcpSessionRuntime from "@supaterm/provider-acp/server/AcpSessionRuntime";
import { collectSessionConfigOptionValues } from "@supaterm/provider-acp/server/runtimeModel";
import {
  acpPermissionDisposition,
  type AcpPermissionDisposition,
} from "@supaterm/provider-acp/server/clientPolicy";
import type * as ProviderAdapter from "@supaterm/provider-core/server/ProviderAdapter";

export const FX_DRIVER_KIND = ProviderDriverKind.make("fx");
export const FX_DEFAULT_MODEL_SLUG = "default";
const FX_MODEL_CONFIG_ID = "model";
const FX_MODE_CONFIG_ID = "mode";
const FX_EFFORT_CONFIG_ID = "effort";
const FX_DEFAULT_EFFORT = "medium";

const FX_EFFORT_LABELS = {
  auto: "Auto",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
} as const;

export const FX_EFFORT_OPTION_DESCRIPTOR: ProviderOptionDescriptor = {
  id: FX_EFFORT_CONFIG_ID,
  label: "Effort",
  type: "select",
  options: Object.entries(FX_EFFORT_LABELS).map(([id, label]) => ({
    id,
    label,
    ...(id === FX_DEFAULT_EFFORT ? { isDefault: true } : {}),
  })),
};

export const FX_SUPPORTED_RUNTIME_MODES = [
  "approval-required",
  "auto",
] as const satisfies ReadonlyArray<RuntimeMode>;
export const FX_ACP_CANCEL_BEHAVIOR = "wait-for-prompt" as const;

export function fxSessionModeForPolicy(
  policy: ProviderAdapter.ProviderAdapterV2RuntimePolicy,
): "ask" | "auto" {
  return policy.runtimeMode === "auto" &&
    policy.approvalPolicy === undefined &&
    policy.sandboxPolicy === undefined
    ? "auto"
    : "ask";
}

export function fxPermissionDisposition(
  policy: ProviderAdapter.ProviderAdapterV2RuntimePolicy,
  request: EffectAcpSchema.RequestPermissionRequest,
): AcpPermissionDisposition {
  return fxSessionModeForPolicy(policy) === "auto"
    ? "ask"
    : acpPermissionDisposition({ ...policy, runtimeMode: "approval-required" }, request);
}

function fxModeId(requested: string, advertised: ReadonlyArray<string>): string | undefined {
  const candidates =
    requested === "ask"
      ? ["ask"]
      : requested === "auto" || requested === "code"
        ? ["auto", "code"]
        : [];
  return candidates.find((id) => advertised.includes(id));
}

export function withFxSessionMode(
  runtime: AcpSessionRuntime.AcpSessionRuntime["Service"],
): AcpSessionRuntime.AcpSessionRuntime["Service"] {
  let pendingSessionId: string | undefined;
  const activated = <E, R>(
    effect: Effect.Effect<AcpSessionRuntime.AcpSessionRuntimeStartResult, E, R>,
  ) =>
    effect.pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          pendingSessionId = result.sessionId;
        }),
      ),
    );
  return {
    ...runtime,
    start: () => activated(runtime.start()),
    loadSession: (sessionId, options) => activated(runtime.loadSession(sessionId, options)),
    resumeSession: (sessionId, options) => activated(runtime.resumeSession(sessionId, options)),
    forkSession: (sessionId, options) => activated(runtime.forkSession(sessionId, options)),
    setMode: Effect.fn("setFxMode")(function* (requested) {
      const state = yield* runtime.getModeState;
      const advertised = state?.availableModes.map((mode) => mode.id) ?? [];
      const target = fxModeId(requested, advertised);
      if (target === undefined) {
        return yield* new EffectAcpErrors.AcpRequestError({
          code: -32602,
          errorMessage: `fx cannot run in mode "${requested}"; it advertises ${advertised.join(", ") || "no modes"}.`,
          data: {
            configId: FX_MODE_CONFIG_ID,
            allowedValues: advertised,
            receivedValue: requested,
          },
        });
      }
      const sessionId = pendingSessionId;
      if (sessionId === undefined || state?.currentModeId !== target) {
        const response = yield* runtime.setMode(target);
        pendingSessionId = undefined;
        return response;
      }
      yield* runtime.request("session/set_config_option", {
        sessionId,
        configId: FX_MODE_CONFIG_ID,
        value: target,
      });
      pendingSessionId = undefined;
      return {};
    }),
  };
}

export const applyFxModelSelection = Effect.fn("applyFxModelSelection")(function* (
  runtime: AcpSessionRuntime.AcpSessionRuntime["Service"],
  modelSelection: ModelSelection,
  defaultModel: Effect.Effect<string | undefined> | undefined,
): Effect.fn.Return<string | undefined, EffectAcpErrors.AcpError> {
  const option = (yield* runtime.getConfigOptions).find(
    (entry) => entry.id === FX_MODEL_CONFIG_ID && entry.type === "select",
  );
  const current = option?.type === "select" ? option.currentValue : undefined;
  const requested = modelSelection.model.trim();
  const isDefault = requested.length === 0 || requested === FX_DEFAULT_MODEL_SLUG;
  const target = isDefault ? defaultModel && (yield* defaultModel) : requested;
  if (target === undefined || target === current) return current;
  if (
    isDefault &&
    (option === undefined || !collectSessionConfigOptionValues(option).includes(target))
  ) {
    return current;
  }
  yield* runtime.setConfigOption(FX_MODEL_CONFIG_ID, target, { allowUnlistedValue: true });
  return target;
});

export const applyFxEffortDefault = Effect.fn("applyFxEffortDefault")(function* (
  runtime: AcpSessionRuntime.AcpSessionRuntime["Service"],
  modelSelection: ModelSelection,
): Effect.fn.Return<void, EffectAcpErrors.AcpError> {
  if (getModelSelectionStringOptionValue(modelSelection, FX_EFFORT_CONFIG_ID)) return;
  const option = (yield* runtime.getConfigOptions).find(
    (entry) => entry.id === FX_EFFORT_CONFIG_ID && entry.type === "select",
  );
  if (
    option !== undefined &&
    collectSessionConfigOptionValues(option).includes(FX_DEFAULT_EFFORT)
  ) {
    yield* runtime.setConfigOption(FX_EFFORT_CONFIG_ID, FX_DEFAULT_EFFORT);
  }
});

interface FxAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "spawn" | "cancelBehavior"
> {
  readonly fxSettings: Pick<FxSettings, "binaryPath">;
  readonly environment?: NodeJS.ProcessEnv;
}

export const makeFxAcpRuntime = Effect.fn("makeFxAcpRuntime")(function* (
  input: FxAcpRuntimeInput,
): Effect.fn.Return<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto | Scope.Scope
> {
  const { fxSettings, environment, ...runtimeOptions } = input;
  const context = yield* Layer.build(
    AcpSessionRuntime.layer({
      ...runtimeOptions,
      spawn: {
        command: fxSettings.binaryPath || "fx",
        args: ["acp"],
        cwd: input.cwd,
        env: { ...environment },
      },
      cancelBehavior: FX_ACP_CANCEL_BEHAVIOR,
    }),
  );
  return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(Effect.provide(context));
});

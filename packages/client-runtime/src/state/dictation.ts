import {
  AuthOrchestrationOperateScope,
  sessionGrantsScope,
  WS_METHODS,
  type AuthSessionState,
  type DictationCapability,
  type DictationSettings,
  type DictationSourceDescriptor,
  EnvironmentId,
  type ServerConfig,
} from "@supaterm/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "./runtime.ts";

export function createDictationEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    transcribe: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:dictation:transcribe",
      tag: WS_METHODS.dictationTranscribe,
    }),
  };
}

export interface DictationOffer {
  readonly capability: DictationCapability;
  readonly sources: ReadonlyArray<DictationSourceDescriptor>;
  readonly settings: DictationSettings;
}

export type DictationEnvironmentState =
  | { readonly status: "unknown" }
  | { readonly status: "unsupported" }
  | { readonly status: "forbidden" }
  | { readonly status: "offered"; readonly offer: DictationOffer };

const UNKNOWN: DictationEnvironmentState = { status: "unknown" };
const UNSUPPORTED: DictationEnvironmentState = { status: "unsupported" };
const FORBIDDEN: DictationEnvironmentState = { status: "forbidden" };

function projectDictationEnvironment(
  previous: DictationEnvironmentState | null,
  config: ServerConfig | null,
  session: AsyncResult.AsyncResult<AuthSessionState, unknown>,
): DictationEnvironmentState {
  const grant = Option.getOrNull(AsyncResult.value(session));
  const permitted =
    session._tag === "Failure" || grant === null
      ? previous?.status !== "forbidden"
      : sessionGrantsScope(grant, AuthOrchestrationOperateScope);
  if (config === null) {
    if (previous === null) return UNKNOWN;
    return permitted || previous.status !== "offered" ? previous : FORBIDDEN;
  }
  const capability = config.environment.capabilities.dictation;
  if (capability === undefined) return UNSUPPORTED;
  if (!permitted) return FORBIDDEN;
  const sources = config.dictation?.sources ?? [];
  const settings = config.settings.dictation;
  if (
    previous?.status === "offered" &&
    previous.offer.capability === capability &&
    previous.offer.sources === sources &&
    previous.offer.settings === settings
  ) {
    return previous;
  }
  return { status: "offered", offer: { capability, sources, settings } };
}

export function createDictationAvailabilityAtoms(input: {
  readonly serverConfigValueAtom: (environmentId: EnvironmentId) => Atom.Atom<ServerConfig | null>;
  readonly sessionStateAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<AsyncResult.AsyncResult<AuthSessionState, unknown>>;
}) {
  const environmentStateAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get): DictationEnvironmentState => {
      const previous = Option.getOrNull(get.self<DictationEnvironmentState>());
      const next = projectDictationEnvironment(
        previous,
        get(input.serverConfigValueAtom(environmentId)),
        get(input.sessionStateAtom(environmentId)),
      );
      return previous !== null && sameState(previous, next) ? previous : next;
    }).pipe(Atom.keepAlive, Atom.withLabel(`dictation:environment:${environmentId}`)),
  );
  return { environmentStateAtom };
}

function sameState(left: DictationEnvironmentState, right: DictationEnvironmentState): boolean {
  if (left.status !== "offered" || right.status !== "offered") return left.status === right.status;
  return left.offer === right.offer;
}

export type DictationHiddenReason =
  | "unknown"
  | "unsupported"
  | "forbidden"
  | "disabled"
  | "no-source"
  | "no-capture";

export type DictationAvailability =
  | { readonly kind: "hidden"; readonly reason: DictationHiddenReason }
  | {
      readonly kind: "needs-source";
      readonly environmentId: EnvironmentId;
      readonly sources: ReadonlyArray<DictationSourceDescriptor>;
    }
  | {
      readonly kind: "unavailable";
      readonly environmentId: EnvironmentId;
      readonly source: DictationSourceDescriptor;
    }
  | {
      readonly kind: "available";
      readonly environmentId: EnvironmentId;
      readonly source: DictationSourceDescriptor;
      readonly capability: DictationCapability;
    };

export function resolveDictationAvailability(input: {
  readonly environmentId: EnvironmentId;
  readonly state: DictationEnvironmentState;
  readonly captureSupported: boolean;
}): DictationAvailability {
  if (input.state.status !== "offered") return { kind: "hidden", reason: input.state.status };
  const { offer } = input.state;
  if (!offer.settings.enabled) return { kind: "hidden", reason: "disabled" };
  if (!input.captureSupported) return { kind: "hidden", reason: "no-capture" };
  const chosen = offer.settings.source;
  const source = chosen === null ? undefined : offer.sources.find((entry) => entry.id === chosen);
  if (source === undefined) {
    const sources = offer.sources.filter((entry) => entry.eligible);
    return sources.length === 0
      ? { kind: "hidden", reason: "no-source" }
      : { kind: "needs-source", environmentId: input.environmentId, sources };
  }
  return source.eligible
    ? {
        kind: "available",
        environmentId: input.environmentId,
        source,
        capability: offer.capability,
      }
    : { kind: "unavailable", environmentId: input.environmentId, source };
}

export const DictationRouting = Schema.Union([
  Schema.Struct({ mode: Schema.Literal("automatic") }),
  Schema.Struct({ mode: Schema.Literal("pinned"), environmentId: EnvironmentId }),
]);
export type DictationRouting = typeof DictationRouting.Type;

export const DEFAULT_DICTATION_ROUTING: DictationRouting = { mode: "automatic" };

/**
 * Picks the environment that transcribes for this device. Automatic prefers
 * the desktop's own server so audio stays on the machine and uses its
 * accounts; a pinned environment never falls back to another one.
 */
export function resolveDictationRoute(input: {
  readonly routing: DictationRouting;
  readonly draftEnvironmentId: EnvironmentId;
  readonly localEnvironmentId: EnvironmentId | null;
  readonly stateFor: (environmentId: EnvironmentId) => DictationEnvironmentState;
  readonly captureSupported: boolean;
}): DictationAvailability {
  const at = (environmentId: EnvironmentId) =>
    resolveDictationAvailability({
      environmentId,
      state: input.stateFor(environmentId),
      captureSupported: input.captureSupported,
    });
  if (input.routing.mode === "pinned") return at(input.routing.environmentId);
  const draft = at(input.draftEnvironmentId);
  const localId = input.localEnvironmentId;
  if (localId === null || localId === input.draftEnvironmentId) return draft;
  const local = at(localId);
  if (local.kind === "available") return local;
  if (draft.kind === "available" || local.kind === "hidden") return draft;
  return local;
}

export function dictationSourceLabel(
  source: Pick<DictationSourceDescriptor, "serviceLabel" | "accountLabel">,
): string {
  return source.accountLabel
    ? `Transcribed with ${source.serviceLabel} · ${source.accountLabel}`
    : `Transcribed with ${source.serviceLabel}`;
}

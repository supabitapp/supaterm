import {
  AuthOrchestrationOperateScope,
  resolveDictationSource,
  sessionGrantsScope,
  WS_METHODS,
  type AuthSessionState,
  type DictationCapability,
  type DictationSettings,
  type DictationSourceDescriptor,
  type EnvironmentId,
  type ProviderInstanceId,
  type ServerConfig,
} from "@supaterm/contracts";
import * as Option from "effect/Option";
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

export function projectDictationEnvironment(
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
      readonly kind: "available";
      readonly source: DictationSourceDescriptor;
      readonly capability: DictationCapability;
    };

export function resolveDictationAvailability(input: {
  readonly state: DictationEnvironmentState;
  readonly threadInstanceId: ProviderInstanceId | null;
  readonly captureSupported: boolean;
}): DictationAvailability {
  if (input.state.status !== "offered") return { kind: "hidden", reason: input.state.status };
  const { offer } = input.state;
  if (!offer.settings.enabled) return { kind: "hidden", reason: "disabled" };
  const source = resolveDictationSource({
    sources: offer.sources,
    settings: offer.settings,
    threadInstanceId: input.threadInstanceId,
  });
  if (source === null) return { kind: "hidden", reason: "no-source" };
  if (!input.captureSupported) return { kind: "hidden", reason: "no-capture" };
  return { kind: "available", source, capability: offer.capability };
}

export function dictationSourceLabel(
  source: Pick<DictationSourceDescriptor, "serviceLabel" | "accountLabel">,
): string {
  return source.accountLabel
    ? `Transcribed with ${source.serviceLabel} · ${source.accountLabel}`
    : `Transcribed with ${source.serviceLabel}`;
}

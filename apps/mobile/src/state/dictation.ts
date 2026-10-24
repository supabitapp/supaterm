import { useAtomValue } from "@effect/atom-react";
import {
  createDictationAvailabilityAtoms,
  createDictationEnvironmentAtoms,
  DEFAULT_DICTATION_ROUTING,
  resolveDictationAvailability,
  type DictationAvailability,
  type DictationEnvironmentState,
  type DictationRouting,
} from "@supaterm/client-runtime/state/dictation";
import type { EnvironmentId } from "@supaterm/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { Platform } from "react-native";

import { connectionAtomRuntime } from "../connection/runtime";
import { resolveVoiceRoute, type VoiceRoute } from "../features/voice-input/voiceRoute";
import { getNativeShowcaseScene } from "../features/showcase/nativeShowcaseScene";
import { createPcmVoiceRecorder } from "../native/pcmVoiceRecorder";
import { getLocalVoiceTranscriber } from "../native/voiceTranscription";
import { appAtomRegistry } from "./atom-registry";
import { mobilePreferencesAtom } from "./preferences";
import { environmentPresentations } from "./presentation";
import { serverEnvironment } from "./server";
import { environmentSession } from "./session";

export const dictationEnvironment = createDictationEnvironmentAtoms(connectionAtomRuntime);
export const dictationAvailability = createDictationAvailabilityAtoms({
  serverConfigValueAtom: serverEnvironment.configValueAtom,
  sessionStateAtom: environmentSession.sessionStateAtom,
});

// iOS records PCM through expo-audio; Android needs the local recorder module.
const PCM_VOICE_CAPTURE = Platform.OS === "ios" || createPcmVoiceRecorder !== null;

let onDeviceSupport: boolean | null = null;
export function supportsOnDeviceTranscription(): boolean {
  onDeviceSupport ??= getLocalVoiceTranscriber() !== null;
  return onDeviceSupport;
}

export const dictationRoutingAtom = Atom.make((get): DictationRouting => {
  const preferences = get(mobilePreferencesAtom);
  return AsyncResult.isSuccess(preferences)
    ? (preferences.value.dictationRouting ?? DEFAULT_DICTATION_ROUTING)
    : DEFAULT_DICTATION_ROUTING;
}).pipe(Atom.withLabel("mobile:dictation:routing"));

export const transcribeOnDeviceAtom = Atom.make((get) => {
  const preferences = get(mobilePreferencesAtom);
  return (
    AsyncResult.isSuccess(preferences) &&
    preferences.value.transcribeOnDevice === true &&
    supportsOnDeviceTranscription()
  );
}).pipe(Atom.withLabel("mobile:dictation:on-device"));

export const dictationReachableAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(
    (get) =>
      get(environmentPresentations.presentationAtom(environmentId))?.connection.phase ===
        "connected" && get(serverEnvironment.configValueAtom(environmentId)) !== null,
  ).pipe(Atom.withLabel(`mobile:dictation:reachable:${environmentId}`)),
);

export const dictationReachableEnvironmentsAtom = Atom.make((get): ReadonlySet<EnvironmentId> => {
  const reachable = new Set<EnvironmentId>();
  for (const environmentId of get(environmentPresentations.presentationsAtom).keys()) {
    if (get(dictationReachableAtom(environmentId))) reachable.add(environmentId);
  }
  const previous = Option.getOrNull(get.self<ReadonlySet<EnvironmentId>>());
  return previous !== null &&
    previous.size === reachable.size &&
    [...reachable].every((environmentId) => previous.has(environmentId))
    ? previous
    : reachable;
}).pipe(Atom.withLabel("mobile:dictation:reachable-environments"));

export function readDictationReachable(environmentId: EnvironmentId): boolean {
  return appAtomRegistry.get(dictationReachableAtom(environmentId));
}

const UNKNOWN_ENVIRONMENT_STATE_ATOM = Atom.make<DictationEnvironmentState>({
  status: "unknown",
}).pipe(Atom.withLabel("mobile:dictation:environment:none"));

function dictationEnvironmentStateAtom(environmentId: EnvironmentId | null) {
  return environmentId === null
    ? UNKNOWN_ENVIRONMENT_STATE_ATOM
    : dictationAvailability.environmentStateAtom(environmentId);
}

const UNKNOWN: DictationEnvironmentState = { status: "unknown" };
const SHOWCASE_ROUTE: VoiceRoute = { kind: "device" };
let showcase: boolean | null = null;
function isShowcase(): boolean {
  showcase ??= getNativeShowcaseScene() !== null;
  return showcase;
}

export function useVoiceRoute(environmentId: EnvironmentId | null): VoiceRoute {
  const routing = useAtomValue(dictationRoutingAtom);
  const onDevice = useAtomValue(transcribeOnDeviceAtom);
  const pinnedEnvironmentId = routing.mode === "pinned" ? routing.environmentId : null;
  const draftState = useAtomValue(dictationEnvironmentStateAtom(environmentId));
  const pinnedState = useAtomValue(dictationEnvironmentStateAtom(pinnedEnvironmentId));
  if (isShowcase()) return SHOWCASE_ROUTE;
  return resolveVoiceRoute({
    onDevice,
    routing,
    environmentId,
    stateFor: (id) =>
      id === pinnedEnvironmentId ? pinnedState : id === environmentId ? draftState : UNKNOWN,
    pcmCapture: PCM_VOICE_CAPTURE,
  });
}

export function readVoiceRoute(environmentId: EnvironmentId | null): VoiceRoute {
  if (isShowcase()) return SHOWCASE_ROUTE;
  return resolveVoiceRoute({
    onDevice: appAtomRegistry.get(transcribeOnDeviceAtom),
    routing: appAtomRegistry.get(dictationRoutingAtom),
    environmentId,
    stateFor: (id) => appAtomRegistry.get(dictationAvailability.environmentStateAtom(id)),
    pcmCapture: PCM_VOICE_CAPTURE,
  });
}

export function readDictationAvailability(environmentId: EnvironmentId): DictationAvailability {
  return resolveDictationAvailability({
    environmentId,
    state: appAtomRegistry.get(dictationAvailability.environmentStateAtom(environmentId)),
    captureSupported: true,
  });
}

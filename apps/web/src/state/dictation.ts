import { useAtomValue } from "@effect/atom-react";
import {
  createDictationAvailabilityAtoms,
  createDictationEnvironmentAtoms,
  DEFAULT_DICTATION_ROUTING,
  DictationRouting,
  resolveDictationAvailability,
  resolveDictationRoute,
  type DictationAvailability,
  type DictationEnvironmentState,
} from "@supaterm/client-runtime/state/dictation";
import type { EnvironmentId } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { primaryEnvironmentIdAtom } from "./primaryEnvironment";
import { serverEnvironment } from "./server";
import { environmentSession } from "./session";

export const dictationEnvironment = createDictationEnvironmentAtoms(connectionAtomRuntime);
export const dictationAvailability = createDictationAvailabilityAtoms({
  serverConfigValueAtom: serverEnvironment.configValueAtom,
  sessionStateAtom: environmentSession.sessionStateAtom,
});

const DICTATION_ROUTING_STORAGE_KEY = "supaterm:dictation-routing:v1";

export function isDictationCaptureSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof MediaRecorder !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

export function useDictationRouting() {
  return useLocalStorage(
    DICTATION_ROUTING_STORAGE_KEY,
    DEFAULT_DICTATION_ROUTING,
    DictationRouting,
  );
}

// Only the desktop app's own server is "this computer"; a browser's primary
// environment is whichever server served the page.
export function useLocalDictationEnvironmentId(): EnvironmentId | null {
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  return typeof window !== "undefined" && window.desktopBridge ? primaryEnvironmentId : null;
}

const UNKNOWN_ENVIRONMENT_STATE_ATOM = Atom.make<DictationEnvironmentState>({
  status: "unknown",
}).pipe(Atom.withLabel("dictation:environment:none"));

const environmentStateAtom = (environmentId: EnvironmentId | null) =>
  environmentId === null
    ? UNKNOWN_ENVIRONMENT_STATE_ATOM
    : dictationAvailability.environmentStateAtom(environmentId);

export function useDictationRoute(draftEnvironmentId: EnvironmentId | null): DictationAvailability {
  const [routing] = useDictationRouting();
  const localEnvironmentId = useLocalDictationEnvironmentId();
  const pinnedEnvironmentId = routing.mode === "pinned" ? routing.environmentId : null;
  const draftState = useAtomValue(environmentStateAtom(draftEnvironmentId));
  const localState = useAtomValue(environmentStateAtom(localEnvironmentId));
  const pinnedState = useAtomValue(environmentStateAtom(pinnedEnvironmentId));
  if (draftEnvironmentId === null) return { kind: "hidden", reason: "unknown" };
  const states = new Map<EnvironmentId, DictationEnvironmentState>([
    [draftEnvironmentId, draftState],
  ]);
  if (localEnvironmentId !== null) states.set(localEnvironmentId, localState);
  if (pinnedEnvironmentId !== null) states.set(pinnedEnvironmentId, pinnedState);
  return resolveDictationRoute({
    routing,
    draftEnvironmentId,
    localEnvironmentId,
    stateFor: (environmentId) => states.get(environmentId) ?? { status: "unknown" },
    captureSupported: isDictationCaptureSupported(),
  });
}

export function readDictationAvailability(environmentId: EnvironmentId): DictationAvailability {
  return resolveDictationAvailability({
    environmentId,
    state: appAtomRegistry.get(dictationAvailability.environmentStateAtom(environmentId)),
    captureSupported: true,
  });
}

import { useAtomValue } from "@effect/atom-react";
import {
  createDictationAvailabilityAtoms,
  createDictationEnvironmentAtoms,
  resolveDictationAvailability,
  type DictationAvailability,
} from "@supaterm/client-runtime/state/dictation";
import type { EnvironmentId, ProviderInstanceId } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { serverEnvironment } from "./server";
import { environmentSession } from "./session";

export const dictationEnvironment = createDictationEnvironmentAtoms(connectionAtomRuntime);
export const dictationAvailability = createDictationAvailabilityAtoms({
  serverConfigValueAtom: serverEnvironment.configValueAtom,
  sessionStateAtom: environmentSession.sessionStateAtom,
});

export function isDictationCaptureSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof MediaRecorder !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

const UNKNOWN_ENVIRONMENT_STATE_ATOM = Atom.make({ status: "unknown" as const }).pipe(
  Atom.withLabel("dictation:environment:none"),
);

export function useDictationAvailability(
  environmentId: EnvironmentId | null,
  threadInstanceId: ProviderInstanceId | null,
): DictationAvailability {
  const state = useAtomValue(
    environmentId === null
      ? UNKNOWN_ENVIRONMENT_STATE_ATOM
      : dictationAvailability.environmentStateAtom(environmentId),
  );
  return resolveDictationAvailability({
    state,
    threadInstanceId,
    captureSupported: isDictationCaptureSupported(),
  });
}

export function readDictationAvailability(
  environmentId: EnvironmentId,
  threadInstanceId: ProviderInstanceId | null,
): DictationAvailability {
  return resolveDictationAvailability({
    state: appAtomRegistry.get(dictationAvailability.environmentStateAtom(environmentId)),
    threadInstanceId,
    captureSupported: true,
  });
}

import type { EnvironmentId, ProjectId, ThreadId } from "@supaterm/contracts";
import { AsyncResult } from "effect/reactivity";
import { Platform } from "react-native";

import * as Dialog from "../../components/ui/Dialog";
import {
  resolveVoiceEngine,
  type VoiceEngineResolution,
  type VoiceTranscriptionEngine,
} from "../../lib/voiceEngine";
import { resolveVoiceLanguage, systemVoiceLanguage } from "../../lib/voiceLanguage";
import { getLocalVoiceTranscriber } from "../../native/voiceTranscription";
import { appAtomRegistry } from "../../state/atom-registry";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { serverEnvironment } from "../../state/server";
import { createEnvironmentVoiceTranscriber } from "../../state/transcription";
import type { VoiceInputEngine } from "./voiceInputSession";

export type VoiceTranscriptionContext = {
  readonly threadId?: ThreadId;
  readonly projectId?: ProjectId;
};

const DEVICE = Platform.OS === "ios" && Platform.isPad ? "iPad" : "iPhone";
export const ON_DEVICE_VOICE_LABEL = `This ${DEVICE}`;

type ComposerVoiceEngineResolution =
  | { readonly status: "ready"; readonly engine: VoiceInputEngine }
  | Extract<VoiceEngineResolution, { readonly status: "unavailable" }>;

function readPreferences() {
  const stored = appAtomRegistry.get(mobilePreferencesAtom);
  return AsyncResult.isSuccess(stored) ? stored.value : {};
}

function readVoiceLanguage(): string {
  return resolveVoiceLanguage(readPreferences().voiceLanguage, systemVoiceLanguage());
}

/** Read when recording starts, so a settings change never re-renders every composer. */
export function resolveComposerVoiceEngine(input: {
  readonly environmentId: EnvironmentId | null;
  readonly context?: VoiceTranscriptionContext;
  readonly preference?: VoiceTranscriptionEngine;
}): ComposerVoiceEngineResolution {
  const preference = input.preference ?? readPreferences().voiceTranscriptionEngine;
  const device = getLocalVoiceTranscriber();
  const language = readVoiceLanguage();
  const { environmentId } = input;
  if (environmentId === null && preference !== "device") {
    return {
      status: "unavailable",
      message: "Choose an environment to transcribe voice input.",
      offersDevice: device !== null,
    };
  }
  const resolution = resolveVoiceEngine({
    preference,
    deviceName: device === null ? null : ON_DEVICE_VOICE_LABEL,
    serverConfig:
      environmentId === null
        ? null
        : appAtomRegistry.get(serverEnvironment.configValueAtom(environmentId)),
    language,
  });
  if (resolution.status === "unavailable") return resolution;
  const transcriber =
    resolution.engine.kind === "device" || environmentId === null
      ? device
      : createEnvironmentVoiceTranscriber({
          environmentId,
          language,
          ...(input.context ? { context: input.context } : {}),
        });
  if (transcriber === null) {
    return {
      status: "unavailable",
      message: "Voice transcription is not available.",
      offersDevice: false,
    };
  }
  return { status: "ready", engine: { ...resolution.engine, transcriber, language } };
}

/**
 * Explains why the environment can't transcribe and, where it can, offers this device.
 * Resolves true once the user chose to transcribe on this device from now on.
 */
export function presentUnavailableVoiceEngine(
  resolution: Extract<VoiceEngineResolution, { readonly status: "unavailable" }>,
): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  Dialog.alert(
    "Voice input unavailable",
    resolution.message,
    resolution.offersDevice
      ? [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          {
            text: `Use this ${DEVICE}`,
            onPress: () => {
              appAtomRegistry.set(updateMobilePreferencesAtom, {
                voiceTranscriptionEngine: "device",
              });
              resolve(true);
            },
          },
        ]
      : [{ text: "OK", onPress: () => resolve(false) }],
    { cancelable: true, onDismiss: () => resolve(false) },
  );
  return promise;
}

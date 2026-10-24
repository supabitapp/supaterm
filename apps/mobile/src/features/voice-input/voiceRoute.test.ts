import type { DictationEnvironmentState } from "@supaterm/client-runtime/state/dictation";
import {
  DictationSourceId,
  EnvironmentId,
  type DictationSourceDescriptor,
} from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  resolveVoiceRecordingFormat,
  resolveVoiceRoute,
  UNSUPPORTED_RECORDING_REASON,
} from "./voiceRoute";

const THREAD_ENV = EnvironmentId.make("thread-env");
const PINNED_ENV = EnvironmentId.make("pinned-env");

function source(
  id: string,
  overrides: Partial<DictationSourceDescriptor> = {},
): DictationSourceDescriptor {
  return {
    id: DictationSourceId.make(id),
    kind: id.split(":")[0]!,
    runsOn: "environment",
    label: id,
    serviceLabel: "Claude",
    accountLabel: "me@example.com",
    eligible: true,
    audioFormats: ["wav"],
    ...overrides,
  };
}

function offered(
  sources: ReadonlyArray<DictationSourceDescriptor>,
  chosen: string | null,
): DictationEnvironmentState {
  return {
    status: "offered",
    offer: {
      capability: { maxClipBytes: 20 * 1024 * 1024, maxDurationMs: 300_000 },
      sources,
      settings: { enabled: true, source: chosen === null ? null : DictationSourceId.make(chosen) },
    },
  };
}

function route(input: {
  readonly states: Partial<Record<string, DictationEnvironmentState>>;
  readonly pinned?: EnvironmentId;
  readonly environmentId?: EnvironmentId | null;
  readonly onDevice?: boolean;
  readonly pcmCapture?: boolean;
}) {
  return resolveVoiceRoute({
    onDevice: input.onDevice ?? false,
    routing:
      input.pinned === undefined
        ? { mode: "automatic" }
        : { mode: "pinned", environmentId: input.pinned },
    environmentId: input.environmentId === undefined ? THREAD_ENV : input.environmentId,
    stateFor: (environmentId) => input.states[environmentId] ?? { status: "unknown" },
    pcmCapture: input.pcmCapture ?? true,
  });
}

describe("resolveVoiceRecordingFormat", () => {
  it("records compressed audio whenever the source reads it", () => {
    expect(resolveVoiceRecordingFormat(["webm", "m4a", "wav"], true)?.extension).toBe("m4a");
    expect(resolveVoiceRecordingFormat(["mp4", "wav"], true)?.extension).toBe("mp4");
  });

  it("records 16 kHz PCM for a WAV-only source", () => {
    expect(resolveVoiceRecordingFormat(["wav"], true)).toEqual({
      encoding: "pcm",
      extension: "wav",
      mimeType: "audio/wav",
    });
    expect(resolveVoiceRecordingFormat(["webm", "wav"], true)?.encoding).toBe("pcm");
  });

  it("never pairs a WAV-only source with compressed audio", () => {
    expect(resolveVoiceRecordingFormat(["wav"], false)).toBeNull();
    expect(resolveVoiceRecordingFormat(["webm"], true)).toBeNull();
  });
});

describe("resolveVoiceRoute", () => {
  it("transcribes on the device only when that is turned on", () => {
    expect(route({ states: {}, onDevice: true })).toEqual({ kind: "device" });
    expect(route({ states: {} }).kind).toBe("hidden");
  });

  it("uses the thread's environment and the format its chosen source reads", () => {
    const result = route({
      states: { [THREAD_ENV]: offered([source("claude:me")], "claude:me") },
    });
    expect(result).toMatchObject({
      kind: "available",
      environmentId: THREAD_ENV,
      source: { id: "claude:me" },
      format: { extension: "wav" },
    });
  });

  it("asks for an account instead of picking one", () => {
    const result = route({
      states: { [THREAD_ENV]: offered([source("claude:me"), source("codex:me")], null) },
    });
    expect(result.kind).toBe("needs-source");
  });

  it("reports a chosen account that cannot transcribe rather than falling back", () => {
    const result = route({
      states: {
        [THREAD_ENV]: offered(
          [
            source("claude:me", { eligible: false, unavailableReason: "Sign in to Claude." }),
            source("codex:me", { audioFormats: ["m4a"] }),
          ],
          "claude:me",
        ),
      },
    });
    expect(result).toMatchObject({
      kind: "unavailable",
      source: { id: "claude:me", unavailableReason: "Sign in to Claude." },
    });
  });

  it("never falls back from a pinned environment", () => {
    const states = {
      [THREAD_ENV]: offered([source("codex:me", { audioFormats: ["m4a"] })], "codex:me"),
    };
    expect(route({ states, pinned: PINNED_ENV }).kind).toBe("hidden");
    const pinned = route({
      states: { ...states, [PINNED_ENV]: offered([source("claude:pinned")], "claude:pinned") },
      pinned: PINNED_ENV,
    });
    expect(pinned).toMatchObject({ kind: "available", environmentId: PINNED_ENV });
  });

  it("routes to a pinned environment from a draft without one", () => {
    const result = route({
      states: { [PINNED_ENV]: offered([source("claude:pinned")], "claude:pinned") },
      pinned: PINNED_ENV,
      environmentId: null,
    });
    expect(result).toMatchObject({ kind: "available", environmentId: PINNED_ENV });
  });

  it("marks a source this device cannot record for as unavailable", () => {
    const result = route({
      states: { [THREAD_ENV]: offered([source("claude:me")], "claude:me") },
      pcmCapture: false,
    });
    expect(result).toMatchObject({
      kind: "unavailable",
      source: { unavailableReason: UNSUPPORTED_RECORDING_REASON },
    });
  });
});

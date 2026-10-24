import { act, useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { VoiceInputSession, type VoiceInputState } from "@supaterm/client-runtime/voice-input";
import { resetVoiceInputGlobalsForTests } from "../../../../../packages/client-runtime/src/voice-input/controller";

const store = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let revision = 0;
  return {
    focused: true,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => revision,
    notify() {
      revision += 1;
      for (const listener of listeners) listener();
    },
  };
});

vi.mock("react-native", () => ({ Keyboard: { dismiss: vi.fn() } }));
vi.mock("expo-haptics", () => ({ impactAsync: vi.fn(), ImpactFeedbackStyle: { Light: "light" } }));
vi.mock("@react-navigation/native", () => ({
  useFocusEffect: (callback: () => () => void) => {
    useSyncExternalStore(store.subscribe, store.snapshot);
    useEffect(() => (store.focused ? callback() : undefined), [callback, store.focused]);
  },
}));
vi.mock("./VoiceInputProvider", () => ({
  useGlobalVoiceInput: () => {
    useSyncExternalStore(store.subscribe, store.snapshot);
    return {
      state,
      session,
      ownerKey: session.ownerKey,
      isAvailable: true,
      isBusy: state.phase === "recording" || state.phase === "transcribing",
      setOwnerFocused,
      stop: () => session.controller.stop(),
      cancel: () => session.controller.cancel(),
    };
  },
}));

import { useVoiceInputController } from "./useVoiceInputController";

let state: VoiceInputState;
let session: VoiceInputSession;
let control: ReturnType<typeof useVoiceInputController>;
let root: Root;
let ownerKey: string;
let allowed: boolean;
const drafts = new Map<string, string>();
const sends = vi.fn<(text: string) => void>();
const setOwnerFocused = vi.fn();
let recording: ReturnType<typeof Promise.withResolvers<void>>;
let transcribing: ReturnType<typeof Promise.withResolvers<void>>;
let settled: ReturnType<typeof Promise.withResolvers<void>>;
let transcript: ReturnType<typeof Promise.withResolvers<string>>;

function Probe() {
  useSyncExternalStore(store.subscribe, store.snapshot);
  const key = ownerKey;
  const text = drafts.get(key) ?? "";
  const voice = useVoiceInputController({
    ownerKey: key,
    label: key,
    readDraftMessage: () => drafts.get(key) ?? null,
    subscribeToDraftChanges: store.subscribe,
    selection: { start: text.length, end: text.length },
    onChangeDraftMessage: (value) => {
      drafts.set(key, value);
      store.notify();
    },
    onChangeSelection: () => {},
    onSubmit: () => {
      if (allowed && !control.blocksSubmission) sends(text);
    },
  });
  useLayoutEffect(() => {
    control = voice;
  });
  return null;
}

async function start() {
  await act(async () => {
    control.start();
    await recording.promise;
  });
}

async function send() {
  await act(async () => {
    control.stopAndSubmit();
    await transcribing.promise;
  });
}

async function finish(text = "spoken words") {
  await act(async () => {
    transcript.resolve(text);
    await settled.promise;
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  resetVoiceInputGlobalsForTests();
  sends.mockClear();
  drafts.clear();
  drafts.set("first", "Draft");
  drafts.set("second", "Other");
  ownerKey = "first";
  allowed = true;
  store.focused = true;
  state = { phase: "idle", error: null, errorAction: null };
  recording = Promise.withResolvers<void>();
  transcribing = Promise.withResolvers<void>();
  settled = Promise.withResolvers<void>();
  transcript = Promise.withResolvers<string>();
  session = new VoiceInputSession({
    recorder: {
      uri: "file:///recording.m4a",
      prepareToRecordAsync: async () => {},
      record: () => {},
      stop: async () => {},
    },
    getTranscriber: () => ({
      prepare: async () => ({
        locale: "en-US",
        transcribe: () => {
          transcribing.resolve();
          return transcript.promise;
        },
      }),
    }),
    requestPermission: async () => ({ granted: true, canAskAgain: true }),
    configureRecording: async () => {},
    releaseRecording: async () => {},
    deleteRecording: () => {},
    onStateChange: (next) => {
      state = next;
      store.notify();
      if (next.phase === "recording") recording.resolve();
      if (next.phase === "idle" || next.phase === "error") settled.resolve();
    },
  });
  root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe />));
});

afterEach(() => {
  act(() => root.unmount());
  session.controller.dispose();
});

describe("dictation submission", () => {
  it("sends the committed transcript once, after the composer can submit again", async () => {
    await start();
    await send();
    act(() => control.stopAndSubmit());
    expect(sends).not.toHaveBeenCalled();
    await finish();
    expect(sends.mock.calls).toEqual([["Draft spoken words"]]);
  });

  it("stops for review without sending", async () => {
    await start();
    await act(async () => {
      void control.stop();
      await transcribing.promise;
    });
    await finish();
    expect(drafts.get("first")).toBe("Draft spoken words");
    expect(sends).not.toHaveBeenCalled();
  });

  it("can send after returning to a recording in a remounted composer", async () => {
    await start();
    act(() => root.render(null));
    act(() => root.render(<Probe />));
    await send();
    await finish();
    expect(sends.mock.calls).toEqual([["Draft spoken words"]]);
  });

  it.each(["blur", "owner", "permission"] as const)(
    "preserves the transcript without sending after a %s change",
    async (change) => {
      await start();
      await send();
      act(() => {
        if (change === "blur") store.focused = false;
        if (change === "owner") ownerKey = "second";
        if (change === "permission") allowed = false;
        store.notify();
      });
      await finish();
      expect(drafts.get("first")).toBe("Draft spoken words");
      expect(drafts.get("second")).toBe("Other");
      expect(sends).not.toHaveBeenCalled();
    },
  );

  it.each(["cancel", "empty", "error", "edited"] as const)(
    "does not send after %s transcription",
    async (outcome) => {
      await start();
      await send();
      act(() => {
        if (outcome === "cancel") control.cancel();
        if (outcome === "edited") {
          drafts.set("first", "Changed draft");
          store.notify();
        }
      });
      if (outcome === "error") {
        await act(async () => {
          transcript.reject(new Error("Transcription failed"));
          await settled.promise;
        });
      } else {
        await finish(outcome === "empty" ? " " : "spoken words");
      }
      expect(sends).not.toHaveBeenCalled();
      expect(drafts.get("first")).toBe(outcome === "edited" ? "Changed draft" : "Draft");
    },
  );
});

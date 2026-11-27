import { DEFAULT_CLIENT_SETTINGS, type DesktopCodexMicroBridge } from "@supaterm/contracts";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { __setClientSettingsForTests, getClientSettings } from "../../hooks/useSettings";
import { CodexMicroCoordinator } from "./CodexMicroCoordinator";
import { getCodexMicroBridge } from "./codexMicroBridge";

vi.mock("./codexMicroBridge", () => ({ getCodexMicroBridge: vi.fn() }));
const voice = vi.hoisted(() => ({ phase: "idle", listeners: new Set<() => void>() }));
const setVoicePhase = (phase: string) => {
  voice.phase = phase;
  for (const listener of voice.listeners) listener();
};
vi.mock("../../speech/useEnvironmentSpeechInput", () => ({
  useVoiceTranscriptionDestination: () => ({}),
}));
vi.mock("../../speech/voiceInputSession", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useRetainedVoiceInputSession: () => null,
    useVoiceInputSessionSnapshot: () => ({
      state: {
        phase: useSyncExternalStore(
          (listener) => {
            voice.listeners.add(listener);
            return () => voice.listeners.delete(listener);
          },
          () => voice.phase,
        ),
      },
    }),
  };
});

it("clears voice lighting when the coordinator leaves the app shell", async () => {
  const settings = getClientSettings();
  const setLighting = vi.fn<DesktopCodexMicroBridge["setLighting"]>().mockResolvedValue();
  const bridge: DesktopCodexMicroBridge = {
    setLighting,
    getState: vi.fn(),
    onStateChange: () => () => {},
    onInput: () => () => {},
  };
  vi.mocked(getCodexMicroBridge).mockReturnValue(bridge);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    codexMicro: { ...DEFAULT_CLIENT_SETTINGS.codexMicro, enabled: true },
  });
  try {
    await using screen = await render(<CodexMicroCoordinator />);
    setVoicePhase("recording");
    await vi.waitFor(() =>
      expect(setLighting).toHaveBeenLastCalledWith(
        expect.objectContaining({ voiceActivity: "recording" }),
      ),
    );
    await screen.unmount();
    expect(setLighting).toHaveBeenLastCalledWith({
      voiceActivity: "idle",
      slots: Array.from({ length: 6 }, () => ({ thread: null, status: "off", selected: false })),
    });
  } finally {
    setVoicePhase("idle");
    __setClientSettingsForTests(settings);
    vi.mocked(getCodexMicroBridge).mockReset();
  }
});

import { DEFAULT_CLIENT_SETTINGS, type DesktopCodexMicroBridge } from "@supaterm/contracts";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { __setClientSettingsForTests, getClientSettings } from "../../hooks/useSettings";
import { publishVoiceInputActivity } from "../../voice/voiceInputActivity";
import { CodexMicroCoordinator } from "./CodexMicroCoordinator";
import { getCodexMicroBridge } from "./codexMicroBridge";

vi.mock("./codexMicroBridge", () => ({ getCodexMicroBridge: vi.fn() }));

it("clears voice lighting when the coordinator leaves the app shell", async () => {
  const settings = getClientSettings();
  const owner = {};
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
    publishVoiceInputActivity(owner, "recording");
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
    publishVoiceInputActivity(owner, "idle");
    __setClientSettingsForTests(settings);
    vi.mocked(getCodexMicroBridge).mockReset();
  }
});

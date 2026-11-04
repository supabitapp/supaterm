import { describe, expect, it, vi } from "vite-plus/test";

import { act, fakeTimers, render } from "../../../test/render";
import { VoiceElapsed } from "./ComposerVoiceInput";

describe("VoiceElapsed", () => {
  it("turns over on the recording's whole seconds when the microphone opened late", async () => {
    using _clock = fakeTimers({ now: 0 });
    const readElapsedMs = vi.fn(() => Math.max(0, Date.now() - 300));
    const recorder = {
      get elapsedMs() {
        return readElapsedMs();
      },
    };
    await using screen = await render(<VoiceElapsed recorder={recorder} />);
    await expect.element(screen.getByText("0:00")).toBeInTheDocument();

    await act(() => vi.advanceTimersByTime(1_300));

    await expect.element(screen.getByText("0:01")).toBeInTheDocument();
  });
});

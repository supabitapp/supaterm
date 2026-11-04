import { expect, it, vi } from "vite-plus/test";

import {
  publishVoiceInputActivity,
  readVoiceInputActivity,
  subscribeVoiceInputActivity,
} from "./voiceInputActivity";

it("keeps the active recording visible when another composer finishes or unmounts", () => {
  const first = {};
  const second = {};
  const changed = vi.fn();
  const unsubscribe = subscribeVoiceInputActivity(changed);
  try {
    publishVoiceInputActivity(first, "preparing");
    expect(readVoiceInputActivity()).toBe("idle");
    expect(changed).not.toHaveBeenCalled();

    publishVoiceInputActivity(first, "transcribing");
    publishVoiceInputActivity(second, "recording");
    expect(readVoiceInputActivity()).toBe("recording");
    publishVoiceInputActivity(first, "idle");
    publishVoiceInputActivity(second, "recording");
    expect(readVoiceInputActivity()).toBe("recording");
    expect(changed).toHaveBeenCalledTimes(2);

    publishVoiceInputActivity(second, "transcribing");
    expect(readVoiceInputActivity()).toBe("transcribing");
    publishVoiceInputActivity(second, "error");
    expect(readVoiceInputActivity()).toBe("idle");
    publishVoiceInputActivity(second, "sending");
    expect(changed).toHaveBeenCalledTimes(4);
  } finally {
    unsubscribe();
    publishVoiceInputActivity(first, "idle");
    publishVoiceInputActivity(second, "idle");
  }
});

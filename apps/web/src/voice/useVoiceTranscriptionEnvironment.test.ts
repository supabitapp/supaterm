import { EnvironmentId } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { chooseVoiceTranscriptionEnvironment } from "./useVoiceTranscriptionEnvironment";

const LOCAL = EnvironmentId.make("local");
const REMOTE = EnvironmentId.make("remote");
const OTHER = EnvironmentId.make("other");

describe("chooseVoiceTranscriptionEnvironment", () => {
  it.each([
    ["auto, local can transcribe", { kind: "auto" }, LOCAL, true, LOCAL],
    ["auto, local can't transcribe", { kind: "auto" }, LOCAL, false, REMOTE],
    ["auto, no primary environment", { kind: "auto" }, null, true, REMOTE],
    ["thread, even when local could", { kind: "thread" }, LOCAL, true, REMOTE],
    [
      "a chosen environment, even when it can't",
      { kind: "environment", environmentId: OTHER },
      LOCAL,
      true,
      OTHER,
    ],
  ] as const)("%s", (_case, preference, primaryEnvironmentId, primaryCanTranscribe, expected) => {
    expect(
      chooseVoiceTranscriptionEnvironment({
        preference,
        threadEnvironmentId: REMOTE,
        primaryEnvironmentId,
        primaryCanTranscribe,
      }),
    ).toBe(expected);
  });
});

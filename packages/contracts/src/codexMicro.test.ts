import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  CodexMicroLayout,
  CodexMicroLightingModel,
  DEFAULT_CODEX_MICRO_LAYOUT,
  DEFAULT_CODEX_MICRO_SLOTS,
} from "./codexMicro.ts";
import { ClientSettingsSchema } from "./settings.ts";

const decodeLayout = Schema.decodeUnknownSync(CodexMicroLayout);
const decodeClientSettings = Schema.decodeUnknownSync(ClientSettingsSchema);
const decodeLightingModel = Schema.decodeUnknownSync(CodexMicroLightingModel);

describe("CodexMicroLayout", () => {
  it("fills every missing part of a saved layout from the defaults", () => {
    const layout = decodeLayout({
      slots: { ACT06: { keycapId: "TERM" } },
      encoderMode: "reasoning",
    });

    expect(layout.slots).toEqual({ ...DEFAULT_CODEX_MICRO_SLOTS, ACT06: { keycapId: "TERM" } });
    expect(layout.analogStick).toEqual(DEFAULT_CODEX_MICRO_LAYOUT.analogStick);
    expect(layout.encoderMode).toBe("reasoning");
    expect(layout.separateMicrophoneKeys).toBe(false);
  });

  it("starts the keyboard off with its default assignments", () => {
    const settings = decodeClientSettings({});

    expect(settings.codexMicroEnabled).toBe(false);
    expect(settings.codexMicroAgentSource).toBe("recent");
    expect(settings.codexMicroLayout).toEqual(DEFAULT_CODEX_MICRO_LAYOUT);
    expect(settings.codexMicroCustomAgentKeys.AG03).toBeNull();
  });
});

describe("CodexMicroLightingModel", () => {
  it("requires exactly one entry per agent key", () => {
    const slot = { thread: null, status: "off", selected: false };

    expect(() => decodeLightingModel({ slots: [slot], voice: "idle" })).toThrow();
    expect(
      decodeLightingModel({
        slots: Array.from({ length: 6 }, () => slot),
        voice: "idle",
      }).slots,
    ).toHaveLength(6);
  });
});

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
const encodeClientSettings = Schema.encodeSync(ClientSettingsSchema);
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

    expect(settings.codexMicro.enabled).toBe(false);
    expect(settings.codexMicro.agentSource).toBe("recent");
    expect(settings.codexMicro.layout).toEqual(DEFAULT_CODEX_MICRO_LAYOUT);
    expect(settings.codexMicro.customAgentKeys.AG03).toBeNull();
    expect(decodeClientSettings({ codexMicro: { enabled: true } }).codexMicro.layout).toEqual(
      DEFAULT_CODEX_MICRO_LAYOUT,
    );
  });

  it("clears removed voice actions without resetting the rest of the saved settings", () => {
    const voice = { type: "push-to-talk" };
    const settings = decodeClientSettings({
      codexMicro: {
        enabled: true,
        brightness: 35,
        layout: {
          slots: { ACT06: { keycapId: "FAST", action: voice } },
          analogStick: { ...DEFAULT_CODEX_MICRO_LAYOUT.analogStick, up: voice },
          encoder: { ...DEFAULT_CODEX_MICRO_LAYOUT.encoder, click: voice },
          encoderMode: "custom",
        },
        customAgentKeys: { AG00: { type: "action", action: voice } },
      },
    });

    expect(settings.codexMicro.enabled).toBe(true);
    expect(settings.codexMicro.brightness).toBe(35);
    expect(settings.codexMicro.layout.slots.ACT06).toEqual({ keycapId: "FAST", action: null });
    expect(settings.codexMicro.layout.analogStick.up).toBeNull();
    expect(settings.codexMicro.layout.analogStick.right).toEqual(
      DEFAULT_CODEX_MICRO_LAYOUT.analogStick.right,
    );
    expect(settings.codexMicro.layout.encoder.click).toBeNull();
    expect(settings.codexMicro.customAgentKeys.AG00).toBeNull();
    const encoded = encodeClientSettings(settings);
    expect(JSON.stringify(encoded)).not.toContain("push-to-talk");
    expect(decodeClientSettings(encoded)).toEqual(settings);
  });

  it("still rejects malformed supported actions", () => {
    expect(() =>
      decodeLayout({
        slots: { ACT06: { keycapId: "FAST", action: { type: "composer-text", text: "" } } },
      }),
    ).toThrow();
  });
});

describe("CodexMicroLightingModel", () => {
  it("requires exactly one entry per agent key", () => {
    const slot = { thread: null, status: "off", selected: false };

    expect(() => decodeLightingModel({ slots: [slot] })).toThrow();
    expect(
      decodeLightingModel({
        slots: Array.from({ length: 6 }, () => slot),
      }).slots,
    ).toHaveLength(6);
  });
});

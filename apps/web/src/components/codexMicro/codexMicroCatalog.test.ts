import { DEFAULT_CODEX_MICRO_LAYOUT } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  assignCodexMicroKeycap,
  codexMicroKeycapHolder,
  codexMicroKeycapsForSlot,
  codexMicroVisibleSlots,
  resolveCodexMicroEncoderAction,
  resolveCodexMicroSlotAction,
} from "./codexMicroCatalog";

describe("assignCodexMicroKeycap", () => {
  it("moves a keycap that is already on another key and gives that key the replaced keycap", () => {
    const layout = assignCodexMicroKeycap(DEFAULT_CODEX_MICRO_LAYOUT, "ACT06", {
      keycapId: "APPR",
    });

    expect(layout.slots.ACT06).toEqual({ keycapId: "APPR" });
    expect(layout.slots.ACT07).toEqual({ keycapId: "FAST" });
  });

  it("keeps a configured action on the key it was assigned to", () => {
    const layout = assignCodexMicroKeycap(DEFAULT_CODEX_MICRO_LAYOUT, "ACT12", {
      keycapId: "TERM",
      action: { type: "composer-text", text: "ship it" },
    });

    expect(resolveCodexMicroSlotAction(layout.slots.ACT12)).toEqual({
      type: "composer-text",
      text: "ship it",
    });
  });

  it("ignores the hidden microphone switches while they sit under the wide keycap", () => {
    const layout = assignCodexMicroKeycap(DEFAULT_CODEX_MICRO_LAYOUT, "ACT06", {
      keycapId: "MIC1",
    });

    expect(layout.slots.ACT06).toEqual({ keycapId: "MIC1" });
    expect(layout.slots.ACT10).toEqual(DEFAULT_CODEX_MICRO_LAYOUT.slots.ACT10);
  });
});

describe("codexMicroKeycapHolder", () => {
  it("finds the visible key that already has the keycap", () => {
    expect(codexMicroKeycapHolder(DEFAULT_CODEX_MICRO_LAYOUT, "ACT06", "APPR")).toBe("ACT07");
    expect(codexMicroKeycapHolder(DEFAULT_CODEX_MICRO_LAYOUT, "ACT06", "TERM")).toBeNull();
  });

  it("ignores the hidden microphone switches", () => {
    expect(codexMicroKeycapHolder(DEFAULT_CODEX_MICRO_LAYOUT, "ACT06", "MIC1")).toBeNull();
  });
});

describe("codexMicroVisibleSlots", () => {
  it("shows the wide microphone key or its two switches", () => {
    expect(codexMicroVisibleSlots({ separateMicrophoneKeys: false })).toContain("ACT10_ACT11");
    expect(codexMicroVisibleSlots({ separateMicrophoneKeys: true })).toEqual(
      expect.arrayContaining(["ACT10", "ACT11"]),
    );
    expect(codexMicroVisibleSlots({ separateMicrophoneKeys: true })).not.toContain("ACT10_ACT11");
  });

  it("offers only keycaps that fit the key", () => {
    expect(codexMicroKeycapsForSlot("ACT10_ACT11").map((keycap) => keycap.id)).toEqual([
      "MIC",
      "EMPT5",
    ]);
    expect(codexMicroKeycapsForSlot("ACT06").some((keycap) => keycap.size === "double")).toBe(
      false,
    );
  });
});

describe("resolveCodexMicroSlotAction", () => {
  it("keeps cleared assignments and microphone keycaps unassigned", () => {
    expect(resolveCodexMicroSlotAction({ keycapId: "FAST", action: null })).toBeNull();
    expect(resolveCodexMicroSlotAction({ keycapId: "MIC" })).toBeNull();
    expect(resolveCodexMicroSlotAction({ keycapId: "MIC1" })).toBeNull();
  });

  it("uses the keycap's default unless the key has its own action", () => {
    expect(resolveCodexMicroSlotAction({ keycapId: "APPR" })).toEqual({
      type: "command",
      command: "thread.approve",
    });
    expect(resolveCodexMicroSlotAction({ keycapId: "EMPT1" })).toBeNull();
  });
});

describe("resolveCodexMicroEncoderAction", () => {
  it("scrolls the conversation by default and opens settings on press and hold", () => {
    expect(resolveCodexMicroEncoderAction(DEFAULT_CODEX_MICRO_LAYOUT, "right")).toEqual({
      type: "command",
      command: "conversation.scrollDown",
    });
    expect(resolveCodexMicroEncoderAction(DEFAULT_CODEX_MICRO_LAYOUT, "longPress")).toEqual({
      type: "open-codex-micro-settings",
    });
  });

  it("raises reasoning effort when turned clockwise in reasoning mode", () => {
    expect(
      resolveCodexMicroEncoderAction(
        { ...DEFAULT_CODEX_MICRO_LAYOUT, encoderMode: "reasoning" },
        "right",
      ),
    ).toEqual({ type: "command", command: "composer.increaseEffort" });
  });

  it("runs only the assigned actions in custom mode", () => {
    const layout = {
      ...DEFAULT_CODEX_MICRO_LAYOUT,
      encoderMode: "custom" as const,
      encoder: { ...DEFAULT_CODEX_MICRO_LAYOUT.encoder, click: { type: "open-settings" as const } },
    };

    expect(resolveCodexMicroEncoderAction(layout, "click")).toEqual({ type: "open-settings" });
    expect(resolveCodexMicroEncoderAction(layout, "longPress")).toBeNull();
  });
});

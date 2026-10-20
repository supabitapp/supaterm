import {
  DEFAULT_CODEX_MICRO_LAYOUT,
  EnvironmentId,
  ProjectId,
  ThreadId,
  type CodexMicroAgentAssignment,
  type CodexMicroDeviceState,
  type CodexMicroLayout,
} from "@supaterm/contracts";
import { scopedProjectKey, scopedThreadKey } from "@supaterm/client-runtime/environment";
import { describe, expect, it } from "vite-plus/test";

import { CODEX_MICRO_KEYCAPS } from "../codexMicroCatalog";
import {
  codexMicroAgentKeyView,
  codexMicroConnectionSummary,
  codexMicroDeviceDetails,
  codexMicroEncoderInputLabel,
  codexMicroLayoutWithEncoderAction,
  codexMicroLayoutWithEncoderMode,
  codexMicroPressedKey,
  codexMicroStatusLights,
  codexMicroThreadChoices,
  filterCodexMicroCommandGroups,
  filterCodexMicroKeycaps,
  resetCodexMicroLayout,
} from "./CodexMicroSettings.logic";

const connected: CodexMicroDeviceState = {
  status: "connected",
  controlPlane: "available",
  error: null,
  battery: { percentage: 81.6, isCharging: true },
  firmwareVersion: "1.4.0",
  inputMonitoring: "granted",
};

describe("codexMicroConnectionSummary", () => {
  it("reports off while the feature is disabled, whatever main last published", () => {
    expect(codexMicroConnectionSummary(false, connected).label).toBe("Off");
  });

  it("claims nothing before the first device state arrives", () => {
    expect(codexMicroConnectionSummary(true, null).label).toBeNull();
  });

  it("labels an available device as connected", () => {
    expect(codexMicroConnectionSummary(true, connected).label).toBe("Connected");
  });

  it("explains that key presses keep working when lighting is unavailable", () => {
    const summary = codexMicroConnectionSummary(true, {
      ...connected,
      controlPlane: "unavailable",
    });
    expect(summary.tone).toBe("warning");
    expect(summary.description).toContain("Key presses still work");
  });
});

describe("codexMicroDeviceDetails", () => {
  it("lists battery, charging, and firmware for a connected device", () => {
    expect(codexMicroDeviceDetails(connected)).toBe("Battery 82%, charging · Firmware 1.4.0");
  });

  it("omits facts the device has not reported", () => {
    expect(
      codexMicroDeviceDetails({
        ...connected,
        battery: { percentage: 40, isCharging: null },
        firmwareVersion: null,
      }),
    ).toBe("Battery 40%");
    expect(
      codexMicroDeviceDetails({ ...connected, battery: null, firmwareVersion: null }),
    ).toBeNull();
  });

  it("shows no stale battery once the device disconnects", () => {
    expect(codexMicroDeviceDetails({ ...connected, status: "not-detected" })).toBeNull();
  });
});

describe("codexMicroStatusLights", () => {
  it("warns about a low battery that is not charging", () => {
    expect(
      codexMicroStatusLights(true, { ...connected, battery: { percentage: 12, isCharging: false } })
        .battery,
    ).toBe("warning");
    expect(
      codexMicroStatusLights(true, { ...connected, battery: { percentage: 12, isCharging: true } })
        .battery,
    ).toBe("success");
  });
});

describe("resetCodexMicroLayout", () => {
  it("restores keys, stick, and knob but keeps how the microphone switches are split", () => {
    const customized: CodexMicroLayout = {
      ...DEFAULT_CODEX_MICRO_LAYOUT,
      slots: { ...DEFAULT_CODEX_MICRO_LAYOUT.slots, ACT06: { keycapId: "TERM" } },
      analogStick: { ...DEFAULT_CODEX_MICRO_LAYOUT.analogStick, up: null },
      encoder: { ...DEFAULT_CODEX_MICRO_LAYOUT.encoder, click: { type: "open-settings" } },
      encoderMode: "custom",
      separateMicrophoneKeys: true,
    };
    expect(resetCodexMicroLayout(customized)).toEqual({
      ...DEFAULT_CODEX_MICRO_LAYOUT,
      separateMicrophoneKeys: true,
    });
  });
});

describe("knob modes", () => {
  it("starts Custom from what the built-in mode did", () => {
    const custom = codexMicroLayoutWithEncoderMode(DEFAULT_CODEX_MICRO_LAYOUT, "custom");
    expect(custom.encoderMode).toBe("custom");
    expect(custom.encoder.left).toEqual({ type: "command", command: "conversation.scrollUp" });
    expect(custom.encoder.click).toEqual({ type: "command", command: "conversation.scrollToEnd" });
  });

  it("keeps earlier custom assignments when returning to Custom", () => {
    const earlier: CodexMicroLayout = {
      ...DEFAULT_CODEX_MICRO_LAYOUT,
      encoderMode: "reasoning",
      encoder: { left: null, right: null, click: { type: "open-settings" }, longPress: null },
    };
    expect(codexMicroLayoutWithEncoderMode(earlier, "custom").encoder).toEqual(earlier.encoder);
  });

  it("assigning one input switches to Custom without clearing the others", () => {
    const next = codexMicroLayoutWithEncoderAction(
      { ...DEFAULT_CODEX_MICRO_LAYOUT, encoderMode: "reasoning" },
      "click",
      { type: "command", command: "thread.fork" },
    );
    expect(next.encoderMode).toBe("custom");
    expect(next.encoder).toEqual({
      left: { type: "command", command: "composer.decreaseEffort" },
      right: { type: "command", command: "composer.increaseEffort" },
      click: { type: "command", command: "thread.fork" },
      longPress: { type: "open-codex-micro-settings" },
    });
  });

  it("describes built-in long press as opening Codex Micro settings", () => {
    expect(codexMicroEncoderInputLabel(DEFAULT_CODEX_MICRO_LAYOUT, "longPress")).toBe(
      "Open Codex Micro settings",
    );
    expect(
      codexMicroEncoderInputLabel(
        { ...DEFAULT_CODEX_MICRO_LAYOUT, encoderMode: "custom" },
        "longPress",
      ),
    ).toBe("Unassigned");
  });
});

describe("codexMicroPressedKey", () => {
  const merged = { separateMicrophoneKeys: false };
  const separate = { separateMicrophoneKeys: true };

  it("lights the wide key for either microphone switch unless they are separate", () => {
    expect(codexMicroPressedKey({ type: "key", slot: "ACT11", phase: "press" }, merged)).toBe(
      "ACT10_ACT11",
    );
    expect(codexMicroPressedKey({ type: "key", slot: "ACT11", phase: "press" }, separate)).toBe(
      "ACT11",
    );
    expect(
      codexMicroPressedKey({ type: "key", slot: "ACT10_ACT11", phase: "press" }, separate),
    ).toBeNull();
  });

  it("ignores key releases", () => {
    expect(
      codexMicroPressedKey({ type: "key", slot: "ACT06", phase: "release" }, merged),
    ).toBeNull();
  });

  it("maps agent keys, the stick, and the knob", () => {
    expect(
      codexMicroPressedKey({ type: "agent-key", key: "AG03", thread: null, focus: false }, merged),
    ).toBe("AG03");
    expect(codexMicroPressedKey({ type: "joystick", direction: "left" }, merged)).toBe("stick");
    expect(codexMicroPressedKey({ type: "encoder", input: "longPress" }, merged)).toBe("knob");
  });
});

describe("codexMicroAgentKeyView", () => {
  const thread: CodexMicroAgentAssignment = {
    type: "thread",
    environmentId: EnvironmentId.make("env"),
    threadId: ThreadId.make("thread-1"),
  };
  const titles = new Map([[scopedThreadKey(thread), "Fix login"]]);

  it("prefers the live binding the keyboard shows", () => {
    expect(
      codexMicroAgentKeyView(
        "AG01",
        { title: "Release notes", status: "working", action: null },
        thread,
        titles,
      ),
    ).toEqual({ key: "AG01", number: 2, label: "Release notes", status: "working" });
  });

  it("falls back to the custom assignment while the feature is off", () => {
    expect(codexMicroAgentKeyView("AG00", null, thread, titles).label).toBe("Fix login");
    expect(codexMicroAgentKeyView("AG00", null, null, titles).label).toBe("Unassigned");
    expect(codexMicroAgentKeyView("AG00", null, undefined, titles).label).toBeNull();
  });
});

describe("search", () => {
  it("finds keycaps by printed label and default action", () => {
    expect(filterCodexMicroKeycaps(CODEX_MICRO_KEYCAPS, "term").map((keycap) => keycap.id)).toEqual(
      ["TERM"],
    );
    expect(
      filterCodexMicroKeycaps(CODEX_MICRO_KEYCAPS, "fork").map((keycap) => keycap.id),
    ).toContain("SPLIT");
  });

  it("drops command groups with no matching action", () => {
    const groups = filterCodexMicroCommandGroups("toggle terminal");
    expect(groups.map((group) => group.label)).toEqual(["Panels"]);
    expect(groups[0]?.options.map((option) => option.label)).toEqual(["Toggle terminal"]);
  });
});

describe("codexMicroThreadChoices", () => {
  const environmentId = EnvironmentId.make("env");
  const projectId = ProjectId.make("project");
  const thread = (id: string, updatedAt: string, overrides: object = {}) => ({
    environmentId,
    id: ThreadId.make(id),
    projectId,
    title: `Thread ${id}`,
    updatedAt,
    archivedAt: null,
    deletedAt: null,
    ...overrides,
  });
  const projects = new Map([[scopedProjectKey({ environmentId, projectId }), "Supaterm"]]);

  it("lists live threads newest first and matches project titles", () => {
    const { choices } = codexMicroThreadChoices(
      [
        thread("a", "2026-01-01"),
        thread("b", "2026-03-01"),
        thread("c", "2026-02-01", { archivedAt: "2026-02-02" }),
        thread("d", "2026-04-01", { deletedAt: "2026-04-02" }),
      ],
      projects,
      "supaterm",
      10,
    );
    expect(choices.map((choice) => choice.thread.id)).toEqual(["b", "a"]);
    expect(choices[0]?.projectTitle).toBe("Supaterm");
  });

  it("reports when the limit hides older matches", () => {
    const result = codexMicroThreadChoices(
      [thread("a", "2026-01-01"), thread("b", "2026-02-01")],
      projects,
      "",
      1,
    );
    expect(result.choices.map((choice) => choice.thread.id)).toEqual(["b"]);
    expect(result.truncated).toBe(true);
  });
});

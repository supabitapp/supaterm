import {
  CODEX_MICRO_AGENT_KEYS,
  CODEX_MICRO_SLOT_COUNT,
  CODEX_MICRO_STATUS_COLORS,
  CodexMicroAgentKey,
  CodexMicroAgentSource,
  CodexMicroAutoDim,
  CodexMicroEncoderMode,
  DEFAULT_CODEX_MICRO_LAYOUT,
  type CodexMicroAction,
  type CodexMicroActionSlot,
  type CodexMicroAgentAssignment,
  type CodexMicroDeviceState,
  type CodexMicroEncoderInput,
  type CodexMicroInputEvent,
  type CodexMicroLayout,
  type CodexMicroPermissionStatus,
  type CodexMicroSlotStatus,
  type EnvironmentId,
  type ProjectId,
  type ThreadId,
} from "@supaterm/contracts";
import { scopedProjectKey, scopedThreadKey } from "@supaterm/client-runtime/environment";
import * as Schema from "effect/Schema";
import { msg } from "gt-react";

import { m, type MessageResolver } from "~/i18n/messages";

import {
  CODEX_MICRO_COMMAND_GROUPS,
  CODEX_MICRO_ENCODER_PRESETS,
  codexMicroActionLabel,
  codexMicroVisibleSlots,
  resolveCodexMicroEncoderAction,
  type CodexMicroCommandGroup,
  type CodexMicroKeycap,
} from "../codexMicroCatalog";
import type { CodexMicroSlotView } from "../codexMicroStore";

export type CodexMicroKeyId = CodexMicroAgentKey | CodexMicroActionSlot | "stick" | "knob";

export type CodexMicroTone = "muted" | "success" | "warning" | "error";

interface CodexMicroConnectionSummary {
  readonly label: string | null;
  readonly description: string | null;
  readonly tone: CodexMicroTone;
}

export function codexMicroConnectionSummary(
  enabled: boolean,
  state: CodexMicroDeviceState | null,
  resolve: MessageResolver = m,
): CodexMicroConnectionSummary {
  const off = resolve(msg("Off", { $context: "Codex Micro connection status" }));
  if (!enabled) return { label: off, description: null, tone: "muted" };
  if (state === null) return { label: null, description: null, tone: "muted" };
  switch (state.status) {
    case "disabled":
      return { label: off, description: null, tone: "muted" };
    case "not-detected":
      return {
        label: resolve(msg("Not detected")),
        description: resolve(msg("Connect Codex Micro or Creator Micro 2 with USB.")),
        tone: "muted",
      };
    case "detected":
      return {
        label: resolve(msg("Detected", { $context: "Codex Micro connection status" })),
        description: null,
        tone: "muted",
      };
    case "connected": {
      const connected = resolve(msg("Connected", { $context: "Codex Micro connection status" }));
      if (state.controlPlane === "unavailable") {
        return {
          label: resolve(msg("Connected with limited functionality")),
          description: resolve(
            msg("Key presses still work. Lighting and battery are temporarily unavailable."),
          ),
          tone: "warning",
        };
      }
      if (state.mappedAgentKeys !== null && state.mappedAgentKeys < CODEX_MICRO_SLOT_COUNT) {
        return {
          label: connected,
          description:
            state.mappedAgentKeys === 0
              ? resolve(
                  msg(
                    "No keys are mapped in the keyboard's keymap. A key follows a thread only when it is mapped to KV_OAI_AG00 through KV_OAI_AG05.",
                  ),
                )
              : resolve(
                  msg(
                    "Only {mapped} of the {total} agent keys are mapped in the keyboard's keymap. A key follows a thread only when it is mapped to KV_OAI_AG00 through KV_OAI_AG05.",
                    { mapped: state.mappedAgentKeys, total: CODEX_MICRO_SLOT_COUNT },
                  ),
                ),
          tone: "warning",
        };
      }
      return { label: connected, description: null, tone: "success" };
    }
    case "error":
      if (state.error === "discovery-failed") {
        return {
          label: resolve(msg("Discovery failed")),
          description: resolve(
            msg("Supaterm couldn't look for Codex Micro. Supaterm keeps trying."),
          ),
          tone: "error",
        };
      }
      return {
        label: resolve(msg("Connection problem")),
        description: resolve(msg("Supaterm couldn't talk to Codex Micro. Supaterm keeps trying.")),
        tone: "error",
      };
  }
}

/** Battery and firmware facts, only while a device is connected. */
export function codexMicroDeviceDetails(
  state: CodexMicroDeviceState | null,
  resolve: MessageResolver = m,
): string | null {
  if (state?.status !== "connected") return null;
  const details: string[] = [];
  if (state.battery !== null) {
    const percentage = Math.round(state.battery.percentage);
    details.push(
      state.battery.isCharging === true
        ? resolve(msg("Battery {percentage}%, charging", { percentage }))
        : resolve(msg("Battery {percentage}%", { percentage })),
    );
  }
  if (state.firmwareVersion !== null) {
    details.push(resolve(msg("Firmware {version}", { version: state.firmwareVersion })));
  }
  return details.length > 0 ? details.join(" · ") : null;
}

export const CODEX_MICRO_PERMISSION_LABELS: Readonly<Record<CodexMicroPermissionStatus, string>> = {
  granted: msg("Granted", { $context: "permission status" }),
  denied: msg("Not granted", { $context: "permission status" }),
  unavailable: msg("Unavailable", { $context: "permission status" }),
};

const LOW_BATTERY_PERCENTAGE = 20;

export interface CodexMicroStatusLights {
  readonly connection: CodexMicroTone;
  readonly battery: CodexMicroTone;
  readonly label: string;
}

function batteryTone(state: CodexMicroDeviceState | null): CodexMicroTone {
  const battery = state?.status === "connected" ? state.battery : null;
  if (battery === null) return "muted";
  const low = battery.percentage <= LOW_BATTERY_PERCENTAGE && battery.isCharging !== true;
  return low ? "warning" : "success";
}

export function codexMicroStatusLights(
  enabled: boolean,
  state: CodexMicroDeviceState | null,
  resolve: MessageResolver = m,
): CodexMicroStatusLights {
  const summary = codexMicroConnectionSummary(enabled, state, resolve);
  const details = codexMicroDeviceDetails(state, resolve);
  return {
    connection: summary.tone,
    battery: batteryTone(state),
    label: ["Codex Micro", summary.label ?? resolve(msg("status unknown")), details]
      .filter((part) => part !== null)
      .join(", "),
  };
}

export const CODEX_MICRO_AUTO_DIM_LABELS: Readonly<Record<CodexMicroAutoDim, string>> = {
  off: msg("Off", { $context: "auto-dim setting" }),
  "30-seconds": msg("30 seconds"),
  "1-minute": msg("1 minute"),
  "3-minutes": msg("3 minutes"),
  "10-minutes": msg("10 minutes"),
  "30-minutes": msg("30 minutes"),
  "1-hour": msg("1 hour"),
};

export const isCodexMicroAgentKey = Schema.is(CodexMicroAgentKey);
export const isCodexMicroAutoDim = Schema.is(CodexMicroAutoDim);
export const isCodexMicroAgentSource = Schema.is(CodexMicroAgentSource);
export const isCodexMicroEncoderMode = Schema.is(CodexMicroEncoderMode);

export const CODEX_MICRO_AGENT_SOURCE_OPTIONS: ReadonlyArray<{
  readonly value: CodexMicroAgentSource;
  readonly label: string;
  readonly description: string;
}> = [
  {
    value: "sidebar",
    label: msg("Sidebar order"),
    description: msg("The threads the jump shortcuts open, in the same order"),
  },
  {
    value: "pinned",
    label: msg("Pinned threads"),
    description: msg("First six threads in Pinned"),
  },
  {
    value: "attention",
    label: msg("Needs attention"),
    description: msg("Waiting, unread, and active threads first"),
  },
  {
    value: "custom",
    label: msg("Custom assignments"),
    description: msg("Choose a thread or shortcut for each key"),
  },
];

export const CODEX_MICRO_ENCODER_MODE_OPTIONS: ReadonlyArray<{
  readonly value: CodexMicroEncoderMode;
  readonly label: string;
  readonly description: string;
}> = [
  {
    value: "conversation-scroll",
    label: msg("Conversation scrolling"),
    description: msg(
      "Turn to scroll the conversation and click to jump to the latest message. Press and hold to open Codex Micro settings.",
    ),
  },
  {
    value: "reasoning",
    label: msg("Reasoning effort"),
    description: msg(
      "Turn to change reasoning effort. Press and hold to open Codex Micro settings.",
    ),
  },
  {
    value: "custom",
    label: msg("Custom", { $context: "knob mode" }),
    description: msg("Choose an action for each turn, click, and long press."),
  },
];

export function codexMicroEncoderModeOption(mode: CodexMicroEncoderMode) {
  return CODEX_MICRO_ENCODER_MODE_OPTIONS.find((option) => option.value === mode)!;
}

export function codexMicroEncoderInputLabel(
  layout: Pick<CodexMicroLayout, "encoder" | "encoderMode">,
  input: CodexMicroEncoderInput,
  resolve: MessageResolver = m,
): string {
  return codexMicroActionLabel(resolveCodexMicroEncoderAction(layout, input), resolve);
}

/**
 * Leaving a built-in mode for Custom starts from what that mode did, so assigning one input
 * keeps the other three working instead of clearing them.
 */
export function codexMicroLayoutWithEncoderMode(
  layout: CodexMicroLayout,
  mode: CodexMicroEncoderMode,
): CodexMicroLayout {
  if (mode !== "custom" || layout.encoderMode === "custom") {
    return { ...layout, encoderMode: mode };
  }
  const unassigned = Object.values(layout.encoder).every((action) => action === null);
  return {
    ...layout,
    encoderMode: "custom",
    encoder: unassigned ? CODEX_MICRO_ENCODER_PRESETS[layout.encoderMode] : layout.encoder,
  };
}

export function codexMicroLayoutWithEncoderAction(
  layout: CodexMicroLayout,
  input: CodexMicroEncoderInput,
  action: CodexMicroAction | null,
): CodexMicroLayout {
  const custom = codexMicroLayoutWithEncoderMode(layout, "custom");
  return { ...custom, encoder: { ...custom.encoder, [input]: action } };
}

/** Restores command keys, analog stick, and knob; how the microphone switches are split stays. */
export function resetCodexMicroLayout(layout: CodexMicroLayout): CodexMicroLayout {
  return {
    ...DEFAULT_CODEX_MICRO_LAYOUT,
    separateMicrophoneKeys: layout.separateMicrophoneKeys,
  };
}

/** The CSS color for a key's light, or null while it is off. */
export function codexMicroStatusColor(status: CodexMicroSlotStatus): string | null {
  return status === "off"
    ? null
    : `#${CODEX_MICRO_STATUS_COLORS[status].toString(16).padStart(6, "0")}`;
}

export const CODEX_MICRO_STATUS_LABELS: Readonly<Record<CodexMicroSlotStatus, string>> = {
  off: msg("Off", { $context: "agent key status" }),
  idle: msg("Idle", { $context: "agent key status" }),
  working: msg("Working", { $context: "agent key status" }),
  unread: msg("Unread", { $context: "agent key status" }),
  "awaiting-approval": msg("Waiting for approval"),
  "awaiting-response": msg("Waiting for your response"),
  error: msg("Error", { $context: "agent key status" }),
};

export function codexMicroAgentKeyNumber(key: CodexMicroAgentKey): number {
  return CODEX_MICRO_AGENT_KEYS.indexOf(key) + 1;
}

export interface CodexMicroAgentKeyView {
  readonly key: CodexMicroAgentKey;
  readonly number: number;
  readonly label: string | null;
  readonly status: CodexMicroSlotStatus;
}

function codexMicroAssignmentLabel(
  assignment: CodexMicroAgentAssignment | null,
  threadTitles: ReadonlyMap<string, string>,
  resolve: MessageResolver,
): string {
  if (assignment === null) return resolve(msg("Unassigned"));
  if (assignment.type === "action") return codexMicroActionLabel(assignment.action, resolve);
  return (
    threadTitles.get(
      scopedThreadKey({ environmentId: assignment.environmentId, threadId: assignment.threadId }),
    ) ?? resolve(msg("Unavailable thread"))
  );
}

/**
 * The live binding wins: it is what the keyboard shows. Without one (the feature is off),
 * a custom assignment still says what the key will follow.
 */
export function codexMicroAgentKeyView(
  key: CodexMicroAgentKey,
  binding: Pick<CodexMicroSlotView, "title" | "status" | "action"> | null,
  assignment: CodexMicroAgentAssignment | null | undefined,
  threadTitles: ReadonlyMap<string, string>,
  resolve: MessageResolver = m,
): CodexMicroAgentKeyView {
  const number = codexMicroAgentKeyNumber(key);
  if (binding !== null) {
    return {
      key,
      number,
      label:
        binding.title ??
        (binding.action
          ? codexMicroActionLabel(binding.action, resolve)
          : resolve(msg("No thread"))),
      status: binding.status,
    };
  }
  return {
    key,
    number,
    label:
      assignment === undefined
        ? null
        : codexMicroAssignmentLabel(assignment, threadTitles, resolve),
    status: "off",
  };
}

/** The illustration has one wide microphone key unless its two switches are mapped separately. */
export function codexMicroPressedKey(
  event: CodexMicroInputEvent,
  layout: Pick<CodexMicroLayout, "separateMicrophoneKeys">,
): CodexMicroKeyId | null {
  switch (event.type) {
    case "agent-key":
      return event.key;
    case "joystick":
      return "stick";
    case "encoder":
      return "knob";
    case "key": {
      if (event.phase !== "press") return null;
      const merged =
        !layout.separateMicrophoneKeys && (event.slot === "ACT10" || event.slot === "ACT11");
      const slot = merged ? "ACT10_ACT11" : event.slot;
      return codexMicroVisibleSlots(layout).includes(slot) ? slot : null;
    }
  }
}

/** The wide microphone key covers two switches, so it is named for both. */
export function codexMicroSlotName(slot: CodexMicroActionSlot): string {
  return slot === "ACT10_ACT11" ? "ACT10+11" : slot;
}

function searchTokens(query: string): ReadonlyArray<string> {
  return query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
}

function matchesTokens(haystack: string, tokens: ReadonlyArray<string>): boolean {
  const normalized = haystack.toLocaleLowerCase();
  return tokens.every((token) => normalized.includes(token));
}

export function filterCodexMicroKeycaps(
  keycaps: ReadonlyArray<CodexMicroKeycap>,
  query: string,
  resolve: MessageResolver = m,
): ReadonlyArray<CodexMicroKeycap> {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return keycaps;
  return keycaps.filter((keycap) =>
    matchesTokens(
      `${keycap.label} ${keycap.id} ${keycap.glyph ?? ""} ${
        keycap.defaultAction ? codexMicroActionLabel(keycap.defaultAction, resolve) : ""
      }`,
      tokens,
    ),
  );
}

export function filterCodexMicroCommandGroups(
  query: string,
  resolve: MessageResolver = m,
): ReadonlyArray<CodexMicroCommandGroup> {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return CODEX_MICRO_COMMAND_GROUPS;
  return CODEX_MICRO_COMMAND_GROUPS.flatMap((group) => {
    const options = group.options.filter((option) =>
      matchesTokens(
        `${resolve(option.label)} ${resolve(group.label)} ${option.action.type === "command" ? option.action.command : ""}`,
        tokens,
      ),
    );
    return options.length > 0 ? [{ ...group, options }] : [];
  });
}

interface CodexMicroThreadCandidate {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
  readonly deletedAt: string | null;
}

export function codexMicroThreadChoices<Thread extends CodexMicroThreadCandidate>(
  threads: ReadonlyArray<Thread>,
  projectTitles: ReadonlyMap<string, string>,
  query: string,
  limit: number,
) {
  const tokens = searchTokens(query);
  const matches = threads
    .flatMap((thread) => {
      if (thread.archivedAt !== null || thread.deletedAt !== null) return [];
      const projectTitle =
        projectTitles.get(
          scopedProjectKey({ environmentId: thread.environmentId, projectId: thread.projectId }),
        ) ?? null;
      if (!matchesTokens(`${thread.title} ${projectTitle ?? ""}`, tokens)) return [];
      return [{ thread, projectTitle }];
    })
    .toSorted((left, right) => right.thread.updatedAt.localeCompare(left.thread.updatedAt));
  return { choices: matches.slice(0, limit), truncated: matches.length > limit };
}

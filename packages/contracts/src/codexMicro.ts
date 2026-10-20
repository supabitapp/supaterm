import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";

import { EnvironmentId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { KeybindingCommand } from "./keybindings.ts";

export const CODEX_MICRO_AGENT_KEYS = ["AG00", "AG01", "AG02", "AG03", "AG04", "AG05"] as const;
export const CodexMicroAgentKey = Schema.Literals(CODEX_MICRO_AGENT_KEYS);
export type CodexMicroAgentKey = typeof CodexMicroAgentKey.Type;

/** ACT10 and ACT11 sit under one wide keycap unless separate microphone keys are enabled. */
export const CODEX_MICRO_ACTION_SLOTS = [
  "ACT06",
  "ACT07",
  "ACT08",
  "ACT09",
  "ACT10",
  "ACT11",
  "ACT10_ACT11",
  "ACT12",
] as const;
export const CodexMicroActionSlot = Schema.Literals(CODEX_MICRO_ACTION_SLOTS);
export type CodexMicroActionSlot = typeof CodexMicroActionSlot.Type;

/** Keycap identifiers printed on the physical keycaps that ship with the keyboard. */
export const CodexMicroKeycapId = Schema.Literals([
  "FAST",
  "APPR",
  "REJ",
  "SPLIT",
  "MIC",
  "MIC1",
  "CODEX",
  "BUG",
  "OAI",
  "TERM",
  "DWN",
  "DEL",
  "NEW",
  "NAV",
  "MAGIC",
  "DIFF",
  "PLAY",
  "GIT",
  "BRCH",
  "BRANCH",
  "MRG",
  "PR",
  "PAINT",
  "LAB",
  "PARTY",
  "TIME",
  "MIND+",
  "MIND-",
  "EMPT1",
  "EMPT2",
  "EMPT3",
  "EMPT4",
  "SETUP",
  "FOLD",
  "UPL",
  "APPS",
  "YOLO",
  "YEET",
  "EMPT5",
]);
export type CodexMicroKeycapId = typeof CodexMicroKeycapId.Type;

export const CodexMicroAction = Schema.Union([
  Schema.Struct({ type: Schema.Literal("command"), command: KeybindingCommand }),
  Schema.Struct({
    type: Schema.Literal("composer-text"),
    text: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
  }),
  Schema.Struct({ type: Schema.Literal("open-settings") }),
  Schema.Struct({ type: Schema.Literal("open-codex-micro-settings") }),
]);
export type CodexMicroAction = typeof CodexMicroAction.Type;

const LegacyVoiceAction = Schema.Struct({ type: Schema.Literal("push-to-talk") });
const discardVoiceAction = <S extends Schema.Top>(schema: S) =>
  schema.pipe(
    Schema.decodeTo(Schema.Null, {
      decode: SchemaGetter.transform(() => null),
      encode: SchemaGetter.forbidden(() => "Removed voice actions cannot be encoded."),
    }),
  );
const SavedAction = Schema.NullOr(
  Schema.Union([CodexMicroAction, LegacyVoiceAction.pipe(discardVoiceAction)]),
);

/** An absent action means the keycap's own default action. */
export const CodexMicroKeySlot = Schema.Struct({
  keycapId: CodexMicroKeycapId,
  action: Schema.optionalKey(SavedAction),
});
export type CodexMicroKeySlot = typeof CodexMicroKeySlot.Type;

export const CodexMicroJoystickDirection = Schema.Literals(["up", "right", "down", "left"]);
export type CodexMicroJoystickDirection = typeof CodexMicroJoystickDirection.Type;

export const CodexMicroEncoderInput = Schema.Literals(["left", "right", "click", "longPress"]);
export type CodexMicroEncoderInput = typeof CodexMicroEncoderInput.Type;

export const CodexMicroEncoderMode = Schema.Literals([
  "conversation-scroll",
  "reasoning",
  "custom",
]);
export type CodexMicroEncoderMode = typeof CodexMicroEncoderMode.Type;

const DEFAULT_CODEX_MICRO_ANALOG_STICK = {
  up: { type: "command", command: "rightPanel.toggle" },
  right: { type: "command", command: "navigation.forward" },
  down: { type: "command", command: "sidebar.toggle" },
  left: { type: "command", command: "navigation.back" },
} as const satisfies Record<CodexMicroJoystickDirection, CodexMicroAction | null>;

const DEFAULT_CODEX_MICRO_ENCODER = {
  left: null,
  right: null,
  click: null,
  longPress: null,
} as const satisfies Record<CodexMicroEncoderInput, CodexMicroAction | null>;

export const DEFAULT_CODEX_MICRO_SLOTS = {
  ACT06: { keycapId: "FAST" },
  ACT07: { keycapId: "APPR" },
  ACT08: { keycapId: "REJ" },
  ACT09: { keycapId: "SPLIT" },
  ACT10: { keycapId: "MIC1" },
  ACT11: { keycapId: "EMPT1" },
  ACT10_ACT11: { keycapId: "MIC" },
  ACT12: { keycapId: "CODEX" },
} as const satisfies Record<CodexMicroActionSlot, CodexMicroKeySlot>;

const slotWithDefault = (slot: CodexMicroActionSlot) =>
  CodexMicroKeySlot.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_CODEX_MICRO_SLOTS[slot])),
  );

export const CodexMicroLayout = Schema.Struct({
  version: Schema.Literal(1).pipe(Schema.withDecodingDefault(Effect.succeed(1 as const))),
  slots: Schema.Struct({
    ACT06: slotWithDefault("ACT06"),
    ACT07: slotWithDefault("ACT07"),
    ACT08: slotWithDefault("ACT08"),
    ACT09: slotWithDefault("ACT09"),
    ACT10: slotWithDefault("ACT10"),
    ACT11: slotWithDefault("ACT11"),
    ACT10_ACT11: slotWithDefault("ACT10_ACT11"),
    ACT12: slotWithDefault("ACT12"),
  }).pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  analogStick: Schema.Struct({
    up: SavedAction,
    right: SavedAction,
    down: SavedAction,
    left: SavedAction,
  }).pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_CODEX_MICRO_ANALOG_STICK))),
  encoder: Schema.Struct({
    left: SavedAction,
    right: SavedAction,
    click: SavedAction,
    longPress: SavedAction,
  }).pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_CODEX_MICRO_ENCODER))),
  encoderMode: CodexMicroEncoderMode.pipe(
    Schema.withDecodingDefault(Effect.succeed("conversation-scroll" as const)),
  ),
  separateMicrophoneKeys: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type CodexMicroLayout = typeof CodexMicroLayout.Type;

export const DEFAULT_CODEX_MICRO_LAYOUT = Schema.decodeSync(CodexMicroLayout)({});

export const CodexMicroAgentSource = Schema.Literals(["recent", "pinned", "attention", "custom"]);
export type CodexMicroAgentSource = typeof CodexMicroAgentSource.Type;

export const CodexMicroAgentAssignment = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("thread"),
    environmentId: EnvironmentId,
    threadId: ThreadId,
  }),
  Schema.Struct({ type: Schema.Literal("action"), action: CodexMicroAction }),
]);
export type CodexMicroAgentAssignment = typeof CodexMicroAgentAssignment.Type;

const assignmentWithDefault = Schema.NullOr(
  Schema.Union([
    CodexMicroAgentAssignment,
    Schema.Struct({ type: Schema.Literal("action"), action: LegacyVoiceAction }).pipe(
      discardVoiceAction,
    ),
  ]),
).pipe(Schema.withDecodingDefault(Effect.succeed(null)));

export const CodexMicroCustomAgentKeys = Schema.Struct({
  AG00: assignmentWithDefault,
  AG01: assignmentWithDefault,
  AG02: assignmentWithDefault,
  AG03: assignmentWithDefault,
  AG04: assignmentWithDefault,
  AG05: assignmentWithDefault,
});
export type CodexMicroCustomAgentKeys = typeof CodexMicroCustomAgentKeys.Type;

export const DEFAULT_CODEX_MICRO_CUSTOM_AGENT_KEYS = Schema.decodeSync(CodexMicroCustomAgentKeys)(
  {},
);

export const CodexMicroBrightness = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: 100 }),
);

export const CODEX_MICRO_AUTO_DIM_MS = {
  off: null,
  "30-seconds": 30_000,
  "1-minute": 60_000,
  "3-minutes": 180_000,
  "10-minutes": 600_000,
  "30-minutes": 1_800_000,
  "1-hour": 3_600_000,
} as const;
export const CodexMicroAutoDim = Schema.Literals(
  Object.keys(CODEX_MICRO_AUTO_DIM_MS) as Array<keyof typeof CODEX_MICRO_AUTO_DIM_MS>,
);
export type CodexMicroAutoDim = typeof CodexMicroAutoDim.Type;

export const CodexMicroSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  agentSource: CodexMicroAgentSource.pipe(
    Schema.withDecodingDefault(Effect.succeed("recent" as const)),
  ),
  singleTapFocus: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  brightness: CodexMicroBrightness.pipe(Schema.withDecodingDefault(Effect.succeed(100))),
  autoDim: CodexMicroAutoDim.pipe(Schema.withDecodingDefault(Effect.succeed("3-minutes" as const))),
  layout: CodexMicroLayout.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  customAgentKeys: CodexMicroCustomAgentKeys.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
export type CodexMicroSettings = typeof CodexMicroSettings.Type;

export const CodexMicroSlotStatus = Schema.Literals([
  "off",
  "idle",
  "working",
  "unread",
  "awaiting-approval",
  "awaiting-response",
  "error",
]);
export type CodexMicroSlotStatus = typeof CodexMicroSlotStatus.Type;

/** The RGB value each agent-key status lights on the keyboard. */
export const CODEX_MICRO_STATUS_COLORS = {
  idle: 0xffffff,
  working: 0x304ffe,
  unread: 0x00ff4c,
  "awaiting-approval": 0xff6d00,
  "awaiting-response": 0xff6d00,
  error: 0xff0033,
} as const satisfies Record<Exclude<CodexMicroSlotStatus, "off">, number>;

export const CodexMicroThreadRef = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
});
export type CodexMicroThreadRef = typeof CodexMicroThreadRef.Type;

const CodexMicroLightingSlot = Schema.Struct({
  thread: Schema.NullOr(CodexMicroThreadRef),
  status: CodexMicroSlotStatus,
  selected: Schema.Boolean,
});

export const CODEX_MICRO_SLOT_COUNT = CODEX_MICRO_AGENT_KEYS.length;

export const CodexMicroLightingModel = Schema.Struct({
  slots: Schema.Array(CodexMicroLightingSlot).check(
    Schema.isMinLength(CODEX_MICRO_SLOT_COUNT),
    Schema.isMaxLength(CODEX_MICRO_SLOT_COUNT),
  ),
});
export type CodexMicroLightingModel = typeof CodexMicroLightingModel.Type;

export const CodexMicroConnectionStatus = Schema.Literals([
  "disabled",
  "not-detected",
  "detected",
  "connected",
  "error",
]);
export type CodexMicroConnectionStatus = typeof CodexMicroConnectionStatus.Type;

const CodexMicroConnectionError = Schema.Literals([
  "discovery-failed",
  "connection-failed",
  "transport-unavailable",
]);

export const CodexMicroPermissionStatus = Schema.Literals(["granted", "denied", "unavailable"]);
export type CodexMicroPermissionStatus = typeof CodexMicroPermissionStatus.Type;

export const CodexMicroDeviceState = Schema.Struct({
  status: CodexMicroConnectionStatus,
  /** A connected device can still refuse lighting and status requests. */
  controlPlane: Schema.Literals(["available", "unavailable"]),
  error: Schema.NullOr(CodexMicroConnectionError),
  battery: Schema.NullOr(
    Schema.Struct({ percentage: Schema.Number, isCharging: Schema.NullOr(Schema.Boolean) }),
  ),
  firmwareVersion: Schema.NullOr(Schema.String),
  inputMonitoring: CodexMicroPermissionStatus,
});
export type CodexMicroDeviceState = typeof CodexMicroDeviceState.Type;

export const CodexMicroInputEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("agent-key"),
    key: CodexMicroAgentKey,
    /** The thread the keyboard was lighting for this key when it was pressed. */
    thread: Schema.NullOr(CodexMicroThreadRef),
    /** True when this press completed the gesture that brings Supaterm to the front. */
    focus: Schema.Boolean,
  }),
  Schema.Struct({
    type: Schema.Literal("key"),
    slot: CodexMicroActionSlot,
    phase: Schema.Literals(["press", "release"]),
  }),
  Schema.Struct({ type: Schema.Literal("joystick"), direction: CodexMicroJoystickDirection }),
  Schema.Struct({ type: Schema.Literal("encoder"), input: CodexMicroEncoderInput }),
]);
export type CodexMicroInputEvent = typeof CodexMicroInputEvent.Type;

export interface DesktopCodexMicroBridge {
  getState: () => Promise<CodexMicroDeviceState>;
  onStateChange: (listener: (state: CodexMicroDeviceState) => void) => () => void;
  onInput: (listener: (event: CodexMicroInputEvent) => void) => () => void;
  setLighting: (model: CodexMicroLightingModel) => Promise<void>;
}

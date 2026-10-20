import {
  CODEX_MICRO_AGENT_KEYS,
  CODEX_MICRO_SLOT_COUNT,
  CODEX_MICRO_STATUS_COLORS,
  CodexMicroActionSlot,
  CodexMicroAgentKey,
  type CodexMicroJoystickDirection,
  type CodexMicroLightingModel,
} from "@supaterm/contracts";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

export const CODEX_MICRO_VENDOR_ID = 0x303a;
export const CODEX_MICRO_PRODUCT_ID = 0x8360;
export const CODEX_MICRO_USAGE_PAGE = 0xff00;

const REPORT_SIZE = 64;
const REPORT_ID = 0x06;
const REPORT_HEADER_SIZE = 3;
const MAX_FRAGMENT_BYTES = REPORT_SIZE - REPORT_HEADER_SIZE;
const DEBUG_CHANNEL = 1;
const RPC_CHANNEL = 2;
const REQUEST_ID_RANGE = 999;
// A corrupt fragment would otherwise keep every later line buffered behind it.
const MAX_BUFFERED_CHARS = 64 * 1024;

const textEncoder = new TextEncoder();

export function escapeNonAscii(json: string): string {
  return json.replace(
    /[\u0080-\uffff]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export function nextRequestId(previous: number): number {
  return (previous + 1) % REQUEST_ID_RANGE;
}

export function encodeRequest(request: {
  readonly method: string;
  readonly params?: unknown;
  readonly id: number;
}): string {
  return escapeNonAscii(
    JSON.stringify({ method: request.method, params: request.params ?? null, id: request.id }),
  );
}

// Host-to-device requests carry no trailing newline; only device output is newline-framed.
export function frameMessage(message: string): ReadonlyArray<Uint8Array> {
  const bytes = textEncoder.encode(message);
  const reports: Array<Uint8Array> = [];
  for (let offset = 0; offset < bytes.length; offset += MAX_FRAGMENT_BYTES) {
    const fragment = bytes.subarray(offset, offset + MAX_FRAGMENT_BYTES);
    const report = new Uint8Array(REPORT_SIZE);
    report[0] = REPORT_ID;
    report[1] = RPC_CHANNEL;
    report[2] = fragment.length;
    report.set(fragment, REPORT_HEADER_SIZE);
    reports.push(report);
  }
  return reports;
}

export type CodexMicroIncomingMessage =
  | {
      readonly type: "response";
      readonly id: string;
      readonly body: { readonly [key: string]: unknown };
    }
  | { readonly type: "notification"; readonly method: string; readonly params: unknown };

export type CodexMicroReportEvent =
  | { readonly type: "message"; readonly message: CodexMicroIncomingMessage }
  | { readonly type: "debug"; readonly line: string };

function classifyMessage(value: unknown): CodexMicroIncomingMessage | undefined {
  if (!Predicate.isObject(value)) return undefined;
  const id = value.id ?? value.i;
  if (Predicate.isNumber(id) || Predicate.isString(id)) {
    return { type: "response", id: String(id), body: value };
  }
  const method = value.method ?? value.m;
  if (!Predicate.isString(method)) return undefined;
  return { type: "notification", method, params: "params" in value ? value.params : value.p };
}

/** Reassembles device reports into debug lines and JSON-RPC messages. */
export class CodexMicroReportDecoder {
  private readonly channels = new Map<number, { decoder: TextDecoder; text: string }>();
  private pendingJson: string | null = null;

  push(report: Uint8Array): ReadonlyArray<CodexMicroReportEvent> {
    if (report.length < REPORT_HEADER_SIZE) return [];
    const channel = report[1]!;
    if (channel !== DEBUG_CHANNEL && channel !== RPC_CHANNEL) return [];
    const length = Math.min(report[2]!, report.length - REPORT_HEADER_SIZE);
    let buffer = this.channels.get(channel);
    if (buffer === undefined) {
      buffer = { decoder: new TextDecoder(), text: "" };
      this.channels.set(channel, buffer);
    }
    buffer.text += buffer.decoder.decode(
      report.subarray(REPORT_HEADER_SIZE, REPORT_HEADER_SIZE + length),
      { stream: true },
    );

    const events: Array<CodexMicroReportEvent> = [];
    let newline = buffer.text.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.text.slice(0, newline).replace(/\r$/, "");
      buffer.text = buffer.text.slice(newline + 1);
      if (line.length > 0) {
        if (channel === DEBUG_CHANNEL) {
          events.push({ type: "debug", line });
        } else {
          const message = this.assembleJson(line);
          if (message !== undefined) events.push({ type: "message", message });
        }
      }
      newline = buffer.text.indexOf("\n");
    }
    if (buffer.text.length > MAX_BUFFERED_CHARS) buffer.text = "";
    return events;
  }

  private assembleJson(line: string): CodexMicroIncomingMessage | undefined {
    let candidate: string;
    if (this.pendingJson === null) {
      const start = line.indexOf("{");
      if (start < 0) return undefined;
      candidate = line.slice(start);
    } else {
      candidate = `${this.pendingJson}\n${line}`;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      this.pendingJson = candidate.length > MAX_BUFFERED_CHARS ? null : candidate;
      return undefined;
    }
    this.pendingJson = null;
    return classifyMessage(parsed);
  }
}

export type CodexMicroResponse =
  | { readonly type: "result"; readonly result: unknown }
  | { readonly type: "error"; readonly code: number };

export function parseResponseBody(body: {
  readonly [key: string]: unknown;
}): CodexMicroResponse | undefined {
  const hasResult = Object.hasOwn(body, "result");
  if (hasResult === Object.hasOwn(body, "error")) return undefined;
  if (hasResult) return { type: "result", result: body.result };
  const error = body.error;
  if (
    !Predicate.isObject(error) ||
    !Predicate.isNumber(error.code) ||
    !Predicate.isString(error.message)
  ) {
    return undefined;
  }
  return { type: "error", code: error.code };
}

const DeviceStatusResult = Schema.Struct({
  version: Schema.optionalKey(Schema.String),
  battery: Schema.optionalKey(Schema.Number),
  is_charging: Schema.optionalKey(Schema.Boolean),
  profile_index: Schema.optionalKey(Schema.Number),
  layer_index: Schema.optionalKey(Schema.Number),
});
export const decodeDeviceStatus = Schema.decodeUnknownOption(DeviceStatusResult);

const KeyNotification = Schema.Struct({ k: Schema.String, act: Schema.Number });
export const decodeKeyNotification = Schema.decodeUnknownOption(KeyNotification);

const JoystickNotification = Schema.Struct({ a: Schema.Number, d: Schema.Number });
export const decodeJoystickNotification = Schema.decodeUnknownOption(JoystickNotification);

export const KEY_NOTIFICATION_METHOD = "v.oai.hid";
export const JOYSTICK_NOTIFICATION_METHOD = "v.oai.rad";
export const RGB_CONFIG_METHOD = "v.oai.rgbcfg";
export const THREAD_STATUS_METHOD = "v.oai.thstatus";
export const DEVICE_STATUS_METHOD = "device.status";

export const KEY_ACT_RELEASE = 0;
export const KEY_ACT_PRESS = 1;
export const KEY_ACT_ROTATE = 2;

export const isAgentKey = Schema.is(CodexMicroAgentKey);
const isActionSlot = Schema.is(CodexMicroActionSlot);

export function agentKeySlotIndex(key: CodexMicroAgentKey): number {
  return CODEX_MICRO_AGENT_KEYS.indexOf(key);
}

export function actionSlotFromWire(
  key: string,
  separateMicrophoneKeys: boolean,
): CodexMicroActionSlot | undefined {
  if (!isActionSlot(key) || key === "ACT10_ACT11") return undefined;
  if (separateMicrophoneKeys) return key;
  if (key === "ACT11") return undefined;
  return key === "ACT10" ? "ACT10_ACT11" : key;
}

const JOYSTICK_DIRECTION_DISTANCE = 0.5;
const JOYSTICK_REARM_DISTANCE = 0.25;

export function joystickSector(angle: number): CodexMicroJoystickDirection {
  if (angle >= 0.625 && angle < 0.875) return "up";
  if (angle >= 0.125 && angle < 0.375) return "down";
  if (angle >= 0.375 && angle < 0.625) return "left";
  return "right";
}

/** The stick reports raw positions; only a newly reached direction becomes an input event. */
export function trackJoystick(
  last: CodexMicroJoystickDirection | null,
  sample: { readonly angle: number; readonly distance: number },
): {
  readonly last: CodexMicroJoystickDirection | null;
  readonly emit: CodexMicroJoystickDirection | null;
} {
  if (sample.distance < JOYSTICK_REARM_DISTANCE) return { last: null, emit: null };
  if (sample.distance < JOYSTICK_DIRECTION_DISTANCE) return { last, emit: null };
  const direction = joystickSector(sample.angle);
  return direction === last ? { last, emit: null } : { last: direction, emit: direction };
}

const EFFECT_OFF = 0;
const EFFECT_SOLID = 1;
const EFFECT_SNAKE = 2;
const EFFECT_BREATH = 4;
const ANIMATION_SPEED = 0.4;
const WHITE = 0xffffff;
const VOICE_RECORDING_COLOR = 0x2e8b57;

export interface CodexMicroZoneLighting {
  readonly e: number;
  readonly b: number;
  readonly s: number;
  readonly m: 0;
  readonly c: number;
}

export interface CodexMicroSlotLighting {
  readonly id: number;
  readonly c: number;
  readonly b: number;
  readonly e: number;
  readonly s: number;
  readonly sk: 0;
  readonly sa: 0;
}

export interface CodexMicroLightingPayload {
  readonly rgbcfg: {
    readonly ambient: CodexMicroZoneLighting;
    readonly keys: CodexMicroZoneLighting;
  };
  readonly thstatus: ReadonlyArray<CodexMicroSlotLighting>;
}

const ZONE_OFF: CodexMicroZoneLighting = { e: EFFECT_OFF, b: 0, s: 0, m: 0, c: 0 };

const zone = (
  effect: number,
  color: number,
  brightness: number,
  speed = 0,
): CodexMicroZoneLighting => ({ e: effect, b: brightness, s: speed, m: 0, c: color });

export function selectedLightingSlot(model: CodexMicroLightingModel) {
  const index = model.slots.findIndex((slot) => slot.selected && slot.status !== "off");
  return index < 0 ? undefined : { index, slot: model.slots[index]! };
}

export function serializeLighting(
  model: CodexMicroLightingModel,
  options: { readonly brightness: number; readonly highlight: boolean; readonly dimmed: boolean },
): CodexMicroLightingPayload {
  const brightness = Math.min(1, Math.max(0, options.brightness));
  const thstatus = model.slots.map((slot, id): CodexMicroSlotLighting => {
    if (options.dimmed || slot.status === "off") {
      return { id, c: 0, b: 0, e: EFFECT_OFF, s: 0, sk: 0, sa: 0 };
    }
    return {
      id,
      c: CODEX_MICRO_STATUS_COLORS[slot.status],
      b: brightness,
      e: slot.selected ? EFFECT_BREATH : EFFECT_SOLID,
      s: slot.selected ? ANIMATION_SPEED : 0,
      sk: 0,
      sa: 0,
    };
  });
  if (options.dimmed) return { rgbcfg: { ambient: ZONE_OFF, keys: ZONE_OFF }, thstatus };

  const selected = selectedLightingSlot(model);
  const selectedStatus = selected?.slot.status;
  const highlightColor =
    options.highlight && selectedStatus !== undefined && selectedStatus !== "off"
      ? CODEX_MICRO_STATUS_COLORS[selectedStatus]
      : undefined;
  const keys =
    highlightColor === undefined ? ZONE_OFF : zone(EFFECT_SOLID, highlightColor, brightness);

  let ambient: CodexMicroZoneLighting;
  if (model.voice === "recording") {
    ambient = zone(EFFECT_SNAKE, VOICE_RECORDING_COLOR, brightness, ANIMATION_SPEED);
  } else if (model.voice === "processing") {
    ambient = zone(EFFECT_SNAKE, WHITE, brightness, ANIMATION_SPEED);
  } else if (model.voice === "completed") {
    ambient = zone(EFFECT_SOLID, WHITE, brightness);
  } else if (selectedStatus === "working") {
    ambient = zone(EFFECT_SNAKE, CODEX_MICRO_STATUS_COLORS.working, brightness, ANIMATION_SPEED);
  } else if (highlightColor !== undefined) {
    ambient = zone(EFFECT_SOLID, highlightColor, brightness);
  } else {
    ambient = ZONE_OFF;
  }
  return { rgbcfg: { ambient, keys }, thstatus };
}

export const EMPTY_LIGHTING_MODEL: CodexMicroLightingModel = {
  slots: Array.from({ length: CODEX_MICRO_SLOT_COUNT }, () => ({
    thread: null,
    status: "off",
    selected: false,
  })),
  voice: "idle",
};

export const LIGHTS_OFF_PAYLOAD = serializeLighting(EMPTY_LIGHTING_MODEL, {
  brightness: 0,
  highlight: false,
  dimmed: true,
});

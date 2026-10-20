import type { CodexMicroLightingModel } from "@supaterm/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Option from "effect/Option";

import {
  CodexMicroReportDecoder,
  EMPTY_LIGHTING_MODEL,
  LIGHTS_OFF_PAYLOAD,
  actionSlotFromWire,
  decodeDeviceStatus,
  encodeRequest,
  escapeNonAscii,
  frameMessage,
  joystickSector,
  nextRequestId,
  parseResponseBody,
  serializeLighting,
  trackJoystick,
} from "./protocol.ts";

const textDecoder = new TextDecoder();

function deviceReport(channel: number, text: string): Uint8Array {
  const bytes = new TextEncoder().encode(text);
  const report = new Uint8Array(64);
  report[0] = 0x06;
  report[1] = channel;
  report[2] = bytes.length;
  report.set(bytes, 3);
  return report;
}

function deviceReports(channel: number, text: string, fragmentSize: number) {
  const reports: Array<Uint8Array> = [];
  for (let offset = 0; offset < text.length; offset += fragmentSize) {
    reports.push(deviceReport(channel, text.slice(offset, offset + fragmentSize)));
  }
  return reports;
}

const pushAll = (decoder: CodexMicroReportDecoder, reports: ReadonlyArray<Uint8Array>) =>
  reports.flatMap((report) => [...decoder.push(report)]);

const model = (
  slots: Partial<Record<number, Partial<CodexMicroLightingModel["slots"][number]>>>,
  voice: CodexMicroLightingModel["voice"] = "idle",
): CodexMicroLightingModel => ({
  slots: EMPTY_LIGHTING_MODEL.slots.map((slot, index) => ({ ...slot, ...slots[index] })),
  voice,
});

describe("request encoding", () => {
  it("omits jsonrpc, defaults params to null and escapes non-ASCII", () => {
    assert.strictEqual(
      encodeRequest({ method: "device.status", id: 1 }),
      '{"method":"device.status","params":null,"id":1}',
    );
    assert.strictEqual(escapeNonAscii('"é😀"'), '"\\u00e9\\ud83d\\ude00"');
    assert.strictEqual(
      encodeRequest({ method: "x", params: { label: "日本" }, id: 2 }),
      '{"method":"x","params":{"label":"\\u65e5\\u672c"},"id":2}',
    );
  });

  it("cycles request ids through 0..998", () => {
    assert.strictEqual(nextRequestId(-1), 0);
    assert.strictEqual(nextRequestId(997), 998);
    assert.strictEqual(nextRequestId(998), 0);
  });

  it("frames messages into zero-padded 64-byte RPC reports of at most 61 bytes", () => {
    const message = "a".repeat(61) + "b".repeat(10);
    const reports = frameMessage(message);
    assert.strictEqual(reports.length, 2);
    for (const report of reports) {
      assert.strictEqual(report.length, 64);
      assert.strictEqual(report[0], 0x06);
      assert.strictEqual(report[1], 0x02);
    }
    assert.strictEqual(reports[0]![2], 61);
    assert.strictEqual(textDecoder.decode(reports[0]!.subarray(3, 64)), "a".repeat(61));
    assert.strictEqual(reports[1]![2], 10);
    assert.strictEqual(textDecoder.decode(reports[1]!.subarray(3, 13)), "b".repeat(10));
    assert.isTrue(reports[1]!.subarray(13).every((byte) => byte === 0));
  });
});

describe("CodexMicroReportDecoder", () => {
  it("reassembles a message split across reports and lines", () => {
    const decoder = new CodexMicroReportDecoder();
    const events = pushAll(decoder, deviceReports(2, '{"id":4,"result":{"ok":true}}\r\n', 7));
    assert.deepStrictEqual(events, [
      {
        type: "message",
        message: { type: "response", id: "4", body: { id: 4, result: { ok: true } } },
      },
    ]);
  });

  it("accepts compact keys and treats id-less methods as notifications", () => {
    const decoder = new CodexMicroReportDecoder();
    const events = pushAll(decoder, [
      deviceReport(2, '{"m":"v.oai.hid","p":{"k":"AG00","act":1}}\n'),
      deviceReport(2, '{"i":"7","result":null}\n'),
    ]);
    assert.deepStrictEqual(events, [
      {
        type: "message",
        message: { type: "notification", method: "v.oai.hid", params: { k: "AG00", act: 1 } },
      },
      {
        type: "message",
        message: { type: "response", id: "7", body: { i: "7", result: null } },
      },
    ]);
  });

  it("starts at the first brace and accumulates JSON that spans lines", () => {
    const decoder = new CodexMicroReportDecoder();
    const events = pushAll(decoder, [
      deviceReport(2, 'noise {"m":"v.oai.rad",\n'),
      deviceReport(2, '"p":{"a":0.7,"d":1}}\n'),
    ]);
    assert.deepStrictEqual(events, [
      {
        type: "message",
        message: { type: "notification", method: "v.oai.rad", params: { a: 0.7, d: 1 } },
      },
    ]);
  });

  it("keeps debug lines out of the RPC stream", () => {
    const decoder = new CodexMicroReportDecoder();
    const events = pushAll(decoder, [
      deviceReport(1, '{"id":1,"result":1}\nboot'),
      deviceReport(1, "ed\n"),
      deviceReport(9, '{"id":2,"result":1}\n'),
    ]);
    assert.deepStrictEqual(events, [
      { type: "debug", line: '{"id":1,"result":1}' },
      { type: "debug", line: "booted" },
    ]);
  });

  it("decodes UTF-8 sequences split between reports", () => {
    const decoder = new CodexMicroReportDecoder();
    const bytes = new TextEncoder().encode("é\n");
    const first = new Uint8Array(64);
    first.set([0x06, 1, 1, bytes[0]!]);
    const second = new Uint8Array(64);
    second.set([0x06, 1, 2, bytes[1]!, bytes[2]!]);
    assert.deepStrictEqual(pushAll(decoder, [first, second]), [{ type: "debug", line: "é" }]);
  });
});

describe("parseResponseBody", () => {
  it("requires exactly one of result or error", () => {
    assert.deepStrictEqual(parseResponseBody({ id: 1, result: null }), {
      type: "result",
      result: null,
    });
    assert.isUndefined(parseResponseBody({ id: 1 }));
    assert.isUndefined(parseResponseBody({ id: 1, result: 1, error: { code: 1, message: "x" } }));
  });

  it("requires a numeric code and string message on errors", () => {
    assert.deepStrictEqual(parseResponseBody({ error: { code: -32601, message: "nope" } }), {
      type: "error",
      code: -32601,
    });
    assert.isUndefined(parseResponseBody({ error: { code: "1", message: "nope" } }));
    assert.isUndefined(parseResponseBody({ error: { code: 1 } }));
    assert.isUndefined(parseResponseBody({ error: "nope" }));
  });
});

describe("decodeDeviceStatus", () => {
  it("accepts optional fields and rejects wrong types", () => {
    assert.deepStrictEqual(
      decodeDeviceStatus({ version: "1.0.4", battery: 80, is_charging: false, extra: 1 }),
      Option.some({ version: "1.0.4", battery: 80, is_charging: false }),
    );
    assert.deepStrictEqual(decodeDeviceStatus({}), Option.some({}));
    assert.isTrue(Option.isNone(decodeDeviceStatus({ battery: "80" })));
    assert.isTrue(Option.isNone(decodeDeviceStatus(null)));
    assert.isTrue(Option.isNone(decodeDeviceStatus([80])));
  });
});

describe("actionSlotFromWire", () => {
  it("merges the microphone keys unless they are separate", () => {
    assert.strictEqual(actionSlotFromWire("ACT10", false), "ACT10_ACT11");
    assert.isUndefined(actionSlotFromWire("ACT11", false));
    assert.strictEqual(actionSlotFromWire("ACT10", true), "ACT10");
    assert.strictEqual(actionSlotFromWire("ACT11", true), "ACT11");
    assert.strictEqual(actionSlotFromWire("ACT06", false), "ACT06");
    assert.isUndefined(actionSlotFromWire("ACT10_ACT11", true));
    assert.isUndefined(actionSlotFromWire("ACT13", false));
  });
});

describe("joystick", () => {
  it("maps angles to sectors", () => {
    assert.strictEqual(joystickSector(0.625), "up");
    assert.strictEqual(joystickSector(0.874), "up");
    assert.strictEqual(joystickSector(0.125), "down");
    assert.strictEqual(joystickSector(0.375), "left");
    assert.strictEqual(joystickSector(0.875), "right");
    assert.strictEqual(joystickSector(0), "right");
    assert.strictEqual(joystickSector(0.124), "right");
  });

  it("emits a direction only when it changes and re-arms near the center", () => {
    let state = trackJoystick(null, { angle: 0.7, distance: 0.49 });
    assert.deepStrictEqual(state, { last: null, emit: null });
    state = trackJoystick(state.last, { angle: 0.7, distance: 0.5 });
    assert.deepStrictEqual(state, { last: "up", emit: "up" });
    state = trackJoystick(state.last, { angle: 0.75, distance: 1 });
    assert.deepStrictEqual(state, { last: "up", emit: null });
    state = trackJoystick(state.last, { angle: 0.7, distance: 0.3 });
    assert.deepStrictEqual(state, { last: "up", emit: null });
    state = trackJoystick(state.last, { angle: 0.7, distance: 0.6 });
    assert.deepStrictEqual(state, { last: "up", emit: null });
    state = trackJoystick(state.last, { angle: 0.7, distance: 0.24 });
    assert.deepStrictEqual(state, { last: null, emit: null });
    state = trackJoystick(state.last, { angle: 0.7, distance: 0.9 });
    assert.deepStrictEqual(state, { last: "up", emit: "up" });
    state = trackJoystick(state.last, { angle: 0.2, distance: 0.9 });
    assert.deepStrictEqual(state, { last: "down", emit: "down" });
  });
});

describe("serializeLighting", () => {
  const options = { brightness: 0.5, highlight: false, dimmed: false };

  it("breathes the selected slot, keeps others solid and turns off empty slots", () => {
    const payload = serializeLighting(
      model({
        0: { status: "working", selected: true },
        1: { status: "unread" },
        2: { status: "awaiting-approval" },
        3: { status: "error" },
        4: { status: "idle" },
      }),
      options,
    );
    assert.deepStrictEqual(payload.thstatus, [
      { id: 0, c: 0x304ffe, b: 0.5, e: 4, s: 0.4, sk: 0, sa: 0 },
      { id: 1, c: 0x00ff4c, b: 0.5, e: 1, s: 0, sk: 0, sa: 0 },
      { id: 2, c: 0xff6d00, b: 0.5, e: 1, s: 0, sk: 0, sa: 0 },
      { id: 3, c: 0xff0033, b: 0.5, e: 1, s: 0, sk: 0, sa: 0 },
      { id: 4, c: 0xffffff, b: 0.5, e: 1, s: 0, sk: 0, sa: 0 },
      { id: 5, c: 0, b: 0, e: 0, s: 0, sk: 0, sa: 0 },
    ]);
    assert.deepStrictEqual(payload.rgbcfg, {
      ambient: { e: 2, b: 0.5, s: 0.4, m: 0, c: 0x304ffe },
      keys: { e: 0, b: 0, s: 0, m: 0, c: 0 },
    });
  });

  it("shows a solid ring and keys only during the selection highlight", () => {
    const selected = model({ 1: { status: "unread", selected: true } });
    assert.deepStrictEqual(serializeLighting(selected, options).rgbcfg, {
      ambient: { e: 0, b: 0, s: 0, m: 0, c: 0 },
      keys: { e: 0, b: 0, s: 0, m: 0, c: 0 },
    });
    assert.deepStrictEqual(serializeLighting(selected, { ...options, highlight: true }).rgbcfg, {
      ambient: { e: 1, b: 0.5, s: 0, m: 0, c: 0x00ff4c },
      keys: { e: 1, b: 0.5, s: 0, m: 0, c: 0x00ff4c },
    });
  });

  it("lets voice state override the ring", () => {
    const working = { 0: { status: "working" as const, selected: true } };
    assert.deepStrictEqual(serializeLighting(model(working, "recording"), options).rgbcfg.ambient, {
      e: 2,
      b: 0.5,
      s: 0.4,
      m: 0,
      c: 0x2e8b57,
    });
    assert.deepStrictEqual(
      serializeLighting(model(working, "processing"), options).rgbcfg.ambient,
      { e: 2, b: 0.5, s: 0.4, m: 0, c: 0xffffff },
    );
    assert.deepStrictEqual(serializeLighting(model(working, "completed"), options).rgbcfg.ambient, {
      e: 1,
      b: 0.5,
      s: 0,
      m: 0,
      c: 0xffffff,
    });
  });

  it("ignores a selected slot that is off", () => {
    const payload = serializeLighting(model({ 2: { status: "off", selected: true } }), {
      ...options,
      highlight: true,
    });
    assert.deepStrictEqual(payload.rgbcfg, LIGHTS_OFF_PAYLOAD.rgbcfg);
  });

  it("turns every zone off while dimmed", () => {
    const payload = serializeLighting(
      model({ 0: { status: "working", selected: true } }, "recording"),
      {
        ...options,
        highlight: true,
        dimmed: true,
      },
    );
    assert.deepStrictEqual(payload, LIGHTS_OFF_PAYLOAD);
    assert.isTrue(LIGHTS_OFF_PAYLOAD.thstatus.every((slot) => slot.e === 0 && slot.b === 0));
  });
});

import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as TestClock from "effect/testing/TestClock";

import {
  CodexMicroRpcError,
  type CodexMicroHidDeviceInfo,
  type CodexMicroHidHandle,
  makeConnection,
  selectCodexMicroDevices,
} from "./transport.ts";

interface SentRequest {
  readonly method: string;
  readonly params: unknown;
  readonly id: number;
}

const USB_DEVICE = { path: "usb-path", transport: "usb" } as const;

function replyReports(text: string): ReadonlyArray<Uint8Array> {
  const bytes = new TextEncoder().encode(`${text}\n`);
  const reports: Array<Uint8Array> = [];
  for (let offset = 0; offset < bytes.length; offset += 61) {
    const fragment = bytes.subarray(offset, offset + 61);
    const report = new Uint8Array(64);
    report.set([0x06, 2, fragment.length]);
    report.set(fragment, 3);
    reports.push(report);
  }
  return reports;
}

const makeFakeHandle = Effect.gen(function* () {
  const sent = yield* Queue.unbounded<SentRequest>();
  const textDecoder = new TextDecoder();
  let outgoing = "";
  let dataListener: (report: Uint8Array) => void = () => undefined;
  let errorListener: (cause: unknown) => void = () => undefined;
  let writeError: unknown;
  const handle: CodexMicroHidHandle = {
    write: (report) => {
      if (writeError !== undefined) return Promise.reject(writeError);
      outgoing += textDecoder.decode(report.subarray(3, 3 + report[2]!));
      try {
        const request: SentRequest = JSON.parse(outgoing);
        outgoing = "";
        Queue.offerUnsafe(sent, request);
      } catch {}
      return Promise.resolve(64);
    },
    onData: (listener) => {
      dataListener = listener;
    },
    onError: (listener) => {
      errorListener = listener;
    },
  };
  return {
    handle,
    sent,
    deliver: (report: Uint8Array) => dataListener(report),
    reply: (text: string) => {
      for (const report of replyReports(text)) dataListener(report);
    },
    lose: () => errorListener(new Error("device removed")),
    failWrites: (cause: unknown) => {
      writeError = cause;
    },
  };
});

describe("makeConnection", () => {
  it.effect("frames a request and resolves the response with the same id", () =>
    Effect.gen(function* () {
      const device = yield* makeFakeHandle;
      const connection = yield* makeConnection(device.handle, USB_DEVICE);
      const fiber = yield* connection.request("device.status").pipe(Effect.forkChild);
      const sent = yield* Queue.take(device.sent);
      assert.deepStrictEqual(sent, { method: "device.status", params: null, id: 0 });
      device.reply('{"id":0,"result":{"battery":50}}');
      assert.deepStrictEqual(yield* Fiber.join(fiber), { battery: 50 });
    }),
  );

  it.effect("keeps one request in flight and paces the next one", () =>
    Effect.gen(function* () {
      const device = yield* makeFakeHandle;
      const connection = yield* makeConnection(device.handle, USB_DEVICE);
      const first = yield* connection.request("v.oai.rgbcfg", { a: 1 }).pipe(Effect.forkChild);
      const second = yield* connection.request("v.oai.thstatus", [1]).pipe(Effect.forkChild);
      const firstSent = yield* Queue.take(device.sent);
      assert.strictEqual(firstSent.method, "v.oai.rgbcfg");
      device.reply(`{"id":${firstSent.id},"result":null}`);
      yield* Fiber.join(first);
      assert.isTrue(Option.isNone(yield* Queue.poll(device.sent)));
      yield* TestClock.adjust(Duration.millis(50));
      const secondSent = yield* Queue.take(device.sent);
      assert.deepStrictEqual(secondSent, { method: "v.oai.thstatus", params: [1], id: 1 });
      device.reply(`{"i":${secondSent.id},"result":true}`);
      assert.strictEqual(yield* Fiber.join(second), true);
    }),
  );

  it.effect("times out a request the device never answers", () =>
    Effect.gen(function* () {
      const device = yield* makeFakeHandle;
      const connection = yield* makeConnection(device.handle, USB_DEVICE);
      const fiber = yield* connection
        .request("device.status")
        .pipe(Effect.asVoid, Effect.flip, Effect.forkChild);
      yield* Queue.take(device.sent);
      yield* TestClock.adjust(Duration.seconds(10));
      const error = yield* Fiber.join(fiber);
      assert.strictEqual(error._tag, "CodexMicroTimeoutError");
    }),
  );

  it.effect("rejects in-flight and queued requests when the device disconnects", () =>
    Effect.gen(function* () {
      const device = yield* makeFakeHandle;
      const connection = yield* makeConnection(device.handle, USB_DEVICE);
      const first = yield* connection
        .request("v.oai.rgbcfg")
        .pipe(Effect.asVoid, Effect.flip, Effect.forkChild);
      const second = yield* connection
        .request("v.oai.thstatus")
        .pipe(Effect.asVoid, Effect.flip, Effect.forkChild);
      yield* Queue.take(device.sent);
      device.lose();
      assert.strictEqual((yield* Fiber.join(first))._tag, "CodexMicroDeviceDisconnectedError");
      assert.strictEqual((yield* Fiber.join(second))._tag, "CodexMicroDeviceDisconnectedError");
      yield* connection.disconnected;
    }),
  );

  it.effect("classifies write failures", () =>
    Effect.gen(function* () {
      const device = yield* makeFakeHandle;
      const connection = yield* makeConnection(device.handle, USB_DEVICE);
      device.failWrites(new Error("Cannot write to hid device (0xE00002C5)"));
      const unavailable = yield* connection
        .request("v.oai.rgbcfg")
        .pipe(Effect.asVoid, Effect.flip);
      assert.strictEqual(unavailable._tag, "CodexMicroHidUnavailableError");
      yield* TestClock.adjust(Duration.millis(50));
      device.failWrites(new Error("Cannot write to hid device"));
      const failed = yield* connection.request("v.oai.rgbcfg").pipe(Effect.asVoid, Effect.flip);
      assert.strictEqual(failed._tag, "CodexMicroWriteFailedError");
    }),
  );

  it.effect("rejects malformed responses and keeps device error codes", () =>
    Effect.gen(function* () {
      const device = yield* makeFakeHandle;
      const connection = yield* makeConnection(device.handle, USB_DEVICE);
      const malformed = yield* connection
        .request("device.status")
        .pipe(Effect.asVoid, Effect.flip, Effect.forkChild);
      device.reply(`{"id":${(yield* Queue.take(device.sent)).id}}`);
      assert.strictEqual((yield* Fiber.join(malformed))._tag, "CodexMicroInvalidResponseError");
      yield* TestClock.adjust(Duration.millis(50));
      const rejected = yield* connection
        .request("device.status")
        .pipe(Effect.asVoid, Effect.flip, Effect.forkChild);
      const sent = yield* Queue.take(device.sent);
      device.reply(`{"id":${sent.id},"error":{"code":-32601,"message":"unknown method"}}`);
      const error = yield* Fiber.join(rejected);
      assert.instanceOf(error, CodexMicroRpcError);
      assert.strictEqual(error.code, -32601);
    }),
  );

  it.effect("delivers notifications and debug lines as device events", () =>
    Effect.gen(function* () {
      const device = yield* makeFakeHandle;
      const connection = yield* makeConnection(device.handle, USB_DEVICE);
      const debug = new Uint8Array(64);
      debug.set([0x06, 1, 4, 0x68, 0x69, 0x21, 0x0a]);
      device.deliver(debug);
      device.reply('{"m":"v.oai.hid","p":{"k":"ACT07","act":1}}');
      assert.deepStrictEqual(yield* Queue.take(connection.events), { type: "debug", line: "hi!" });
      assert.deepStrictEqual(yield* Queue.take(connection.events), {
        type: "notification",
        method: "v.oai.hid",
        params: { k: "ACT07", act: 1 },
      });
    }),
  );
});

describe("selectCodexMicroDevices", () => {
  const device = (overrides: Partial<CodexMicroHidDeviceInfo>): CodexMicroHidDeviceInfo => ({
    vendorId: 0x303a,
    productId: 0x8360,
    path: "path",
    manufacturer: "Work Louder",
    release: 0x0100,
    usagePage: 0xff00,
    ...overrides,
  });

  it("keeps the vendor interface and sorts USB before Bluetooth", () => {
    assert.deepStrictEqual(
      selectCodexMicroDevices([
        device({ path: "bt", release: 0x0101 }),
        device({ path: "keyboard", usagePage: 0x0001 }),
        device({ path: "other-product", productId: 0x8297 }),
        device({ path: undefined }),
        device({ path: "usb", release: 0x0100 }),
        device({ path: "usb" }),
      ]),
      [
        { path: "usb", transport: "usb" },
        { path: "bt", transport: "bluetooth" },
      ],
    );
  });

  it("prefers Work Louder manufacturer strings and falls back to the vendor id", () => {
    assert.deepStrictEqual(
      selectCodexMicroDevices([
        device({ path: "branded", manufacturer: "Work_Louder" }),
        device({ path: "unbranded", manufacturer: "Unknown" }),
      ]),
      [{ path: "branded", transport: "usb" }],
    );
    assert.deepStrictEqual(
      selectCodexMicroDevices([device({ path: "unbranded", manufacturer: undefined })]),
      [{ path: "unbranded", transport: "usb" }],
    );
  });
});

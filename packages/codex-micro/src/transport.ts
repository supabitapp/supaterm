import type { CodexMicroTransport as CodexMicroTransportKind } from "@supaterm/contracts";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import type * as NodeHid from "node-hid";

import {
  CODEX_MICRO_PRODUCT_ID,
  CODEX_MICRO_USAGE_PAGE,
  CODEX_MICRO_VENDOR_ID,
  CodexMicroReportDecoder,
  encodeRequest,
  frameMessage,
  nextRequestId,
  parseResponseBody,
} from "./protocol.ts";

const RESPONSE_TIMEOUT = Duration.seconds(10);
const OPERATION_DEADLINE = Duration.seconds(15);
const REQUEST_GAP = Duration.millis(50);
const HID_UNAVAILABLE_CODE = /0xE00002C5/i;

const TransportKind = Schema.Literals(["usb", "bluetooth"]);

export class CodexMicroHidLoadError extends Schema.TaggedError<CodexMicroHidLoadError>()(
  "CodexMicroHidLoadError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "The HID driver could not be loaded.";
  }
}

export class CodexMicroDiscoveryError extends Schema.TaggedError<CodexMicroDiscoveryError>()(
  "CodexMicroDiscoveryError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not list HID devices.";
  }
}

export class CodexMicroConnectError extends Schema.TaggedError<CodexMicroConnectError>()(
  "CodexMicroConnectError",
  { transport: TransportKind, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not open the keyboard over ${this.transport === "usb" ? "USB" : "Bluetooth"}.`;
  }
}

export class CodexMicroTimeoutError extends Schema.TaggedError<CodexMicroTimeoutError>()(
  "CodexMicroTimeoutError",
  { method: Schema.String },
) {
  override get message(): string {
    return `The keyboard did not answer ${this.method} in time.`;
  }
}

export class CodexMicroWriteFailedError extends Schema.TaggedError<CodexMicroWriteFailedError>()(
  "CodexMicroWriteFailedError",
  { method: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not send ${this.method} to the keyboard.`;
  }
}

export class CodexMicroHidUnavailableError extends Schema.TaggedError<CodexMicroHidUnavailableError>()(
  "CodexMicroHidUnavailableError",
  { method: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `The keyboard's HID interface became unavailable while sending ${this.method}.`;
  }
}

export class CodexMicroDeviceDisconnectedError extends Schema.TaggedError<CodexMicroDeviceDisconnectedError>()(
  "CodexMicroDeviceDisconnectedError",
  {},
) {
  override get message(): string {
    return "The keyboard disconnected.";
  }
}

export class CodexMicroRpcError extends Schema.TaggedError<CodexMicroRpcError>()(
  "CodexMicroRpcError",
  { method: Schema.String, code: Schema.Number },
) {
  override get message(): string {
    return `The keyboard rejected ${this.method} with code ${this.code}.`;
  }
}

export class CodexMicroInvalidResponseError extends Schema.TaggedError<CodexMicroInvalidResponseError>()(
  "CodexMicroInvalidResponseError",
  { method: Schema.String },
) {
  override get message(): string {
    return `The keyboard sent a malformed response to ${this.method}.`;
  }
}

const CodexMicroTransportFailure = Schema.Union([
  CodexMicroWriteFailedError,
  CodexMicroHidUnavailableError,
  CodexMicroDeviceDisconnectedError,
]);
export const isCodexMicroTransportFailure = Schema.is(CodexMicroTransportFailure);

export type CodexMicroRequestError =
  | CodexMicroTimeoutError
  | CodexMicroWriteFailedError
  | CodexMicroHidUnavailableError
  | CodexMicroDeviceDisconnectedError
  | CodexMicroRpcError
  | CodexMicroInvalidResponseError;

export interface CodexMicroHidDeviceInfo {
  readonly vendorId: number;
  readonly productId: number;
  readonly path?: string | undefined;
  readonly manufacturer?: string | undefined;
  readonly release: number;
  readonly usagePage?: number | undefined;
}

export interface CodexMicroDevice {
  readonly path: string;
  readonly transport: Exclude<CodexMicroTransportKind, "unknown">;
}

const WORK_LOUDER_MANUFACTURER = /Work[ _]Louder/i;

/**
 * hidapi does not report the bus through node-hid, so the device's release
 * number carries the transport: USB interfaces report a multiple of four.
 */
export function selectCodexMicroDevices(
  devices: ReadonlyArray<CodexMicroHidDeviceInfo>,
): ReadonlyArray<CodexMicroDevice> {
  const candidates = devices.flatMap((device) => {
    if (
      device.vendorId !== CODEX_MICRO_VENDOR_ID ||
      device.productId !== CODEX_MICRO_PRODUCT_ID ||
      device.usagePage !== CODEX_MICRO_USAGE_PAGE ||
      typeof device.path !== "string" ||
      device.path.length === 0
    ) {
      return [];
    }
    return [
      {
        path: device.path,
        release: device.release,
        branded: WORK_LOUDER_MANUFACTURER.test(device.manufacturer ?? ""),
      },
    ];
  });
  const preferred = candidates.some((candidate) => candidate.branded)
    ? candidates.filter((candidate) => candidate.branded)
    : candidates;
  const seen = new Set<string>();
  const selected: Array<CodexMicroDevice> = [];
  for (const candidate of preferred) {
    if (seen.has(candidate.path)) continue;
    seen.add(candidate.path);
    selected.push({
      path: candidate.path,
      transport: candidate.release % 4 === 0 ? "usb" : "bluetooth",
    });
  }
  return selected.sort(
    (left, right) => Number(right.transport === "usb") - Number(left.transport === "usb"),
  );
}

export interface CodexMicroHidHandle {
  readonly write: (report: Uint8Array) => Promise<unknown>;
  readonly onData: (listener: (report: Uint8Array) => void) => void;
  readonly onError: (listener: (cause: unknown) => void) => void;
}

export type CodexMicroDeviceEvent =
  | { readonly type: "notification"; readonly method: string; readonly params: unknown }
  | { readonly type: "debug"; readonly line: string };

export interface CodexMicroConnection {
  readonly device: CodexMicroDevice;
  readonly request: (
    method: string,
    params?: unknown,
  ) => Effect.Effect<unknown, CodexMicroRequestError>;
  readonly events: Queue.Dequeue<CodexMicroDeviceEvent>;
  /** Completes when the device stops answering reads or the connection closes. */
  readonly disconnected: Effect.Effect<void>;
  /** Completes once no request is in flight. */
  readonly idle: Effect.Effect<void>;
}

const writeFailure = (method: string, cause: unknown) => {
  const description = cause instanceof Error ? cause.message : String(cause);
  return HID_UNAVAILABLE_CODE.test(description)
    ? new CodexMicroHidUnavailableError({ method, cause })
    : new CodexMicroWriteFailedError({ method, cause });
};

type ResponseBody = { readonly [key: string]: unknown };

export const makeConnection = Effect.fnUntraced(function* (
  handle: CodexMicroHidHandle,
  device: CodexMicroDevice,
): Effect.fn.Return<CodexMicroConnection, never, Scope.Scope> {
  const scope = yield* Effect.scope;
  const decoder = new CodexMicroReportDecoder();
  const events = yield* Queue.unbounded<CodexMicroDeviceEvent>();
  const disconnected = yield* Deferred.make<void>();
  const permits = yield* Semaphore.make(1);
  const pending = new Map<string, Deferred.Deferred<ResponseBody>>();
  let previousId = -1;

  handle.onData((report) => {
    for (const event of decoder.push(report)) {
      if (event.type === "debug") {
        Queue.offerUnsafe(events, event);
      } else if (event.message.type === "notification") {
        Queue.offerUnsafe(events, {
          type: "notification",
          method: event.message.method,
          params: event.message.params,
        });
      } else {
        const response = pending.get(event.message.id);
        if (response === undefined) continue;
        pending.delete(event.message.id);
        Deferred.doneUnsafe(response, Exit.succeed(event.message.body));
      }
    }
  });
  handle.onError(() => {
    Deferred.doneUnsafe(disconnected, Exit.void);
  });
  yield* Effect.addFinalizer(() => Deferred.done(disconnected, Exit.void));

  const exchange = Effect.fnUntraced(function* (method: string, params: unknown) {
    previousId = nextRequestId(previousId);
    const id = previousId;
    const key = String(id);
    const response = yield* Deferred.make<ResponseBody>();
    pending.set(key, response);
    return yield* Effect.gen(function* () {
      yield* Effect.forEach(
        frameMessage(encodeRequest({ method, params, id })),
        (report) =>
          Effect.tryPromise({
            try: () => handle.write(report),
            catch: (cause) => writeFailure(method, cause),
          }),
        { discard: true },
      ).pipe(Effect.uninterruptible);
      const body = yield* Deferred.await(response).pipe(
        Effect.timeoutOrElse({
          duration: RESPONSE_TIMEOUT,
          orElse: () => Effect.fail(new CodexMicroTimeoutError({ method })),
        }),
      );
      const parsed = parseResponseBody(body);
      if (parsed === undefined) return yield* new CodexMicroInvalidResponseError({ method });
      if (parsed.type === "error") {
        return yield* new CodexMicroRpcError({ method, code: parsed.code });
      }
      return parsed.result;
    }).pipe(Effect.ensuring(Effect.sync(() => pending.delete(key))));
  });

  // The permit is held through the post-request gap so the next request waits
  // for it, without delaying the caller that already has its answer.
  const paced = (method: string, params: unknown) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        yield* restore(permits.take(1));
        const exit = yield* Effect.exit(restore(exchange(method, params)));
        yield* Effect.forkIn(
          Effect.sleep(REQUEST_GAP).pipe(Effect.ensuring(permits.release(1))),
          scope,
          { startImmediately: true },
        );
        return yield* exit;
      }),
    );

  const disconnectedFailure = Deferred.await(disconnected).pipe(
    Effect.andThen(Effect.fail(new CodexMicroDeviceDisconnectedError())),
  );

  return {
    device,
    request: (method, params) =>
      paced(method, params).pipe(
        Effect.raceFirst(disconnectedFailure),
        Effect.timeoutOrElse({
          duration: OPERATION_DEADLINE,
          orElse: () => Effect.fail(new CodexMicroTimeoutError({ method })),
        }),
      ),
    events,
    disconnected: Deferred.await(disconnected),
    idle: permits.withPermit(Effect.void),
  };
});

export class CodexMicroTransport extends Context.Service<
  CodexMicroTransport,
  {
    readonly discover: Effect.Effect<
      ReadonlyArray<CodexMicroDevice>,
      CodexMicroHidLoadError | CodexMicroDiscoveryError
    >;
    readonly connect: (
      device: CodexMicroDevice,
    ) => Effect.Effect<CodexMicroConnection, CodexMicroConnectError, Scope.Scope>;
  }
>()("@supaterm/codex-micro/transport/CodexMicroTransport") {}

const make = Effect.gen(function* () {
  const platform = yield* HostProcess.Platform;
  // node-hid is a native addon; it loads only once the feature is in use.
  let binding: Promise<typeof NodeHid> | undefined;
  const loadBinding = Effect.suspend(() => {
    const loading = (binding ??= import("node-hid"));
    return Effect.tryPromise({
      try: () => loading,
      catch: (cause) => new CodexMicroHidLoadError({ cause }),
    }).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          if (binding === loading) binding = undefined;
        }),
      ),
    );
  });

  const discover = Effect.gen(function* () {
    const hid = yield* loadBinding;
    const devices = yield* Effect.tryPromise({
      try: () => hid.devicesAsync(CODEX_MICRO_VENDOR_ID, CODEX_MICRO_PRODUCT_ID),
      catch: (cause) => new CodexMicroDiscoveryError({ cause }),
    });
    return selectCodexMicroDevices(devices);
  }).pipe(Effect.withSpan("desktop.codexMicro.transport.discover"));

  const connect = Effect.fn("desktop.codexMicro.transport.connect")(function* (
    device: CodexMicroDevice,
  ) {
    const hid = yield* loadBinding.pipe(
      Effect.mapError(
        (error) => new CodexMicroConnectError({ transport: device.transport, cause: error }),
      ),
    );
    // Linux hidraw nodes are root-only unless a udev rule grants access to
    // vendor 303a, so this open is where a missing rule surfaces.
    const handle = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () =>
          hid.HIDAsync.open(
            device.path,
            // hidapi opens macOS interfaces exclusively by default, which would
            // lock every other app out of the keyboard's vendor interface.
            platform === "darwin" ? { nonExclusive: true } : undefined,
          ),
        catch: (cause) => new CodexMicroConnectError({ transport: device.transport, cause }),
      }),
      (opened) => Effect.promise(() => opened.close().catch(() => undefined)),
    );
    return yield* makeConnection(
      {
        write: (report) => handle.write(Buffer.from(report)),
        onData: (listener) => {
          handle.on("data", listener);
        },
        onError: (listener) => {
          handle.on("error", listener);
        },
      },
      device,
    );
  });

  return CodexMicroTransport.of({ discover, connect });
});

export const layer = Layer.effect(CodexMicroTransport, make);

import * as NodeHttpServerRequest from "@effect/platform-node/NodeHttpServerRequest";
import {
  AuthPreviewOperateScope,
  AuthOrchestrationReadScope,
  PREVIEW_STREAM_HOST_SETUP_CLOSE_CODE,
  PreviewStreamHostSetup,
} from "@supaterm/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import {
  HttpPlatform,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
  Multipart,
} from "effect/http";
import * as Socket from "effect/socket/Socket";

import { authenticateMediaRequest } from "../auth/http.ts";
import { assetResponseHeaders } from "../http.ts";
import * as PreviewBrowserHost from "./PreviewBrowserHost.ts";
import * as ServerBrowser from "./ServerBrowser.ts";

const PREVIEW_STREAM_ROUTE_PREFIX = "/api/preview-stream";
const TAB_GONE_CODE = 4404;

const DEFAULT_QUALITY = 70;
const MAX_SOCKET_BUFFER_BYTES = 8 * 1024 * 1024;
const PING_INTERVAL_MS = 500;
const PING_SAMPLES = 20;
// Video a viewer's path may queue beyond its round trip, and how late its oldest frame may run.
const QUEUE_ALLOWANCE_MS = 40;
const LATE_FRAME_ALLOWANCE_MS = 120;
const textDecoder = new TextDecoder();

const intParam = (params: URLSearchParams, name: string, fallback: number, max: number) => {
  const value = Number(params.get(name));
  return Number.isFinite(value) && value > 0 ? Math.min(Math.round(value), max) : fallback;
};

type Frame = Extract<ServerBrowser.ServerBrowserViewerOutput, { readonly _tag: "frame" }>;

const decodeReply = Schema.decodeUnknownOption(
  Schema.Union([
    Schema.Struct({ type: Schema.Literal("ack"), id: Schema.optional(Schema.Number) }),
    Schema.Struct({ type: Schema.Literal("pong"), at: Schema.Number }),
  ]),
);

/**
 * Frames on the wire to one viewer. A viewer that numbers its acks and answers pings may have
 * up to its path's round trip of video in flight, measured from ping times and how long frames
 * that did not queue took to arrive; any other viewer gets one frame at a time.
 */
const makeFrameWindow = () => {
  const inFlight: Array<{
    readonly seq: number;
    readonly bytes: number;
    readonly sentAt: number;
    readonly ack: Effect.Effect<void>;
  }> = [];
  let inFlightBytes = 0;
  let sent = 0;
  let numbered = false;
  const pingRtts: Array<number> = [];
  let rttMs: number | null = null;
  let bytesPerMs: number | null = null;
  let lastAckAt = -Infinity;
  let lastPingAt = -Infinity;
  return {
    /** Pings go out only onto an empty pipe; behind frames they would time the queue. */
    pingDue: (now: number) => {
      if (!numbered || inFlight.length > 0 || now - lastPingAt < PING_INTERVAL_MS) return false;
      lastPingAt = now;
      return true;
    },
    admits: (bytes: number, now: number) =>
      inFlight.length === 0 ||
      (numbered &&
        rttMs !== null &&
        bytesPerMs !== null &&
        now - inFlight[0]!.sentAt <= rttMs + LATE_FRAME_ALLOWANCE_MS &&
        inFlightBytes + bytes <= bytesPerMs * (rttMs + QUEUE_ALLOWANCE_MS)),
    sent: (frame: Frame, now: number) => {
      const bytes = frame.data.byteLength;
      inFlight.push({ seq: ++sent, bytes, sentAt: now, ack: frame.ack });
      inFlightBytes += bytes;
    },
    /** Acks are cumulative; one without an id acks the oldest frame. */
    acked: (id: number | undefined, now: number) => {
      if (id !== undefined && id > sent) return [];
      if (id !== undefined) numbered = true;
      const count = id === undefined ? 1 : inFlight.filter((frame) => frame.seq <= id).length;
      const acked = inFlight.splice(0, count);
      for (const frame of acked) inFlightBytes -= frame.bytes;
      const first = acked[0];
      if (first === undefined) return [];
      // A frame sent after the one ahead of it could have arrived did not queue behind it, so
      // it spent all but a round trip on the link; a late ack only makes the link look slower.
      if (rttMs !== null && first.sentAt + rttMs >= lastAckAt && now - first.sentAt > rttMs) {
        const sample = first.bytes / (now - first.sentAt - rttMs);
        bytesPerMs = bytesPerMs === null ? sample : bytesPerMs * 0.7 + sample * 0.3;
      }
      lastAckAt = now;
      return acked.map((frame) => frame.ack);
    },
    pong: (rtt: number) => {
      if (!numbered) return;
      pingRtts.push(rtt);
      if (pingRtts.length > PING_SAMPLES) pingRtts.shift();
      rttMs = Math.min(...pingRtts);
    },
  };
};

const pingMessage = (at: number) => JSON.stringify({ type: "ping", at });

// Elapsed times must not jump with the wall clock.
const nowMs = Clock.monotonicTimeNanos.pipe(Effect.map((nanos) => Number(nanos) / 1_000_000));

const parseMessage = (chunk: Uint8Array | string): unknown => {
  try {
    return JSON.parse(typeof chunk === "string" ? chunk : textDecoder.decode(chunk));
  } catch {
    return null;
  }
};

const makeHandler = Effect.fnUntraced(function* (browser: ServerBrowser.ServerBrowser["Service"]) {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const url = HttpServerRequest.toURL(request);
  if (Option.isNone(url)) return HttpServerResponse.text("Bad Request", { status: 400 });
  if (url.value.pathname === `${PREVIEW_STREAM_ROUTE_PREFIX}/download`) {
    return yield* serveDownload(browser, url.value.searchParams);
  }
  if (url.value.pathname === `${PREVIEW_STREAM_ROUTE_PREFIX}/upload`) {
    return request.method === "POST"
      ? yield* receiveUpload(browser, url.value.searchParams)
      : HttpServerResponse.text("Method Not Allowed", { status: 405 });
  }
  if (
    url.value.pathname !== `${PREVIEW_STREAM_ROUTE_PREFIX}/ws` ||
    request.headers.upgrade?.toLowerCase() !== "websocket"
  ) {
    return HttpServerResponse.text("Not Found", { status: 404 });
  }
  const session = yield* authenticateMediaRequest(AuthOrchestrationReadScope);
  const params = url.value.searchParams;
  const canOperate =
    session.scopes.includes(AuthPreviewOperateScope) && params.get("interactive") !== "false";
  const threadId = params.get("threadId") ?? "";
  const tabId = params.get("tabId") ?? "";
  if (threadId.length === 0 || tabId.length === 0) {
    return HttpServerResponse.text("Not Found", { status: 404 });
  }
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const attached = yield* browser
        .attachViewer({
          threadId,
          tabId,
          canOperate,
          maxWidth: intParam(params, "maxWidth", 1280, 7680),
          maxHeight: intParam(params, "maxHeight", 800, 4320),
          quality: intParam(params, "quality", DEFAULT_QUALITY, 100),
        })
        .pipe(
          Effect.map((viewer) => ({ _tag: "attached" as const, viewer })),
          Effect.catchTags({
            ServerBrowserTabNotFoundError: () => Effect.succeed({ _tag: "gone" as const }),
            ServerBrowserLaunchError: (error) => {
              const setup = hostSetup(error.cause);
              return setup === undefined
                ? Effect.fail(error)
                : Effect.succeed({ _tag: "hostSetup" as const, reason: encodeHostSetup(setup) });
            },
          }),
        );
      const incoming = NodeHttpServerRequest.toIncomingMessage(request);

      delete incoming.headers["sec-websocket-extensions"];
      const transport = incoming.socket;
      const socket = yield* request.upgrade;
      const reader = yield* socket.reader;
      const writer = yield* socket.writer;

      const gone = writer.write(new Socket.CloseEvent(TAB_GONE_CODE, "tab closed"));
      if (attached._tag === "gone") {
        yield* gone;
        return HttpServerResponse.empty();
      }
      if (attached._tag === "hostSetup") {
        yield* writer.write(
          new Socket.CloseEvent(PREVIEW_STREAM_HOST_SETUP_CLOSE_CODE, attached.reason),
        );
        return HttpServerResponse.empty();
      }
      const viewer = attached.viewer;
      // `write` returns once the frame is queued, so Chromium's ack for each frame waits
      // for the viewer's `ack` message instead. Only the newest frame waits for room on
      // the wire, so replies never queue behind stale images on a slow link.
      const frames = makeFrameWindow();
      let pending: Frame | null = null;
      const disconnectSlowViewer = Effect.sync(() => transport.destroy()).pipe(
        Effect.andThen(Effect.interrupt),
      );
      const write = (data: Uint8Array | string) =>
        Effect.suspend(() => {
          const bytes = typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
          if (transport.writableLength + bytes + 14 > MAX_SOCKET_BUFFER_BYTES) {
            return disconnectSlowViewer;
          }
          return writer.write(data);
        });
      // Both fibers send frames. One at a time keeps the window's order the wire's order.
      const sending = yield* Semaphore.make(1);
      const sendPending = Effect.gen(function* () {
        const now = yield* nowMs;
        if (pending === null || !frames.admits(pending.data.byteLength, now)) return;
        const next = pending;
        pending = null;
        if (frames.pingDue(now)) yield* write(pingMessage(now));
        frames.sent(next, now);
        yield* write(next.data);
      }).pipe(sending.withPermits(1));
      const sendOutput = Queue.take(viewer.output).pipe(
        Effect.flatMap((output) => {
          switch (output._tag) {
            case "frame": {
              const superseded = pending;
              pending = output;
              // Never sent, but Chromium still waits for its ack.
              return Effect.andThen(
                superseded ? Effect.forkScoped(superseded.ack) : Effect.void,
                sendPending,
              );
            }
            case "viewport":
            case "control":
            case "clipboard":
            case "download":
            case "fileChooser":
            case "fileChooserClosed":
            case "popup":
            case "pointer":
            case "probe": {
              const { _tag: type, ...data } = output;
              return write(JSON.stringify({ type, ...data }));
            }
            case "gone":
              return gone.pipe(Effect.andThen(Effect.interrupt));
            case "reconnect":
              return writer
                .write(new Socket.CloseEvent(1012, "reconnect"))
                .pipe(Effect.andThen(Effect.interrupt));
          }
        }),
      );
      // Incoming messages share the session span; frame acknowledgements are frequent.
      const receive = Effect.fnUntraced(function* (chunk: Uint8Array | string) {
        const message = parseMessage(chunk);
        // Ownership serializes actions in the service. Keep reading so dialog
        // replies and takeover can unblock an action already waiting on the page.
        const reply = decodeReply(message);
        if (Option.isNone(reply))
          return yield* canOperate
            ? viewer.input(message).pipe(Effect.forkScoped, Effect.asVoid)
            : Effect.void;
        const now = yield* nowMs;
        if (reply.value.type === "pong") frames.pong(Math.max(0, now - reply.value.at));
        // Forked: Chromium acks are paced and must not hold up input.
        else for (const ack of frames.acked(reply.value.id, now)) yield* Effect.forkScoped(ack);
        return yield* sendPending;
      });
      const receiveInput = reader.pull.pipe(
        Effect.flatMap((chunks) => Effect.forEach(chunks, receive, { discard: true })),
      );
      return yield* Effect.raceFirst(Effect.forever(sendOutput), Effect.forever(receiveInput));
    }),
  ).pipe(
    Effect.catchTags({
      ServerBrowserLaunchError: (error) =>
        Effect.logWarning("server preview browser failed to start", { cause: error.cause }).pipe(
          Effect.as(HttpServerResponse.text("Service Unavailable", { status: 503 })),
        ),
    }),
    Effect.orElseSucceed(() => HttpServerResponse.empty()),
  );
});

const hostSetup = (cause: unknown): PreviewStreamHostSetup | undefined =>
  isSandboxError(cause)
    ? { need: "sandbox", command: cause.setupCommand }
    : isLibrariesError(cause)
      ? { need: "libraries", command: cause.setupCommand }
      : undefined;
const isSandboxError = Schema.is(PreviewBrowserHost.PreviewBrowserSandboxError);
const isLibrariesError = Schema.is(PreviewBrowserHost.PreviewBrowserLibrariesError);
const encodeHostSetup = Schema.encodeSync(Schema.fromJsonString(PreviewStreamHostSetup));

// The request span already covers this download route.
const serveDownload = Effect.fnUntraced(function* (
  browser: ServerBrowser.ServerBrowser["Service"],
  params: URLSearchParams,
) {
  yield* authenticateMediaRequest(AuthOrchestrationReadScope);
  const download = yield* browser.openDownload({
    threadId: params.get("threadId") ?? "",
    tabId: params.get("tabId") ?? "",
    downloadId: params.get("id") ?? "",
  });
  if (Option.isNone(download)) return HttpServerResponse.text("Not Found", { status: 404 });
  return yield* HttpServerResponse.file(download.value.path, {
    headers: assetResponseHeaders(download.value.path, {
      download: true,
      fileName: download.value.fileName,
    }),
  });
});

const UPLOAD_MAX_FILE_BYTES = 100 * 1024 * 1024;
const UPLOAD_MAX_FILES = 20;

// The request span already covers this upload route.
const receiveUpload = Effect.fnUntraced(
  function* (browser: ServerBrowser.ServerBrowser["Service"], params: URLSearchParams) {
    yield* authenticateMediaRequest(AuthPreviewOperateScope);
    const request = yield* HttpServerRequest.HttpServerRequest;
    const fs = yield* FileSystem.FileSystem;
    const parts = yield* request.multipart.pipe(
      Effect.provideContext(
        Multipart.limitsServices({
          maxParts: UPLOAD_MAX_FILES,
          maxFileSize: UPLOAD_MAX_FILE_BYTES,
          maxTotalSize: UPLOAD_MAX_FILE_BYTES,
        }),
      ),
    );
    const files = yield* Effect.forEach(
      Object.values(parts).flatMap((value) =>
        Array.isArray(value) ? value.filter(Multipart.isPersistedFile) : [],
      ),
      (file) =>
        fs.readFile(file.path).pipe(
          Effect.map((bytes) => ({
            name: file.name,
            mimeType: file.contentType,
            buffer: Buffer.from(bytes),
          })),
        ),
    );
    const answered = yield* browser.answerFileChooser({
      threadId: params.get("threadId") ?? "",
      tabId: params.get("tabId") ?? "",
      chooserId: params.get("chooser") ?? "",
      files,
    });
    return answered
      ? HttpServerResponse.empty({ status: 204 })
      : HttpServerResponse.text("The page's file picker is no longer open.", { status: 409 });
  },
  (effect, _browser, _params) => effect.pipe(Effect.scoped),
);

export const routeLayer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const browser = yield* ServerBrowser.ServerBrowser;
    const platform = yield* Effect.context<
      HttpPlatform.HttpPlatform | FileSystem.FileSystem | Path.Path
    >();
    const handler = makeHandler(browser).pipe(Effect.provideContext(platform));
    yield* router.add("GET", `${PREVIEW_STREAM_ROUTE_PREFIX}/*`, handler);
    yield* router.add("POST", `${PREVIEW_STREAM_ROUTE_PREFIX}/upload`, handler);
  }),
);

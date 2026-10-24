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
import * as Predicate from "effect/Predicate";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
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
import * as PreviewStreamPacer from "./PreviewStreamPacer.ts";
import * as ServerBrowser from "./ServerBrowser.ts";

const PREVIEW_STREAM_ROUTE_PREFIX = "/api/preview-stream";
/** Matches `PREVIEW_STREAM_TAB_GONE_CODE` in the client. */
const TAB_GONE_CODE = 4404;

const DEFAULT_QUALITY = 70;
const MAX_SOCKET_BUFFER_BYTES = 8 * 1024 * 1024;
const PING_INTERVAL_MS = 1_000;
const PING_MESSAGE = JSON.stringify({ type: "ping" });
const REPEAT_CANDIDATES = 2;
const textDecoder = new TextDecoder();

const intParam = (params: URLSearchParams, name: string, fallback: number, max: number) => {
  const value = Number(params.get(name));
  return Number.isFinite(value) && value > 0 ? Math.min(Math.round(value), max) : fallback;
};

type Frame = Extract<ServerBrowser.ServerBrowserViewerOutput, { readonly _tag: "frame" }>;

const isControl = (message: unknown, type: "ack" | "pong") =>
  Predicate.hasProperty(message, "type") && message.type === type;

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
      // `write` returns once the frame is queued, so a frame counts as in
      // flight until the viewer's `ack` for it. Only the newest frame waits
      // behind those, so replies never queue behind stale images on a slow link.
      const pacer = PreviewStreamPacer.make();
      let pending: Frame | null = null;
      let waking = false;
      let pingSentAt: number | null = null;
      let lastPingAt = Number.NEGATIVE_INFINITY;
      // A blinking caret alternates between two identical images; viewers that
      // keep their recent frames get a reference instead of the image again.
      const repeats = params.get("repeat") === "1";
      const recentFrames: Array<{ readonly id: number; readonly data: Uint8Array }> = [];
      let nextFrameId = 0;
      const payload = (data: Uint8Array) => {
        if (!repeats) return data;
        const recent = recentFrames.find((frame) => Buffer.compare(frame.data, data) === 0);
        if (recent) return JSON.stringify({ type: "repeat", id: recent.id });
        recentFrames.unshift({ id: nextFrameId++, data });
        if (recentFrames.length > REPEAT_CANDIDATES) recentFrames.pop();
        return data;
      };
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
      const flush: Effect.Effect<void, Socket.SocketError, Scope.Scope> = Effect.gen(function* () {
        if (pending === null) return;
        const now = yield* Clock.currentTimeMillis;
        const bytes = pending.data.byteLength;
        if (!pacer.canSend(now, bytes)) {
          const wakeAt = pacer.wakeAt(now, bytes);
          if (wakeAt === null || waking) return;
          waking = true;
          yield* Effect.sleep(wakeAt - now).pipe(
            Effect.andThen(Effect.sync(() => (waking = false))),
            Effect.andThen(flush),
            Effect.forkScoped,
          );
          return;
        }
        const frame = pending;
        pending = null;
        // Only a ping with nothing in flight measures the path alone.
        if (pacer.idle() && pingSentAt === null && now - lastPingAt >= PING_INTERVAL_MS) {
          pingSentAt = now;
          lastPingAt = now;
          yield* write(PING_MESSAGE);
        }
        const data = payload(frame.data);
        pacer.sent(now, typeof data === "string" ? data.length : data.byteLength);
        yield* write(data);
        yield* Effect.forkScoped(frame.ack);
      });
      const sendOutput = Queue.take(viewer.output).pipe(
        Effect.flatMap((output) => {
          switch (output._tag) {
            case "frame": {
              const superseded = pending;
              pending = output;
              // Never sent, but Chromium still waits for its ack.
              return superseded
                ? Effect.forkScoped(superseded.ack).pipe(Effect.andThen(flush))
                : flush;
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
      const receive = (chunk: Uint8Array | string) => {
        const message = parseMessage(chunk);
        if (isControl(message, "ack")) {
          return Clock.currentTimeMillis.pipe(
            Effect.map((now) => pacer.acked(now)),
            Effect.andThen(flush),
          );
        }
        if (isControl(message, "pong")) {
          return Clock.currentTimeMillis.pipe(
            Effect.map((now) => {
              if (pingSentAt !== null) pacer.probed(now - pingSentAt);
              pingSentAt = null;
            }),
          );
        }
        // Ownership serializes actions in the service. Keep reading so dialog
        // replies and takeover can unblock an action already waiting on the page.
        return canOperate
          ? viewer.input(message).pipe(Effect.forkScoped, Effect.asVoid)
          : Effect.void;
      };
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
    Effect.catch(() => Effect.succeed(HttpServerResponse.empty())),
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

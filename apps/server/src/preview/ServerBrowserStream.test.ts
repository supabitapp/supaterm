import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthPreviewOperateScope,
  AuthSessionId,
  PREVIEW_STREAM_HOST_SETUP_CLOSE_CODE,
  PreviewStreamHostSetup,
  type AuthEnvironmentScope,
} from "@supaterm/contracts";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { HttpRouter, HttpServer, HttpServerRequest } from "effect/http";
import * as Socket from "effect/socket/Socket";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as PreviewBrowserHost from "./PreviewBrowserHost.ts";
import * as ServerBrowser from "./ServerBrowser.ts";
import { routeLayer } from "./ServerBrowserStream.ts";

const platformLayer = NodeHttpPlatform.layer.pipe(Layer.provideMerge(NodeServices.layer));

type Chunk = Parameters<Socket.Writer["write"]>[0];

const makeAuth = (
  scopes: ReadonlyArray<AuthEnvironmentScope>,
  error?: EnvironmentAuth.ServerAuthCredentialError,
) => {
  const requests: string[] = [];
  const layer = Layer.mock(EnvironmentAuth.EnvironmentAuth, {
    authenticateWebSocketUpgrade: (request) => {
      requests.push(request.originalUrl);
      return error
        ? Effect.fail(error)
        : Effect.succeed({
            sessionId: AuthSessionId.make("stream-test"),
            subject: "stream-test",
            method: "bearer-access-token",
            scopes,
          });
    },
  });
  return { layer, requests };
};

const mutations = [
  { type: "resize", width: 390, height: 844 },
  { type: "mouse", action: "down", x: 10, y: 10, button: "left", buttons: 1 },
  { type: "key", action: "down", key: "Enter" },
  { type: "text", text: "reader must not type" },
  { type: "wheel", deltaY: 100 },
  { type: "navigate", url: "https://example.com" },
  { type: "history", delta: -1 },
  { type: "reload" },
  { type: "probe", x: 10, y: 10 },
  { type: "takeControl" },
  { type: "releaseControl" },
  { type: "dialog", accept: true },
  { type: "viewport", setting: { _tag: "fill" } },
];

it.effect.each([
  { preview: false, orchestration: false, interactive: true },
  { preview: false, orchestration: true, interactive: true },
  { preview: true, orchestration: false, interactive: true },
  { preview: true, orchestration: true, interactive: true },
  { preview: true, orchestration: false, interactive: false },
])(
  "streams frames and acks while gating page mutations (%s)",
  ({ preview, orchestration, interactive }) =>
    Effect.gen(function* () {
      const canOperate = preview && interactive;
      const scopes = [
        AuthOrchestrationReadScope,
        ...(preview ? [AuthPreviewOperateScope] : []),
        ...(orchestration ? [AuthOrchestrationOperateScope] : []),
      ];
      const auth = makeAuth(scopes);
      const inputs: unknown[] = [];
      const attachments: Parameters<ServerBrowser.ServerBrowser["Service"]["attachViewer"]>[0][] =
        [];
      const acked = Promise.withResolvers<void>();
      const frame = new Uint8Array([255, 216, 255, 217]);
      const output = yield* Queue.make<ServerBrowser.ServerBrowserViewerOutput>();
      yield* Queue.offer(output, { _tag: "viewport", width: 1280, height: 800 });
      yield* Queue.offer(output, {
        _tag: "frame",
        data: frame,
        ack: Effect.sync(() => acked.resolve()),
      });
      const browser = ServerBrowser.ServerBrowser.of({
        clearProfile: () => Effect.void,
        profileReporter: Effect.succeed(() => Effect.void),
        openDownload: () => Effect.succeedNone,
        answerFileChooser: () => Effect.succeed(false),
        attachViewer: (input) =>
          Effect.sync(() => {
            attachments.push(input);
            return {
              output,
              input: (message) => Effect.sync(() => void inputs.push(message)),
            };
          }),
      });
      const services = yield* Layer.build(
        HttpRouter.serve(
          routeLayer.pipe(
            Layer.provide(Layer.succeed(ServerBrowser.ServerBrowser, browser)),
            Layer.provide(platformLayer),
          ),
          { disableListenLog: true },
        ).pipe(Layer.provideMerge(NodeHttpServer.layerTest), Layer.provide(auth.layer)),
      );
      const server = Context.get(services, HttpServer.HttpServer);
      const origin = HttpServer.formatAddress(server.address).replace(/^http/, "ws");
      const resource = `/api/preview-stream/ws?threadId=thread&tabId=tab&wsTicket=one-use-ticket${interactive ? "" : "&interactive=false"}`;
      const received = Promise.withResolvers<void>();
      const socket = yield* Effect.acquireRelease(
        Effect.sync(() => new WebSocket(`${origin}${resource}`)),
        (socket) => Effect.sync(() => socket.close()),
      );
      socket.binaryType = "arraybuffer";
      const viewports: unknown[] = [];
      const frames: Uint8Array[] = [];
      socket.addEventListener("error", () => received.reject(new Error("stream failed")));
      socket.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          viewports.push(JSON.parse(event.data));
          return;
        }
        frames.push(new Uint8Array(event.data as ArrayBuffer));
        for (const message of mutations) socket.send(JSON.stringify(message));
        socket.send("malformed input");
        socket.send(JSON.stringify({ type: "ack" }));
        received.resolve();
      });
      yield* Effect.promise(() => received.promise);
      // The ack follows every mutation on the socket, so this is also a barrier
      // proving all preceding inputs were processed, without a timing sleep.
      yield* Effect.promise(() => acked.promise);
      expect(frames).toEqual([frame]);
      expect(viewports).toEqual([{ type: "viewport", width: 1280, height: 800 }]);
      expect(inputs).toEqual(canOperate ? [...mutations, null] : []);
      expect(attachments).toEqual([
        {
          threadId: "thread",
          tabId: "tab",
          maxWidth: 1280,
          maxHeight: 800,
          quality: 70,
          canOperate,
        },
      ]);
      expect(auth.requests).toEqual([resource]);
    }).pipe(Effect.scoped),
);

it.effect("sends replies ahead of stale frames and only the newest frame after an ack", () =>
  Effect.gen(function* () {
    const output = yield* Queue.make<ServerBrowser.ServerBrowserViewerOutput>();
    const released: number[] = [];
    const frame = (id: number): ServerBrowser.ServerBrowserViewerOutput => ({
      _tag: "frame",
      data: new Uint8Array([id]),
      ack: Effect.sync(() => void released.push(id)),
    });
    const browser = ServerBrowser.ServerBrowser.of({
      clearProfile: () => Effect.void,
      profileReporter: Effect.succeed(() => Effect.void),
      openDownload: () => Effect.succeedNone,
      answerFileChooser: () => Effect.succeed(false),
      attachViewer: () => Effect.succeed({ output, input: () => Effect.void }),
    });
    const services = yield* Layer.build(
      HttpRouter.serve(
        routeLayer.pipe(
          Layer.provide(Layer.succeed(ServerBrowser.ServerBrowser, browser)),
          Layer.provide(platformLayer),
        ),
        { disableListenLog: true },
      ).pipe(
        Layer.provideMerge(NodeHttpServer.layerTest),
        Layer.provide(makeAuth([AuthOrchestrationReadScope]).layer),
      ),
    );
    const server = Context.get(services, HttpServer.HttpServer);
    const origin = HttpServer.formatAddress(server.address).replace(/^http/, "ws");
    const received: Array<number | string> = [];
    let next = Promise.withResolvers<void>();
    const socket = yield* Effect.acquireRelease(
      Effect.sync(
        () =>
          new WebSocket(
            `${origin}/api/preview-stream/ws?threadId=thread&tabId=tab&wsTicket=one-use-ticket`,
          ),
      ),
      (socket) => Effect.sync(() => socket.close()),
    );
    socket.binaryType = "arraybuffer";
    socket.addEventListener("message", (event) => {
      received.push(
        typeof event.data === "string"
          ? JSON.parse(event.data).type
          : new Uint8Array(event.data as ArrayBuffer)[0]!,
      );
      next.resolve();
    });

    yield* Queue.offer(output, frame(1));
    yield* Effect.promise(() => next.promise);
    next = Promise.withResolvers();
    yield* Queue.offerAll(output, [
      frame(2),
      frame(3),
      frame(4),
      { _tag: "probe", x: 0, y: 0, editable: false },
    ]);
    yield* Effect.promise(() => next.promise);
    expect(received).toEqual([1, "probe"]);

    expect(released).toEqual([2, 3]);

    next = Promise.withResolvers();
    socket.send(JSON.stringify({ type: "ack" }));
    yield* Effect.promise(() => next.promise);
    expect(received).toEqual([1, "probe", 4]);
    expect(released).toEqual([2, 3, 1]);
  }).pipe(Effect.scoped),
);

it.effect.each([
  { link: "150 ms away on a fast link", rttMs: 150, deliveryMs: 1, inFlight: [4, 5, 6] },
  {
    link: "60 ms away on a link that takes 650 ms per frame",
    rttMs: 60,
    deliveryMs: 650,
    inFlight: [4],
  },
])(
  "a viewer that numbers its acks gets frames ahead of them while its link has room ($link)",
  ({ rttMs, deliveryMs, inFlight }) =>
    Effect.gen(function* () {
      const output = yield* Queue.make<ServerBrowser.ServerBrowserViewerOutput>();
      const released = yield* Queue.unbounded<number>();
      const inputs = yield* Queue.unbounded<unknown>();
      const frame = (id: number): ServerBrowser.ServerBrowserViewerOutput => ({
        _tag: "frame",
        data: new Uint8Array(10_000).fill(id),
        ack: Queue.offer(released, id).pipe(Effect.asVoid),
      });
      const browser = ServerBrowser.ServerBrowser.of({
        clearProfile: () => Effect.void,
        profileReporter: Effect.succeed(() => Effect.void),
        openDownload: () => Effect.succeedNone,
        answerFileChooser: () => Effect.succeed(false),
        attachViewer: () =>
          Effect.succeed({ output, input: (message) => Queue.offer(inputs, message) }),
      });
      const services = yield* Layer.build(
        HttpRouter.serve(
          routeLayer.pipe(
            Layer.provide(Layer.succeed(ServerBrowser.ServerBrowser, browser)),
            Layer.provide(platformLayer),
          ),
          { disableListenLog: true },
        ).pipe(
          Layer.provideMerge(NodeHttpServer.layerTest),
          Layer.provide(makeAuth([AuthOrchestrationReadScope, AuthPreviewOperateScope]).layer),
        ),
      );
      const server = Context.get(services, HttpServer.HttpServer);
      const origin = HttpServer.formatAddress(server.address).replace(/^http/, "ws");
      const frames = yield* Queue.unbounded<number | "probe">();
      const pings = yield* Queue.unbounded<number>();
      const socket = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new WebSocket(
              `${origin}/api/preview-stream/ws?threadId=thread&tabId=tab&wsTicket=one-use-ticket`,
            ),
        ),
        (socket) => Effect.sync(() => socket.close()),
      );
      socket.binaryType = "arraybuffer";
      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string") {
          Queue.offerUnsafe(frames, new Uint8Array(event.data as ArrayBuffer)[0]!);
          return;
        }
        const message = JSON.parse(event.data);
        if (message.type === "ping") Queue.offerUnsafe(pings, message.at);
        if (message.type === "probe") Queue.offerUnsafe(frames, "probe");
      });
      const reply = (message: object) => Effect.sync(() => socket.send(JSON.stringify(message)));
      // Replies go out unwindowed, so a probe arrives after every frame sent before it.
      const sentAhead = Effect.gen(function* () {
        yield* Queue.offer(output, { _tag: "probe", x: 0, y: 0, editable: false });
        const sent: Array<number | "probe"> = [];
        for (
          let next = yield* Queue.take(frames);
          next !== "probe";
          next = yield* Queue.take(frames)
        )
          sent.push(next);
        return sent;
      });

      // Until its link is measured, a viewer gets one frame at a time.
      yield* Queue.offerAll(output, [frame(1), frame(2)]);
      expect(yield* sentAhead).toEqual([1]);
      // Its first numbered ack gets the next frame a ping ahead of it, while nothing is queued.
      yield* reply({ type: "ack", id: 1 });
      const pinged = yield* Queue.take(pings);
      expect(yield* Queue.take(frames)).toBe(2);
      yield* TestClock.adjust(rttMs);
      yield* reply({ type: "pong", at: pinged });
      yield* reply({ type: "ack", id: 2 });
      expect(yield* Queue.takeN(released, 2)).toEqual([1, 2]);
      yield* Queue.offer(output, frame(3));
      expect(yield* Queue.take(frames)).toBe(3);
      yield* TestClock.adjust(rttMs + deliveryMs);
      yield* reply({ type: "ack", id: 3 });
      expect(yield* Queue.take(released)).toBe(3);

      yield* Queue.offerAll(output, [frame(4), frame(5), frame(6)]);
      expect(yield* sentAhead).toEqual(inFlight);
      // Nothing more goes out once the oldest frame is late.
      yield* TestClock.adjust(rttMs + 121);
      yield* Queue.offerAll(output, [frame(7), frame(8)]);
      expect(yield* sentAhead).toEqual([]);
      // Acks are cumulative, so a repeated one releases nothing twice, and one for a frame
      // never sent releases nothing.
      yield* reply({ type: "ack", id: inFlight.at(-1)! });
      yield* reply({ type: "ack", id: inFlight.at(-1)! });
      yield* reply({ type: "ack", id: 999 });
      yield* reply({ type: "takeControl" });
      expect(yield* Queue.take(inputs)).toEqual({ type: "takeControl" });
      expect(yield* Queue.take(frames)).toBe(8);
      expect((yield* Queue.clear(released)).toSorted()).toEqual([4, 5, 6, 7]);
    }).pipe(Effect.scoped),
);

it.effect("keeps frames in order and acks matched while an ack's send is mid-write", () =>
  Effect.gen(function* () {
    const output = yield* Queue.make<ServerBrowser.ServerBrowserViewerOutput>();
    const released = yield* Queue.unbounded<number>();
    const frame = (id: number): ServerBrowser.ServerBrowserViewerOutput => ({
      _tag: "frame",
      data: new Uint8Array(10_000).fill(id),
      ack: Queue.offer(released, id).pipe(Effect.asVoid),
    });
    const browser = ServerBrowser.ServerBrowser.of({
      clearProfile: () => Effect.void,
      profileReporter: Effect.succeed(() => Effect.void),
      openDownload: () => Effect.succeedNone,
      answerFileChooser: () => Effect.succeed(false),
      attachViewer: () => Effect.succeed({ output, input: () => Effect.void }),
    });
    let hold:
      | {
          readonly matches: (chunk: Chunk) => boolean;
          readonly reached: Deferred.Deferred<void>;
          readonly release: Deferred.Deferred<void>;
        }
      | undefined;
    const heldWrites = (request: HttpServerRequest.HttpServerRequest) =>
      Object.create(request, {
        upgrade: {
          value: request.upgrade.pipe(
            Effect.map((socket) =>
              Socket.make({
                reader: socket.reader,
                writer: Effect.map(socket.writer, (writer) => ({
                  ...writer,
                  write: (chunk: Chunk) =>
                    Effect.suspend(() => {
                      const held = hold?.matches(chunk) ? hold : undefined;
                      if (held === undefined) return writer.write(chunk);
                      hold = undefined;
                      return Deferred.succeed(held.reached, undefined).pipe(
                        Effect.andThen(Deferred.await(held.release)),
                        Effect.andThen(writer.write(chunk)),
                      );
                    }),
                })),
              }),
            ),
          ),
        },
      }) as HttpServerRequest.HttpServerRequest;
    const services = yield* Layer.build(
      HttpRouter.serve(
        routeLayer.pipe(
          Layer.provide(Layer.succeed(ServerBrowser.ServerBrowser, browser)),
          Layer.provide(platformLayer),
        ),
        {
          disableListenLog: true,
          middleware: Effect.updateService(HttpServerRequest.HttpServerRequest, heldWrites),
        },
      ).pipe(
        Layer.provideMerge(NodeHttpServer.layerTest),
        Layer.provide(makeAuth([AuthOrchestrationReadScope]).layer),
      ),
    );
    const server = Context.get(services, HttpServer.HttpServer);
    const origin = HttpServer.formatAddress(server.address).replace(/^http/, "ws");
    const frames = yield* Queue.unbounded<number | "probe">();
    const pings = yield* Queue.unbounded<number>();
    const socket = yield* Effect.acquireRelease(
      Effect.sync(
        () =>
          new WebSocket(
            `${origin}/api/preview-stream/ws?threadId=thread&tabId=tab&wsTicket=one-use-ticket`,
          ),
      ),
      (socket) => Effect.sync(() => socket.close()),
    );
    socket.binaryType = "arraybuffer";
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") {
        Queue.offerUnsafe(frames, new Uint8Array(event.data as ArrayBuffer)[0]!);
        return;
      }
      const message = JSON.parse(event.data);
      if (message.type === "ping") Queue.offerUnsafe(pings, message.at);
      if (message.type === "probe") Queue.offerUnsafe(frames, "probe");
    });
    const reply = (message: object) => Effect.sync(() => socket.send(JSON.stringify(message)));
    const sentAhead = Effect.gen(function* () {
      yield* Queue.offer(output, { _tag: "probe", x: 0, y: 0, editable: false });
      const sent: Array<number | "probe"> = [];
      for (let next = yield* Queue.take(frames); next !== "probe"; next = yield* Queue.take(frames))
        sent.push(next);
      return sent;
    });
    // Holds the write `trigger` leads to while frame `id` reaches the stream, which takes it
    // before the write resumes.
    const arrivesMidWrite = (
      matches: (chunk: Chunk) => boolean,
      trigger: Effect.Effect<void>,
      id: number,
    ) =>
      Effect.gen(function* () {
        const held = {
          matches,
          reached: yield* Deferred.make<void>(),
          release: yield* Deferred.make<void>(),
        };
        hold = held;
        yield* trigger;
        yield* Deferred.await(held.reached);
        yield* Queue.offer(output, frame(id));
        yield* Effect.yieldNow;
        yield* Deferred.succeed(held.release, undefined);
      });

    yield* Queue.offerAll(output, [frame(1), frame(2)]);
    expect(yield* sentAhead).toEqual([1]);
    // The first numbered ack sends frame 2 a ping ahead of it.
    yield* arrivesMidWrite(
      (chunk) => typeof chunk === "string" && chunk.includes('"ping"'),
      reply({ type: "ack", id: 1 }),
      3,
    );
    // An unmeasured viewer gets one frame at a time, and frame 3 must not overtake frame 2.
    expect(yield* sentAhead).toEqual([2]);
    yield* TestClock.adjust(150);
    yield* reply({ type: "pong", at: yield* Queue.take(pings) });
    yield* reply({ type: "ack", id: 2 });
    expect(yield* Queue.take(frames)).toBe(3);
    yield* TestClock.adjust(151);
    yield* reply({ type: "ack", id: 3 });
    expect(yield* Queue.takeN(released, 3)).toEqual([1, 2, 3]);

    // Measured now; frame 4 runs late so frame 5 waits for its ack.
    yield* Queue.offer(output, frame(4));
    expect(yield* Queue.take(frames)).toBe(4);
    yield* TestClock.adjust(150 + 121);
    yield* Queue.offer(output, frame(5));
    expect(yield* sentAhead).toEqual([]);
    yield* arrivesMidWrite(
      (chunk) => chunk instanceof Uint8Array && chunk[0] === 5,
      reply({ type: "ack", id: 4 }),
      6,
    );
    const received = yield* sentAhead;
    // Ack n releases the Chromium ack of the viewer's nth binary, once.
    yield* reply({ type: "ack", id: 5 });
    expect(yield* Queue.takeN(released, 2)).toEqual([4, received[0]]);
    yield* reply({ type: "ack", id: 6 });
    expect(yield* Queue.take(released)).toBe(received[1]);
    expect(received).toEqual([5, 6]);
    expect(yield* Queue.clear(released)).toEqual([]);
  }).pipe(Effect.scoped),
);

it.effect.each([
  { scopes: [], error: undefined, status: 403 },
  { scopes: [AuthOrchestrationOperateScope], error: undefined, status: 403 },
  { scopes: [], error: new EnvironmentAuth.ServerAuthMissingCredentialError({}), status: 401 },
])("rejects unauthorized stream connections before attaching a viewer (%s)", (testCase) =>
  Effect.gen(function* () {
    const auth = makeAuth(testCase.scopes, testCase.error);
    let attachments = 0;
    const browser = ServerBrowser.ServerBrowser.of({
      clearProfile: () => Effect.void,
      profileReporter: Effect.succeed(() => Effect.void),
      openDownload: () => Effect.succeedNone,
      answerFileChooser: () => Effect.succeed(false),
      attachViewer: () => {
        attachments++;
        return Effect.die("unauthorized viewer must not attach");
      },
    });
    const handler = yield* Effect.acquireRelease(
      Effect.sync(() =>
        HttpRouter.toWebHandler(
          routeLayer.pipe(
            Layer.provide(Layer.succeed(ServerBrowser.ServerBrowser, browser)),
            Layer.provide(platformLayer),
            Layer.provideMerge(auth.layer),
          ),
          { disableLogger: true },
        ),
      ),
      ({ dispose }) => Effect.promise(dispose),
    );
    const response = yield* Effect.promise(() =>
      handler.handler(
        new Request("http://supaterm.test/api/preview-stream/ws?threadId=thread&tabId=tab", {
          headers: { upgrade: "websocket" },
        }),
      ),
    );
    expect(response.status).toBe(testCase.status);
    expect(attachments).toBe(0);
  }).pipe(Effect.scoped),
);

it.effect("serves a tab's download only to an authorized session", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = `${yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-download-" })}/file`;
    yield* fs.writeFileString(path, "report contents");
    const requests: Array<unknown> = [];
    const browser = ServerBrowser.ServerBrowser.of({
      clearProfile: () => Effect.void,
      profileReporter: Effect.succeed(() => Effect.void),
      openDownload: (input) =>
        Effect.sync(() => {
          requests.push(input);
          return input.downloadId === "download-1"
            ? Option.some({ path, fileName: "Q3 report.csv" })
            : Option.none();
        }),
      answerFileChooser: () => Effect.succeed(false),
      attachViewer: () => Effect.die("unused"),
    });
    const serve = (scopes: ReadonlyArray<AuthEnvironmentScope>, url: string) =>
      Effect.gen(function* () {
        const handler = yield* Effect.acquireRelease(
          Effect.sync(() =>
            HttpRouter.toWebHandler(
              routeLayer.pipe(
                Layer.provide(Layer.succeed(ServerBrowser.ServerBrowser, browser)),
                Layer.provide(platformLayer),
                Layer.provideMerge(makeAuth(scopes, undefined).layer),
              ),
              { disableLogger: true },
            ),
          ),
          ({ dispose }) => Effect.promise(dispose),
        );
        return yield* Effect.promise(() => handler.handler(new Request(url)));
      });
    const base = "http://supaterm.test/api/preview-stream/download?threadId=thread&tabId=tab";
    const denied = yield* serve([], `${base}&id=download-1`);
    expect(denied.status).toBe(403);
    expect(requests).toEqual([]);
    const response = yield* serve([AuthOrchestrationReadScope], `${base}&id=download-1`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="Q3 report.csv"',
    );
    expect(yield* Effect.promise(() => response.text())).toBe("report contents");
    const missing = yield* serve([AuthOrchestrationReadScope], `${base}&id=other`);
    expect(missing.status).toBe(404);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("passes uploaded files to the page's open picker and needs operate scope", () =>
  Effect.gen(function* () {
    const answers: Array<{ chooserId: string; files: Array<{ name: string; text: string }> }> = [];
    const browser = ServerBrowser.ServerBrowser.of({
      clearProfile: () => Effect.void,
      profileReporter: Effect.succeed(() => Effect.void),
      openDownload: () => Effect.succeedNone,
      answerFileChooser: (input) =>
        Effect.sync(() => {
          answers.push({
            chooserId: input.chooserId,
            files: input.files.map((file) => ({ name: file.name, text: file.buffer.toString() })),
          });
          return input.chooserId === "chooser-1";
        }),
      attachViewer: () => Effect.die("unused"),
    });
    const upload = (scopes: ReadonlyArray<AuthEnvironmentScope>, chooser: string) =>
      Effect.gen(function* () {
        const handler = yield* Effect.acquireRelease(
          Effect.sync(() =>
            HttpRouter.toWebHandler(
              routeLayer.pipe(
                Layer.provide(Layer.succeed(ServerBrowser.ServerBrowser, browser)),
                Layer.provide(platformLayer),
                Layer.provideMerge(makeAuth(scopes, undefined).layer),
              ),
              { disableLogger: true },
            ),
          ),
          ({ dispose }) => Effect.promise(dispose),
        );
        const body = new FormData();
        body.append("file", new File(["hello"], "notes.txt", { type: "text/plain" }));
        return yield* Effect.promise(() =>
          handler.handler(
            new Request(
              `http://supaterm.test/api/preview-stream/upload?threadId=thread&tabId=tab&chooser=${chooser}`,
              { method: "POST", body },
            ),
          ),
        );
      });
    expect((yield* upload([AuthOrchestrationReadScope], "chooser-1")).status).toBe(403);
    expect((yield* upload([AuthOrchestrationOperateScope], "chooser-1")).status).toBe(403);
    expect(answers).toEqual([]);
    expect((yield* upload([AuthPreviewOperateScope], "chooser-1")).status).toBe(204);
    expect(answers).toEqual([
      { chooserId: "chooser-1", files: [{ name: "notes.txt", text: "hello" }] },
    ]);
    expect((yield* upload([AuthPreviewOperateScope], "stale")).status).toBe(409);
  }).pipe(Effect.scoped),
);

const decodeHostSetup = Schema.decodeUnknownEffect(Schema.fromJsonString(PreviewStreamHostSetup));

it.effect.each([
  {
    error: new PreviewBrowserHost.PreviewBrowserSandboxError({
      setupCommand: "sudo supaterm browser setup",
    }),
    need: "sandbox",
  },
  {
    error: new PreviewBrowserHost.PreviewBrowserLibrariesError({
      setupCommand: "sudo supaterm browser setup",
      libraries: ["libnss3.so"],
    }),
    need: "libraries",
  },
])("tells viewers the command that sets up the host ($need)", ({ error, need }) =>
  Effect.gen(function* () {
    const browser = ServerBrowser.ServerBrowser.of({
      clearProfile: () => Effect.void,
      profileReporter: Effect.succeed(() => Effect.void),
      openDownload: () => Effect.succeedNone,
      answerFileChooser: () => Effect.succeed(false),
      attachViewer: () => Effect.fail(new ServerBrowser.ServerBrowserLaunchError({ cause: error })),
    });
    const services = yield* Layer.build(
      HttpRouter.serve(
        routeLayer.pipe(
          Layer.provide(Layer.succeed(ServerBrowser.ServerBrowser, browser)),
          Layer.provide(platformLayer),
        ),
        { disableListenLog: true },
      ).pipe(
        Layer.provideMerge(NodeHttpServer.layerTest),
        Layer.provide(makeAuth([AuthOrchestrationReadScope]).layer),
      ),
    );
    const server = Context.get(services, HttpServer.HttpServer);
    const origin = HttpServer.formatAddress(server.address).replace(/^http/, "ws");
    const closed = Promise.withResolvers<{ code: number; reason: string }>();
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const socket = new WebSocket(
          `${origin}/api/preview-stream/ws?threadId=thread&tabId=tab&wsTicket=one-use-ticket`,
        );
        socket.addEventListener("close", (event) =>
          closed.resolve({ code: event.code, reason: event.reason }),
        );
        return socket;
      }),
      (socket) => Effect.sync(() => socket.close()),
    );
    const { code, reason } = yield* Effect.promise(() => closed.promise);
    expect(code).toBe(PREVIEW_STREAM_HOST_SETUP_CLOSE_CODE);
    expect(yield* decodeHostSetup(reason)).toEqual({
      need,
      command: "sudo supaterm browser setup",
    });
  }).pipe(Effect.scoped),
);

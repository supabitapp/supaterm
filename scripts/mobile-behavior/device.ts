// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - drives agent-device and the Hermes inspector; the probe types its own JSON.
   
                                                                                                     
                                                                                             
                                                        
   
import * as NodeChildProcess from "node:child_process";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import { Socket } from "effect/socket";

import { poolError } from "../mobile-e2e/device.ts";

const InspectorTargets = Schema.Array(
  Schema.Struct({
    appId: Schema.String,
    deviceName: Schema.optional(Schema.String),
    webSocketDebuggerUrl: Schema.String,
  }),
);

export class DeviceError extends Schema.TaggedError<DeviceError>()("DeviceError", {
  message: Schema.String,
}) {}

export const APP_ID = "com.supaterm.mobile.dev";
export const SCHEME = "supaterm-dev";

export interface ProbeState {
  readonly route: {
    readonly name: string | null;
    readonly params: Record<string, unknown>;
    readonly columns: boolean;
  } | null;
  readonly feed: FeedSample | null;
  readonly composer: {
    readonly key: string | null;
    readonly draft: string | null;
    readonly drafts: Record<string, string>;
    readonly editors: ReadonlyArray<{ readonly value: string; readonly expanded: boolean }>;
    readonly error: string | null;
    readonly keyboard: boolean;
  };
  readonly floatingStatus: string | null;
  readonly environments: ReadonlyArray<string>;
                                                                  
  readonly threads: Record<string, string>;
  readonly homeList: ReadonlyArray<{
    readonly type: string;
    readonly threadId?: string;
    readonly status?: string;
    readonly pinned?: boolean;
    readonly count?: number;
    readonly expanded?: boolean;
  }> | null;
}

export interface FeedSample {
  readonly at?: number;
  readonly threadId: string;
  readonly ready: boolean;
  readonly scroll?: number;
  readonly viewport?: number;
  readonly content?: number;
  readonly fromEnd?: number;
  readonly atEnd?: boolean;
  readonly following?: boolean | null;
  readonly count?: number;
  readonly rows?: Record<string, number>;
}

export interface Recording {
  readonly js: ReadonlyArray<number>;
  readonly ui: ReadonlyArray<number>;
  readonly feed: ReadonlyArray<FeedSample>;
}

export interface AxNode {
  readonly type?: string;
  readonly label?: string;
  readonly value?: string;
  readonly kind?: string;
  readonly editable?: boolean;
  readonly enabled?: boolean;
  readonly rect?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

export interface DeviceOptions {
                                                                              
  readonly agentDevice: string;
  readonly targetArgs: ReadonlyArray<string>;
  readonly metro: string;
                                                                                                  
  readonly deviceName: string;
}

export function makeDevice(options: DeviceOptions) {
  const run = (args: ReadonlyArray<string>, timeoutMs = 90_000) =>
    Effect.try({
      try: () =>
        NodeChildProcess.execFileSync(options.agentDevice, [...args, ...options.targetArgs], {
          encoding: "utf8",
          timeout: timeoutMs,
          stdio: ["ignore", "pipe", "pipe"],
        }),
      catch: (cause) => {
                                                                                             
        const output = cause as { readonly stdout?: string; readonly stderr?: string };
        const reason = `${output.stderr ?? ""}${output.stdout ?? ""}`.trim() || String(cause);
        return new DeviceError({
          message: `agent-device ${args.join(" ")} failed: ${reason.slice(-400)}`,
        });
      },
    }).pipe(
                                                                            
      Effect.retry({
        times: 4,
        while: (error) => poolError(error.message),
        schedule: Schedule.spaced("5 seconds"),
      }),
      Effect.withSpan("device.agentDevice", { attributes: { command: args[0] } }),
    );

  const evaluate = Effect.fn("device.evaluate")(
    function* (expression: string) {
      const targets = yield* HttpClient.get(`${options.metro}/json/list`).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(InspectorTargets)),
        Effect.provide(FetchHttpClient.layer),
        Effect.mapError(
          () => new DeviceError({ message: `Metro at ${options.metro} did not answer.` }),
        ),
      );
                                                                                              
      const target = targets.findLast(
        (entry) =>
          entry.appId === APP_ID &&
          (!options.deviceName || entry.deviceName === options.deviceName),
      );
      if (!target)
        return yield* new DeviceError({
          message: `No app on ${options.deviceName} is attached to Metro.`,
        });
                                                                                   
      const socket = yield* Socket.makeWebSocket(target.webSocketDebuggerUrl, {
        headers: { origin: new URL(options.metro).origin },
        openTimeout: "10 seconds",
      });
      const writer = yield* socket.writer;
      const reader = yield* socket.reader;
      yield* writer.write(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true, awaitPromise: true },
        }),
      );
      while (true) {
        for (const frame of yield* reader.pull) {
          const reply = JSON.parse(
            typeof frame === "string" ? frame : new TextDecoder().decode(frame),
          ) as {
            id?: number;
            result?: { result?: { value?: unknown }; exceptionDetails?: unknown };
          };
          if (reply.id !== 1) continue;
          if (reply.result?.exceptionDetails)
            return yield* new DeviceError({
              message: `${expression} threw ${JSON.stringify(reply.result.exceptionDetails).slice(0, 400)}`,
            });
          return reply.result?.result?.value;
        }
      }
    },
    Effect.scoped,
    Effect.provide(NodeSocket.layerWebSocketConstructorWS),
    Effect.timeoutOrElse({
      duration: "20 seconds",
      orElse: () => Effect.fail(new DeviceError({ message: "The inspector did not answer." })),
    }),
    Effect.mapError((error) =>
      error._tag === "DeviceError"
        ? error
        : new DeviceError({ message: `Inspector: ${error.message}` }),
    ),
  );

  const state = evaluate("__supatermBehavior.state()").pipe(
    Effect.map((value) => JSON.parse(String(value)) as ProbeState),
  );

                                                                                              
  const waitFor = Effect.fn("device.waitFor")(function* (
    description: string,
    predicate: (state: ProbeState) => boolean,
    timeoutMs = 15_000,
  ) {
    const deadline = (yield* Clock.currentTimeMillis) + timeoutMs;
    let last: ProbeState | null = null;
    while ((yield* Clock.currentTimeMillis) < deadline) {
      last = yield* state.pipe(Effect.orElseSucceed(() => null));
      if (last && predicate(last)) return last;
      yield* Effect.sleep("250 millis");
    }
    return yield* new DeviceError({
      message: `Timed out waiting for ${description}. Last route: ${JSON.stringify(last?.route ?? null)}`,
    });
  });

  const nodes = run(["snapshot", "--json"]).pipe(
    Effect.map((out) => (JSON.parse(out) as { data: { nodes: ReadonlyArray<AxNode> } }).data.nodes),
  );

  const center = (node: AxNode) => ({
    x: Math.round(node.rect!.x + node.rect!.width / 2),
    y: Math.round(node.rect!.y + node.rect!.height / 2),
  });

  const screenSize = run([
    "screenshot",
    NodePath.join(NodeOS.tmpdir(), "supaterm-mobile-behavior-screen.png"),
    "--json",
  ]).pipe(
    Effect.map((out) => {
      const { data } = JSON.parse(out) as { data: { logicalWidth: number; logicalHeight: number } };
      return { width: data.logicalWidth, height: data.logicalHeight };
    }),
  );

  return {
    options,
    run,
    evaluate,
    state,
    waitFor,
    nodes,
    center,
    open: (path: string) =>
      evaluate(`__supatermBehavior.open(${JSON.stringify(`${SCHEME}://${path.replace(/^\//, "")}`)})`),
    openUrl: (url: string) => evaluate(`__supatermBehavior.open(${JSON.stringify(url)})`),
                                                                                                          
    reload: Effect.fn("device.reload")(function* (ready: (state: ProbeState) => boolean) {
      yield* evaluate("__supatermBehavior.reload()").pipe(Effect.ignore);
      yield* Effect.sleep("2 seconds");
      yield* waitFor("the thread list after reload", ready, 60_000);
      yield* evaluate(`__supatermBehavior.open(${JSON.stringify(`${SCHEME}://`)})`);
                                                                                                  
      const home = (value: ProbeState) => ready(value) && value.route?.name === "Home";
      const state = yield* waitFor("Home", home, 5_000).pipe(Effect.option);
      if (state._tag === "Some") return state.value;
      return yield* waitFor(
        "the split layout",
        (value) => ready(value) && value.route?.columns === true,
      );
    }),
    recordStart: (withFeed: boolean) => evaluate(`__supatermBehavior.recordStart(${withFeed})`),
    recordStop: evaluate("__supatermBehavior.recordStop()").pipe(
      Effect.map((value) => JSON.parse(String(value)) as Recording),
    ),
    press: (selector: string) => run(["press", selector]),
    pressAt: (x: number, y: number) => run(["press", String(x), String(y)]),
    longPress: (selector: string) => run(["longpress", selector, "800"]),
    type: (text: string) => run(["type", text]),
                                                                            
    swipe: (x: number, y1: number, y2: number) =>
      run(["swipe", String(x), String(y1), String(x), String(y2)]),
       
                                                                                                   
                                                                                         
       
    acceptOpenPrompt: run(["alert", "accept"], 60_000).pipe(
      Effect.catch(() =>
        screenSize.pipe(
          Effect.flatMap(({ width, height }) =>
            run(["press", String(Math.round(width / 2 + 76)), String(Math.round(height / 2 + 8))]),
          ),
        ),
      ),
    ),
    home: run(["home"]),
                                                                                                             
    fold: (pose: "closed" | "open") =>
      run(["fold", pose]).pipe(
        Effect.catch((error) =>
          screenSize.pipe(
            Effect.filterOrFail(
              ({ width, height }) => (pose === "closed") === width < height,
              () => error,
            ),
          ),
        ),
      ),
    back: run(["back"]),
  };
}

export type Device = ReturnType<typeof makeDevice>;

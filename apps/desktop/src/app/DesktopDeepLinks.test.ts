// @effect-diagnostics nodeBuiltinImport:off globalFetchInEffect:off - Hosted handoff test uses a real localhost listener without an OpenAI account.
import * as NodeHttp from "node:http";
import { codexAuthHandoffUrl, readCodexAuthDelivery } from "@supaterm/shared/codexAuthHandoff";
import { EnvironmentId, ProviderInstanceId } from "@supaterm/contracts";
import * as HostProcess from "@supaterm/shared/HostProcess";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import { vi } from "vite-plus/test";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopWebLinks from "./DesktopWebLinks.ts";
import * as DesktopOpenEvents from "./DesktopOpenEvents.ts";
import * as DesktopDeepLinks from "./DesktopDeepLinks.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

const ignoreWebLinks = DesktopWebLinks.DesktopWebLinks.of({
  receive: () => Effect.void,
  setRendererReady: () => Effect.void,
});

const defaultShell: ElectronShell.ElectronShell["Service"] = {
  openExternal: () => Effect.succeed(true),
  openSystemSettings: () => Effect.succeed(false),
  copyText: () => Effect.void,
};

const makeDesktopDeepLinksLayer = ({
  platform = "linux",
  isDevelopment = true,
  hasSingleInstanceLock = true,
  events = [],
  shell = defaultShell,
}: {
  readonly platform?: NodeJS.Platform;
  readonly isDevelopment?: boolean;
  readonly hasSingleInstanceLock?: boolean;
  readonly events?: string[];
  readonly shell?: ElectronShell.ElectronShell["Service"];
} = {}) => {
  const environment = DesktopEnvironment.DesktopEnvironment.of({
    platform,
    stateDir: "/tmp/supaterm-state",
    isDevelopment,
    appDataDirectory: "/tmp/app-data",
    path: { join: (...parts: ReadonlyArray<string>) => parts.join("/") },
  } as unknown as DesktopEnvironment.DesktopEnvironment["Service"]);

  const electronApp = {
    setPath: (name: string, value: string) =>
      Effect.sync(() => {
        events.push(`setPath:${name}:${value}`);
      }),
    requestSingleInstanceLock: Effect.sync(() => {
      events.push("requestSingleInstanceLock");
      return hasSingleInstanceLock;
    }),
    setAsDefaultProtocolClient: (protocol: string) =>
      Effect.sync(() => {
        events.push(`setAsDefaultProtocolClient:${protocol}`);
        return true;
      }),
    quit: Effect.sync(() => {
      events.push("quit");
    }),
  } as unknown as ElectronApp.ElectronApp["Service"];

  return DesktopDeepLinks.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(DesktopEnvironment.DesktopEnvironment, environment),
        Layer.succeed(ElectronApp.ElectronApp, electronApp),
        Layer.succeed(ElectronShell.ElectronShell, shell),
      ),
    ),
    Layer.provideMerge(Layer.succeed(DesktopEnvironment.DesktopEnvironment, environment)),
  );
};

const earlyEventsLayer = Layer.unwrap(
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    return DesktopOpenEvents.layer(environment.isDevelopment).pipe(
      Layer.provide(Layer.succeed(HostProcess.Platform, environment.platform)),
    );
  }),
);

const makeListenerApp = (listeners: Map<string, (...args: unknown[]) => void>) =>
  ({
    whenReady: Effect.void,
    on: (name: string, listener: (...args: unknown[]) => void) =>
      Effect.sync(() => {
        listeners.set(name, listener);
      }),
  }) as unknown as ElectronApp.ElectronApp["Service"];

describe("DesktopDeepLinks", () => {
  it.effect("sets userData before acquiring the single-instance lock", () => {
    const events: string[] = [];

    return Effect.gen(function* () {
      yield* Effect.scoped(Layer.build(makeDesktopDeepLinksLayer({ events })));

      assert.deepEqual(events, [
        "setPath:userData:/tmp/app-data/supaterm-dev",
        "requestSingleInstanceLock",
        "setAsDefaultProtocolClient:supaterm-dev",
      ]);
    });
  });

  it.effect("acquires the single-instance lock before registering the protocol on macOS", () => {
    const events: string[] = [];

    return Effect.gen(function* () {
      yield* Effect.scoped(
        Layer.build(
          makeDesktopDeepLinksLayer({
            platform: "darwin",
            isDevelopment: false,
            hasSingleInstanceLock: true,
            events,
          }),
        ),
      );

      assert.deepEqual(events, [
        "setPath:userData:/tmp/app-data/supaterm-v2",
        "requestSingleInstanceLock",
        "setAsDefaultProtocolClient:supaterm",
      ]);
    });
  });

  it.effect.each(["darwin", "linux", "win32"] as const)(
    "interrupts construction in a secondary instance on %s",
    (platform) => {
      const events: string[] = [];
      return Effect.gen(function* () {
        const exit = yield* Effect.exit(
          Effect.scoped(
            Layer.build(
              makeDesktopDeepLinksLayer({ platform, hasSingleInstanceLock: false, events }),
            ),
          ),
        );
        assert.isTrue(Exit.hasInterrupts(exit));
        assert.deepEqual(events, [
          "setPath:userData:/tmp/app-data/supaterm-dev",
          "requestSingleInstanceLock",
          "quit",
        ]);
      });
    },
  );

  it.effect("registers the open-url and second-instance handlers in the primary instance", () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();

    return Effect.gen(function* () {
      const deepLinks = yield* DesktopDeepLinks.DesktopDeepLinks;
      const exit = yield* Effect.exit(
        Effect.scoped(
          deepLinks.configure.pipe(
            Effect.provide(earlyEventsLayer),
            Effect.provideService(DesktopWebLinks.DesktopWebLinks, ignoreWebLinks),
          ),
        ),
      );

      assert.isTrue(Exit.isSuccess(exit));
      assert.deepEqual([...listeners.keys()], ["open-url", "open-file", "second-instance"]);
    }).pipe(
      Effect.provide(makeDesktopDeepLinksLayer()),
      Effect.provideService(ElectronApp.ElectronApp, makeListenerApp(listeners)),
      Effect.provideService(
        ElectronWindow.ElectronWindow,
        {} as ElectronWindow.ElectronWindow["Service"],
      ),
    );
  });

  it.effect("reveals the running desktop on a plain second launch", () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const revealed = Promise.withResolvers<unknown>();
    const window = { loadURL: vi.fn(async (_url: string) => undefined) };
    const electronWindow = {
      currentMainOrFirst: Effect.succeedSome(window),
      reveal: (target: unknown) => Effect.sync(() => revealed.resolve(target)),
    } as unknown as ElectronWindow.ElectronWindow["Service"];

    return Effect.gen(function* () {
      const deepLinks = yield* DesktopDeepLinks.DesktopDeepLinks;
      yield* deepLinks.configure.pipe(
        Effect.provide(earlyEventsLayer),
        Effect.provideService(DesktopWebLinks.DesktopWebLinks, ignoreWebLinks),
      );
      listeners.get("second-instance")!({}, ["supaterm", "--some-flag"]);

      assert.strictEqual(yield* Effect.promise(() => revealed.promise), window);
      assert.equal(window.loadURL.mock.calls.length, 0);
    }).pipe(
      Effect.scoped,
      Effect.provide(makeDesktopDeepLinksLayer()),
      Effect.provideService(ElectronApp.ElectronApp, makeListenerApp(listeners)),
      Effect.provideService(ElectronWindow.ElectronWindow, electronWindow),
    );
  });

  it.effect("provider auth deep links navigate and reveal the running desktop", () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const revealed = Promise.withResolvers<void>();
    const loadURL = vi.fn(async (_url: string) => undefined);
    const window = { loadURL };
    const electronWindow = {
      currentMainOrFirst: Effect.succeedSome(window),
      reveal: () => Effect.sync(() => revealed.resolve()),
    } as unknown as ElectronWindow.ElectronWindow["Service"];

    return Effect.gen(function* () {
      const deepLinks = yield* DesktopDeepLinks.DesktopDeepLinks;
      yield* deepLinks.configure.pipe(
        Effect.provide(earlyEventsLayer),
        Effect.provideService(DesktopWebLinks.DesktopWebLinks, ignoreWebLinks),
      );
      const event = { preventDefault: vi.fn() };
      listeners.get("open-url")!(event, "supaterm-dev://app/auth/callback?code=unrelated-code");
      listeners.get("open-url")!(event, "supaterm://app/welcome");
      assert.equal(loadURL.mock.calls.length, 0);
      assert.equal(event.preventDefault.mock.calls.length, 0);
      listeners.get("second-instance")!({}, [
        "supaterm",
        "supaterm-dev://app/settings/providers?instanceId=work&code=never-forward",
      ]);
      yield* Effect.promise(() => revealed.promise);
      assert.deepEqual(loadURL.mock.calls, [
        ["supaterm-dev://app/settings/providers?instanceId=work"],
      ]);
      listeners.get("open-url")!(event, "supaterm-dev://app/welcome#agents:machine-id");
      assert.equal(event.preventDefault.mock.calls.length, 1);
    }).pipe(
      Effect.scoped,
      Effect.provide(makeDesktopDeepLinksLayer()),
      Effect.provideService(ElectronApp.ElectronApp, makeListenerApp(listeners)),
      Effect.provideService(ElectronWindow.ElectronWindow, electronWindow),
    );
  });

  it.effect.each(["startup", "open-url"] as const)(
    "receives hosted web sign-in through the desktop %s handler",
    (entry) =>
      Effect.gen(function* () {
        const port = yield* Effect.promise(async () => {
          const server = NodeHttp.createServer();
          await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
          const address = server.address();
          if (!address || typeof address === "string") throw new Error("address");
          await new Promise<void>((resolve) => server.close(() => resolve()));
          return address.port;
        });
        const authorize = new URL("https://auth.openai.com/api/accounts/authorize");
        authorize.search = new URLSearchParams({
          client_id: "dynamic_agent_client",
          response_type: "code",
          redirect_uri: `http://127.0.0.1:${port}/auth/callback`,
          state: "a".repeat(43),
          code_challenge_method: "S256",
          code_challenge: "b".repeat(43),
        }).toString();
        const request = {
          authorizationUrl: authorize.toString(),
          returnUrl: "https://app.supaterm.com/welcome#agents:remote-one",
          environmentId: EnvironmentId.make("remote-one"),
          instanceId: ProviderInstanceId.make("work"),
          flowId: "flow-one",
        };
        const link = codexAuthHandoffUrl(request, true);
        const delivered = Promise.withResolvers<string>();
        const shell = ElectronShell.ElectronShell.of({
          openExternal: (value) =>
            Effect.promise(async () => {
              const url = new URL(String(value));
              const callback = new URL(url.searchParams.get("redirect_uri")!);
              callback.search = new URLSearchParams({
                state: url.searchParams.get("state")!,
                code: "test-code",
                client_id: "oaiapp_test",
              }).toString();
              const response = await fetch(callback, { redirect: "manual" });
              delivered.resolve(response.headers.get("location")!);
              return true;
            }),
          openSystemSettings: () => Effect.succeed(false),
          copyText: () => Effect.void,
        });
        const listeners = new Map<string, (...args: unknown[]) => void>();
        yield* Effect.gen(function* () {
          const deepLinks = yield* DesktopDeepLinks.DesktopDeepLinks;
          yield* deepLinks.configure.pipe(
            Effect.provide(earlyEventsLayer),
            Effect.provideService(DesktopWebLinks.DesktopWebLinks, ignoreWebLinks),
          );
          if (entry === "open-url") {
            const event = { preventDefault: vi.fn() };
            listeners.get("open-url")!(event, link);
            assert.strictEqual(event.preventDefault.mock.calls.length, 1);
          }
          const delivery = readCodexAuthDelivery(yield* Effect.promise(() => delivered.promise));
          assert.strictEqual(delivery?.environmentId, request.environmentId);
          assert.strictEqual(delivery?.instanceId, request.instanceId);
          assert.strictEqual(delivery?.flowId, request.flowId);
          assert.strictEqual(delivery?.returnUrl, request.returnUrl);
        }).pipe(
          Effect.provide(makeDesktopDeepLinksLayer({ shell })),
          Effect.provideService(
            HostProcess.Arguments,
            entry === "startup" ? ["supaterm", link] : ["supaterm"],
          ),
          Effect.provideService(ElectronApp.ElectronApp, makeListenerApp(listeners)),
          Effect.provideService(
            ElectronWindow.ElectronWindow,
            {} as ElectronWindow.ElectronWindow["Service"],
          ),
        );
      }).pipe(Effect.scoped),
  );
});

it.effect("queues web, file, prompt and thread links and leaves other schemes alone", () =>
  Effect.gen(function* () {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const received: string[] = [];
    const webLinks = DesktopWebLinks.DesktopWebLinks.of({
      receive: (url) =>
        Effect.sync(() => {
          received.push(url);
        }),
      setRendererReady: () => Effect.void,
    });
    yield* Effect.gen(function* () {
      const deepLinks = yield* DesktopDeepLinks.DesktopDeepLinks;
      yield* deepLinks.configure.pipe(Effect.provide(earlyEventsLayer));
      for (const url of [
        "https://example.com/page",
        "http://localhost:3000",
        "supaterm://new?prompt=hi",
        "supaterm://threads/env/thread",
        "mailto:hi@example.com",
      ]) {
        const event = { preventDefault: vi.fn() };
        listeners.get("open-url")!(event, url);
        assert.equal(event.preventDefault.mock.calls.length, url.startsWith("mailto:") ? 0 : 1);
      }
      const event = { preventDefault: vi.fn() };
      listeners.get("open-file")!(event, "/tmp/a page.html");
      yield* Effect.yieldNow;
      assert.deepEqual(received, [
        "https://example.com/start",
        "https://example.com/page",
        "http://localhost:3000",
        "supaterm://new?prompt=hi",
        "supaterm://threads/env/thread",
        "file:///tmp/a%20page.html",
      ]);
      assert.equal(event.preventDefault.mock.calls.length, 1);
    }).pipe(
      Effect.provide(makeDesktopDeepLinksLayer({ platform: "darwin" })),
      Effect.provideService(ElectronApp.ElectronApp, makeListenerApp(listeners)),
      Effect.provideService(
        ElectronWindow.ElectronWindow,
        {} as ElectronWindow.ElectronWindow["Service"],
      ),
      Effect.provideService(DesktopWebLinks.DesktopWebLinks, webLinks),
      Effect.provideService(HostProcess.Arguments, ["supaterm", "https://example.com/start"]),
    );
  }).pipe(Effect.scoped),
);

it.effect.each(["startup", "open-url", "second-instance"] as const)(
  "delivers a pairing link from %s to the renderer coordinator",
  (entry) =>
    Effect.gen(function* () {
      const listeners = new Map<string, (...args: unknown[]) => void>();
      const delivered = Promise.withResolvers<string>();
      const link = "supaterm://pair?pairingUrl=https%3A%2F%2Fserver.test%2F%23token%3Dpair";
      const webLinks = DesktopWebLinks.DesktopWebLinks.of({
        receive: (url) =>
          Effect.sync(() => {
            delivered.resolve(url);
          }),
        setRendererReady: () => Effect.void,
      });
      yield* Effect.gen(function* () {
        const deepLinks = yield* DesktopDeepLinks.DesktopDeepLinks;
        yield* deepLinks.configure.pipe(Effect.provide(earlyEventsLayer));
        if (entry === "open-url") {
          const event = { preventDefault: vi.fn() };
          listeners.get("open-url")!(event, link);
          assert.equal(event.preventDefault.mock.calls.length, 1);
        } else if (entry === "second-instance") {
          listeners.get("second-instance")!({}, ["supaterm", link]);
        }
        assert.equal(yield* Effect.promise(() => delivered.promise), link);
      }).pipe(
        Effect.provide(makeDesktopDeepLinksLayer()),
        Effect.provideService(ElectronApp.ElectronApp, makeListenerApp(listeners)),
        Effect.provideService(
          ElectronWindow.ElectronWindow,
          {} as ElectronWindow.ElectronWindow["Service"],
        ),
        Effect.provideService(DesktopWebLinks.DesktopWebLinks, webLinks),
        Effect.provideService(
          HostProcess.Arguments,
          entry === "startup" ? ["supaterm", link] : ["supaterm"],
        ),
      );
    }).pipe(Effect.scoped),
);

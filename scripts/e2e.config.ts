// Scenarios: e2e tests that run against the real dev stack. See docs/internals/testing.md#scenarios.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { mobile, type MobilePlatform } from "@e2e-dev/mobile";
import { web } from "@e2e-dev/web";
import * as HostProcess from "@supaterm/shared/HostProcess";
import type { E2EConfig } from "e2e";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

// e2e loads this module for its values, so the paths are resolved once, here.
const resolved = await Effect.gen(function* () {
  const path = yield* Path.Path;
  const env = yield* HostProcess.Environment;
  const scripts = yield* path.fromFileUrl(new URL(".", import.meta.url));
  return {
    env,
    node: yield* HostProcess.ExecutablePath,
    /** The checkout whose app runs. `prove-scenario.ts` points it at a base or head worktree. */
    appDir: path.resolve(scripts, env.SUPATERM_SCENARIO_APP_DIR ?? ".."),
    home: path.resolve(scripts, "../.supaterm/scenarios"),
    startApp: path.join(scripts, "scenarios/start-app.ts"),
    // e2e gives the app only PATH, HOME and the temp directory. A scenario that needs more names
    // it here: exact names or prefixes ending in `*`, separated by commas.
    inheritEnv: (env.SUPATERM_SCENARIO_INHERIT_ENV ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== ""),
  };
}).pipe(Effect.provide(NodeServices.layer), Effect.runPromise);

export const APP_DIR = resolved.appDir;
/** Supaterm homes only scenarios use, recreated on every run. `.supaterm` is gitignored. */
export const SCENARIO_HOME = resolved.home;
const startApp = resolved.startApp;
/**
 * The one address e2e opens the web app at and the app is told to bind. Never `localhost`: the
 * runner and the app can resolve that name to different addresses.
 */
const LOOPBACK = "127.0.0.1";
/** The development build of the mobile app, on both platforms. */
export const NATIVE_APP_ID = "com.supaterm.mobile.dev";

/**
 * Where each native target's server and Metro listen. A mobile target has no `app.url`, so e2e
 * cannot pick these ports, and each platform gets its own so both can run in one invocation.
 * `deviceHost` is this machine as the device sees it: the Android emulator reaches it at 10.0.2.2.
 */
export const NATIVE_APPS = {
  ios: {
    home: `${SCENARIO_HOME}-ios`,
    deviceHost: LOOPBACK,
    serverPort: 13_990,
    metroPort: 8_190,
    device: resolved.env.SUPATERM_SCENARIO_IOS_DEVICE,
  },
  android: {
    home: `${SCENARIO_HOME}-android`,
    deviceHost: "10.0.2.2",
    serverPort: 13_991,
    metroPort: 8_191,
    device: resolved.env.SUPATERM_SCENARIO_ANDROID_DEVICE,
  },
} satisfies Record<MobilePlatform, unknown>;

/**
 * A native target runs only on the device its variable names: a run reinstalls the dev app and, on
 * iOS, resets the simulator's keychain, so it must never pick a device someone else uses.
 */
const nativeTargets = (Object.keys(NATIVE_APPS) as Array<MobilePlatform>).flatMap((platform) => {
  const native = NATIVE_APPS[platform];
  if (native.device === undefined) return [];
  return {
    name: platform,
    engine: mobile({ platform, device: native.device, session: `supaterm-scenarios-${platform}` }),
    app: {
      bundleId: NATIVE_APP_ID,
      // Metro starts after the server listens, so it answering means both are up.
      readyUrl: `http://${LOOPBACK}:${native.metroPort}/status`,
      command: {
        executable: resolved.node,
        args: [
          startApp,
          platform,
          native.home,
          String(native.serverPort),
          String(native.metroPort),
          native.deviceHost,
        ],
        cwd: APP_DIR,
        inheritEnv: resolved.inheritEnv,
        // A dev client missing from the cache is built before the server starts.
        startupTimeout: 1_800_000,
        log: `.e2e/${platform}-app.log`,
      },
    },
  };
});

export default {
  tests: "scenarios/**/*.e2e.ts",
  targets: [
    {
      name: "web",
      engine: web({ viewport: { width: 1280, height: 800 } }),
      app: {
        url: `http://${LOOPBACK}:0`,
        // Lets a scenario put an image on the clipboard for a real keyboard paste.
        permissions: { "clipboard-write": "grant" },
        // Vite answers before the server does; this path is proxied to the server.
        readyUrl: `http://${LOOPBACK}:{port}/.well-known/supaterm/environment`,
        command: {
          executable: resolved.node,
          args: [startApp, "web", SCENARIO_HOME, LOOPBACK, "{port}"],
          cwd: APP_DIR,
          inheritEnv: resolved.inheritEnv,
          startupTimeout: 300_000,
          log: ".e2e/app.log",
        },
      },
    },
    ...nativeTargets,
  ],
  // One server holds every test's state, and a dev stack is heavy.
  workers: 1,
  timeout: 300_000,
  assertionTimeout: 15_000,
  video: "on",
  trace: "on",
  reporters: ["list", "markdown"],
} satisfies E2EConfig;

// `test` for native scenarios: e2e's mobile test plus `supaterm`, which seeds state like the web
// one and opens the dev client paired with the scenario's server, on iOS or Android.
import { test as base, type MobilePlatform } from "@e2e-dev/mobile";
import * as HostProcess from "@supaterm/shared/HostProcess";
import { expect } from "e2e";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { APP_DIR, NATIVE_APPS } from "../e2e.config.ts";
import { run, ScenarioError } from "./shell.ts";
import { ANDROID_ABI } from "./start-app.ts";
import { makeState, runPromise, type SupatermState } from "./supaterm.ts";

export const APP_ID = "com.supaterm.mobile.dev";
const SCHEME = "supaterm-dev";

export interface MobileSupaterm extends SupatermState {
  readonly platform: MobilePlatform;
  /** The server's origin as this machine reaches it. */
  readonly origin: string;
  /** Installs the dev client if the device lacks it, loads it from Metro, and pairs it. */
  readonly open: () => Promise<void>;
  /** Opens a `supaterm-dev://` path in the dev client. */
  readonly openLink: (path: string) => Promise<void>;
}

const decodePrepared = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ fingerprint: Schema.String })),
);

/** The dev client built for this checkout's native code, from the shared cache. */
const devClientPath = Effect.fn("scenario.devClientPath")(function* (platform: MobilePlatform) {
  const path = yield* Path.Path;
  const abi = platform === "android" ? ["--abi", ANDROID_ABI] : [];
  const prepared = yield* run(
    yield* HostProcess.ExecutablePath,
    ["scripts/mobile-native-client.ts", "ensure", platform, "--prepare", ...abi],
    { cwd: APP_DIR },
  );
  const { fingerprint } = yield* decodePrepared(prepared.stdout.trim().split("\n").at(-1) ?? "");
  const artifacts = path.join(
    yield* HostProcess.HomeDirectory,
    ".cache/supaterm/native-clients/artifacts",
  );
  return platform === "ios"
    ? path.join(artifacts, "ios/development", fingerprint, "SupatermDev.app")
    : path.join(artifacts, `android/development-${ANDROID_ABI}`, fingerprint, "app-debug.apk");
});

// Each run starts the app with no data, since the server it was paired with is gone, and then
// keeps the install and the pairing for the rest of the run.
const installed = new Set<MobilePlatform>();
const paired = new Set<MobilePlatform>();

export const test = base.extend<{ supaterm: MobileSupaterm }>({
  supaterm: async ({ app, device, screen }, use) => {
    const platform = device.unstable_raw.platform;
    const native = NATIVE_APPS[platform];
    const { state, cli, cleanup } = makeState(native.home, {
      SUPATERM_PORT: String(native.serverPort),
    });
    const pairingUrl = Effect.gen(function* () {
      const origin = `http://${native.deviceHost}:${native.serverPort}`;
      const pairing = ["auth", "pairing", "create", "--ttl", "15m", "--label", "scenario"];
      const created = yield* cli([...pairing, "--base-url", origin]);
      const url = /Pair URL:\s*(\S+)/.exec(`${created.stdout}\n${created.stderr}`)?.[1];
      return url ?? (yield* new ScenarioError({ message: "The server printed no pairing URL." }));
    });
    // iOS asks before a link opens another app.
    const openLink = async (url: string) => {
      await device.openLink(url, { app: APP_ID });
      if (platform === "ios") await device.alert("accept").catch(() => {});
    };
    await use({
      ...state,
      platform,
      origin: `http://127.0.0.1:${native.serverPort}`,
      openLink: (path) => openLink(`${SCHEME}://${path}`),
      open: async () => {
        if (!installed.has(platform)) {
          // Saved environments live in the iOS keychain, which outlives the app.
          if (platform === "ios") await device.clearKeychain();
          await device.installApp(await runPromise(devClientPath(platform)));
          await app.clearState();
          installed.add(platform);
        }
        const metro = encodeURIComponent(`http://${native.deviceHost}:${native.metroPort}`);
        await openLink(
          `${SCHEME}://expo-development-client/?url=${metro}&disableOnboarding=1&disableFab=1&disableAutoLaunch=1`,
        );
        // The first load bundles the app; the pairing link only works once it is on screen.
        if (paired.has(platform)) return;
        await expect(screen.getByRole("button", "Add environment")).toBeVisible({
          timeout: 240_000,
        });
        const query = new URLSearchParams({
          pairingUrl: await runPromise(pairingUrl),
          autoConnect: "1",
        });
        await openLink(`${SCHEME}://connections/new?${query.toString()}`);
        // Connected once the empty state gives way to the environment's threads.
        await expect(screen.getByRole("button", "Add environment")).toBeHidden({ timeout: 60_000 });
        paired.add(platform);
      },
    });
    await runPromise(cleanup);
  },
});

/** Test option for an iOS-only scenario: the other targets skip it. */
export const IOS = { platforms: ["ios"] } as const;
/** Test option for a scenario of the native app on both platforms. */
export const NATIVE = { platforms: ["ios", "android"] } as const;

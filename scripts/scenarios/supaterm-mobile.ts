// `test` for native scenarios: e2e's mobile test plus `supaterm`, which seeds state like the web
// one and opens the dev client paired with the scenario's server, on iOS or Android.
import { test as base, type MobilePlatform } from "@e2e-dev/mobile";
import * as Effect from "effect/Effect";

import { APP_DIR, NATIVE_APP_ID, NATIVE_APPS } from "../e2e.config.ts";
import { ScenarioError } from "./shell.ts";
import { prepareDevClient } from "./start-app.ts";
import { makeState, runPromise, type SupatermState } from "./supaterm.ts";

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
      await device.openLink(url, { app: NATIVE_APP_ID });
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
          await device.installApp(await runPromise(prepareDevClient(APP_DIR, platform)));
          await app.clearState();
          installed.add(platform);
        }
        const metro = encodeURIComponent(`http://${native.deviceHost}:${native.metroPort}`);
        await openLink(
          `${SCHEME}://expo-development-client/?url=${metro}&disableOnboarding=1&disableFab=1&disableAutoLaunch=1`,
        );
        // The first load bundles the app; the pairing link only works once it is on screen.
        // Setup waits with waitFor, not expect: a proof reads only a failed expectation as the bug.
        if (paired.has(platform)) return;
        const addEnvironment = screen.getByRole("button", "Add environment");
        await addEnvironment.waitFor({ timeout: 240_000 });
        const query = new URLSearchParams({
          pairingUrl: await runPromise(pairingUrl),
          autoConnect: "1",
        });
        await openLink(`${SCHEME}://connections/new?${query.toString()}`);
        // Paired once the empty state goes, connected once no placeholder or row says Connecting:
        // the app ignores taps on a thread whose environment is still connecting.
        await addEnvironment.waitFor({ state: "hidden", timeout: 60_000 });
        await screen
          .getByText("Connecting to environment")
          .waitFor({ state: "hidden", timeout: 60_000 });
        await screen
          .getByText("Connecting", { exact: true })
          .waitFor({ state: "hidden", timeout: 60_000 });
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

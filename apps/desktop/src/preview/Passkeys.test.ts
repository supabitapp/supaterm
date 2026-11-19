import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { vi } from "vite-plus/test";
import type { Session } from "electron";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as Passkeys from "./Passkeys.ts";

function makeNative(
  reply: () => Promise<{ readonly response: number }> = async () => ({ response: 0 }),
) {
  const configured: Array<Electron.ConfigureWebAuthnOptions> = [];
  const dialogs: Array<Electron.MessageBoxOptions> = [];
  const native: Passkeys.PasskeysNative = {
    configureWebAuthn: (options) => {
      configured.push(options);
    },
    showMessageBox: (_details, options) => {
      dialogs.push(options);
      return reply();
    },
  };
  return { native, configured, dialogs };
}

const buildService = (
  native: Passkeys.PasskeysNative,
  platform: NodeJS.Platform,
  isPackaged: boolean,
  metadata: string,
) =>
  Passkeys.makeWith(native).pipe(
    Effect.provideService(DesktopEnvironment.DesktopEnvironment, {
      platform,
      isPackaged,
      appRoot: "/app",
      path: { join: (...parts: string[]) => parts.join("/") },
    } as DesktopEnvironment.DesktopEnvironment["Service"]),
    Effect.provide(FileSystem.layerNoop({ readFileString: () => Effect.succeed(metadata) })),
  );
const metadata = JSON.stringify({
  supatermWebAuthn: { touchIdKeychainAccessGroup: "TEAMID1234.com.supaterm.desktop.webauthn" },
});

it.effect.each([
  { platform: "darwin", packaged: false, json: metadata },
  { platform: "win32", packaged: true, json: metadata },
  { platform: "darwin", packaged: true, json: "{}" },
  { platform: "darwin", packaged: true, json: "invalid JSON" },
] as const)(
  "does not enable Touch ID without signed macOS metadata ($platform, $packaged)",
  ({ platform, packaged, json }) =>
    Effect.gen(function* () {
      const fake = makeNative();
      const service = yield* buildService(fake.native, platform, packaged, json);
      yield* service.configure;
      const on = vi.fn();
      service.installSessionHandlers({ on } as unknown as Session);
      assert.equal(fake.configured.length, 0);
      assert.equal(on.mock.calls.length, 0);
    }),
);

it.effect.each(["single", "choose", "cancel", "error", "empty"] as const)(
  "settles the %s account choice once",
  (choice) =>
    Effect.gen(function* () {
      const fake = makeNative(() =>
        choice === "error"
          ? Promise.reject(new Error("closed"))
          : Promise.resolve({ response: choice === "cancel" ? 2 : 1 }),
      );
      const service = yield* buildService(fake.native, "darwin", true, metadata);
      yield* service.configure;
      assert.deepEqual(fake.configured, [
        { touchID: { keychainAccessGroup: "TEAMID1234.com.supaterm.desktop.webauthn" } },
      ]);
      const on = vi.fn();
      const session = { on } as unknown as Session;
      service.installSessionHandlers(session);
      service.installSessionHandlers(session);
      assert.equal(on.mock.calls.length, 1);
      const selected = Promise.withResolvers<string | undefined>();
      const callback = vi.fn((value?: string) => selected.resolve(value));
      const accounts =
        choice === "empty"
          ? []
          : choice === "single"
            ? [{ credentialId: "one", name: "me" }]
            : [
                { credentialId: "one", name: "me" },
                { credentialId: "two", name: "work", displayName: "Work" },
              ];
      on.mock.calls[0]![1]({}, { accounts, relyingPartyId: "example.com", frame: null }, callback);
      assert.equal(
        yield* Effect.promise(() => selected.promise),
        choice === "single" ? "one" : choice === "choose" ? "two" : undefined,
      );
      assert.equal(callback.mock.calls.length, 1);
      if (choice === "choose")
        assert.deepEqual(fake.dialogs[0]?.buttons, ["me", "Work (work)", "Cancel"]);
    }),
);

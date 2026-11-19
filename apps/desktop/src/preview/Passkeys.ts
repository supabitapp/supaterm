import { app, BrowserWindow, dialog, webContents } from "electron";
import type { Session } from "electron";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";

const PackageMetadata = Schema.Struct({
  supatermWebAuthn: Schema.optional(Schema.Struct({ touchIdKeychainAccessGroup: Schema.String })),
});
const decodeMetadata = Schema.decodeEffect(Schema.fromJsonString(PackageMetadata));

export class PreviewPasskeys extends Context.Service<
  PreviewPasskeys,
  {
    readonly configure: Effect.Effect<void>;
    readonly installSessionHandlers: (session: Session) => void;
  }
>()("@supaterm/desktop/preview/Passkeys/PreviewPasskeys") {}

const accountLabel = (account: Electron.WebAuthnAccount) =>
  account.displayName && account.name && account.displayName !== account.name
    ? `${account.displayName} (${account.name})`
    : (account.name ?? account.displayName ?? "Unnamed passkey");

export type PasskeysNative = {
  readonly configureWebAuthn: (options: Electron.ConfigureWebAuthnOptions) => void;
  readonly showMessageBox: (
    details: Electron.SelectWebauthnAccountDetails,
    options: Electron.MessageBoxOptions,
  ) => Promise<{ readonly response: number }>;
};

const electronPasskeysNative: PasskeysNative = {
  configureWebAuthn: (options) => app.configureWebAuthn(options),
  showMessageBox: (details, options) => {
    const contents = details.frame ? webContents.fromFrame(details.frame) : undefined;
    const owner = contents?.hostWebContents ?? contents;
    const parent = owner ? BrowserWindow.fromWebContents(owner) : null;
    return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
  },
};

const chooseAccount = async (
  native: PasskeysNative,
  details: Electron.SelectWebauthnAccountDetails,
) => {
  if (details.accounts.length === 1) return details.accounts[0]?.credentialId;
  if (details.accounts.length === 0) return undefined;
  const options: Electron.MessageBoxOptions = {
    type: "none",
    message: "Choose a passkey",
    detail: details.relyingPartyId,
    buttons: [...details.accounts.map(accountLabel), "Cancel"],
    cancelId: details.accounts.length,
    defaultId: 0,
    noLink: true,
  };
  const { response } = await native.showMessageBox(details, options);
  return details.accounts[response]?.credentialId;
};

export const makeWith = Effect.fn("PreviewPasskeys.make")(function* (native: PasskeysNative) {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fs = yield* FileSystem.FileSystem;
  const keychainAccessGroup =
    environment.platform === "darwin" && environment.isPackaged
      ? yield* fs.readFileString(environment.path.join(environment.appRoot, "package.json")).pipe(
          Effect.flatMap(decodeMetadata),
          Effect.map((metadata) => metadata.supatermWebAuthn?.touchIdKeychainAccessGroup),
          Effect.orElseSucceed(() => undefined),
        )
      : undefined;
  const sessions = new WeakSet<Session>();
  return PreviewPasskeys.of({
    configure:
      keychainAccessGroup === undefined
        ? Effect.void
        : Effect.try(() => native.configureWebAuthn({ touchID: { keychainAccessGroup } })).pipe(
            Effect.catch((error) =>
              Effect.logWarning("Could not configure Touch ID passkeys", { cause: error }),
            ),
            Effect.withSpan("desktop.previewPasskeys.configure"),
          ),
    installSessionHandlers: (session) => {
      if (keychainAccessGroup === undefined || sessions.has(session)) return;
      sessions.add(session);
      session.on("select-webauthn-account", (_event, details, callback) => {
        void chooseAccount(native, details).then(
          (credentialId) => callback(credentialId),
          () => callback(),
        );
      });
    },
  });
});

/** @public */
export const make = makeWith(electronPasskeysNative);

export const layer = Layer.effect(PreviewPasskeys, make);

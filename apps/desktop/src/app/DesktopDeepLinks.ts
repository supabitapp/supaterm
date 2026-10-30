// @effect-diagnostics nodeBuiltinImport:off - OS file-open events carry paths that Node converts to file URLs.
import * as NodeURL from "node:url";
import { promptLinkAppPath } from "@supaterm/shared/promptLinks";
import * as DesktopWebLinks from "./DesktopWebLinks.ts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";

import { codexAuthDeliveryUrl, readCodexAuthHandoff } from "@supaterm/shared/codexAuthHandoff";
import { receiveCodexAuthCallback, CodexAuthCallbackError } from "./CodexAuthCallback.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import { providerAuthReturnUrl } from "@supaterm/shared/providerAuthReturnUrl";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronProtocol from "../electron/ElectronProtocol.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopUserData from "./DesktopUserData.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopOpenEvents from "./DesktopOpenEvents.ts";

export class DesktopDeepLinks extends Context.Service<
  DesktopDeepLinks,
  {
    readonly configure: Effect.Effect<
      void,
      never,
      | ElectronApp.ElectronApp
      | ElectronWindow.ElectronWindow
      | DesktopWebLinks.DesktopWebLinks
      | Scope.Scope
      | DesktopOpenEvents.DesktopOpenEvents
    >;
  }
>()("@supaterm/desktop/app/DesktopDeepLinks") {}

/** @public */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const electronApp = yield* ElectronApp.ElectronApp;
  const shell = yield* ElectronShell.ElectronShell;

  yield* electronApp.setPath("userData", DesktopUserData.userDataPath(environment));

  const isPrimaryInstance = yield* electronApp.requestSingleInstanceLock;
  if (isPrimaryInstance) {
    yield* electronApp.setAsDefaultProtocolClient(
      ElectronProtocol.getDesktopScheme(environment.isDevelopment),
    );
  } else {
    yield* electronApp.quit;
    return yield* Effect.interrupt;
  }

  return DesktopDeepLinks.of({
    configure: Effect.gen(function* () {
      const electronApp = yield* ElectronApp.ElectronApp;
      const electronWindow = yield* ElectronWindow.ElectronWindow;
      const webLinks = yield* DesktopWebLinks.DesktopWebLinks;
      const context = yield* Effect.context<ElectronWindow.ElectronWindow>();
      const runPromise = Effect.runPromiseWith(context);

      const startProviderAuthHandoff = (value: string | undefined) => {
        if (!value) return false;
        const request = readCodexAuthHandoff(value, environment.isDevelopment);
        if (!request) return false;
        void runPromise(
          Effect.gen(function* () {
            yield* electronApp.whenReady;
            yield* Effect.tryPromise({
              try: () =>
                receiveCodexAuthCallback(
                  request.authorizationUrl,
                  (url) => runPromise(shell.openExternal(url)),
                  (callbackUrl) => codexAuthDeliveryUrl(request, callbackUrl),
                ),
              catch: () =>
                new CodexAuthCallbackError({
                  detail:
                    "Could not receive hosted web ChatGPT sign-in. Retry or use the redirect URL in the web app.",
                }),
            });
          }).pipe(
            Effect.catch(() => Effect.logWarning("Could not complete ChatGPT desktop handoff.")),
          ),
        );
        return true;
      };
      const resumeProviderAuth = (value: string | undefined) => {
        const destination = providerAuthReturnUrl(value);
        const expectedOrigin = `${ElectronProtocol.getDesktopScheme(environment.isDevelopment)}://app`;
        if (!destination?.startsWith(`${expectedOrigin}/`)) return false;
        void runPromise(
          Effect.gen(function* () {
            const mainWindow = yield* electronWindow.currentMainOrFirst;
            if (Option.isNone(mainWindow)) return;
            yield* Effect.promise(() => mainWindow.value.loadURL(destination));
            yield* electronWindow.reveal(mainWindow.value);
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Could not return to provider setup", cause),
            ),
          ),
        );
        return true;
      };
      const openAppLink = (value: string | undefined) => {
        if (!value || promptLinkAppPath(value) === null) return false;
        void runPromise(webLinks.receive(value));
        return true;
      };
      const openWebLink = (value: string | undefined) => {
        if (!value || environment.platform !== "darwin" || !DesktopWebLinks.isWebLink(value))
          return false;
        void runPromise(webLinks.receive(value));
        return true;
      };
      const args = yield* HostProcess.Arguments;
      for (const value of args) {
        if (startProviderAuthHandoff(value) || openAppLink(value)) continue;
        openWebLink(value);
      }
      const openEvents = yield* DesktopOpenEvents.DesktopOpenEvents;
      yield* openEvents.subscribe((event) => {
        if (event.type === "url") {
          if (
            startProviderAuthHandoff(event.url) ||
            resumeProviderAuth(event.url) ||
            openAppLink(event.url)
          )
            return;
          openWebLink(event.url);
          return;
        }
        if (event.type === "file") {
          void runPromise(webLinks.receive(NodeURL.pathToFileURL(event.path).href));
          return;
        }
        if (
          event.argv.some(
            (value) =>
              startProviderAuthHandoff(value) ||
              resumeProviderAuth(value) ||
              openAppLink(value) ||
              openWebLink(value),
          )
        )
          return;
        void runPromise(
          Effect.gen(function* () {
            const mainWindow = yield* electronWindow.currentMainOrFirst;
            if (Option.isSome(mainWindow)) yield* electronWindow.reveal(mainWindow.value);
          }),
        );
      });
    }).pipe(Effect.withSpan("desktop.deepLinks.configure")),
  });
});

export const layer = Layer.effect(DesktopDeepLinks, make);

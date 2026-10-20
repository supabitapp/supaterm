import * as CodexMicroTransport from "@supaterm/codex-micro/transport";
import { DEFAULT_CLIENT_SETTINGS } from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { makeComponentLogger } from "../app/DesktopObservability.ts";
import * as DesktopIpc from "../ipc/DesktopIpc.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import * as CodexMicro from "./CodexMicro.ts";
import * as CodexMicroIpc from "./CodexMicroIpc.ts";
import * as MacInputMonitoring from "./MacInputMonitoring.ts";

const { logWarning } = makeComponentLogger("desktop-codex-micro");

// Written by `build-desktop-artifact --without-codex-micro`, which also leaves node-hid out.
const PackageFeatures = Schema.Struct({
  supatermFeatures: Schema.optional(Schema.Struct({ codexMicro: Schema.optional(Schema.Boolean) })),
});
const decodePackageFeatures = Schema.decodeEffect(Schema.fromJsonString(PackageFeatures));

export const includedInBuild = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  if (!environment.isPackaged) return true;
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readFileString(environment.path.join(environment.appRoot, "package.json")).pipe(
    Effect.flatMap(decodePackageFeatures),
    Effect.map((metadata) => metadata.supatermFeatures?.codexMicro !== false),
    Effect.orElseSucceed(() => true),
  );
});

export const layer = Layer.unwrap(
  includedInBuild.pipe(
    Effect.map((available) =>
      available
        ? CodexMicro.layer.pipe(
            Layer.provide(CodexMicroTransport.layer),
            Layer.provide(MacInputMonitoring.layer),
          )
        : CodexMicro.layerUnavailable,
    ),
  ),
);

export const install = Effect.gen(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  const codexMicro = yield* CodexMicro.CodexMicro;
  yield* ipc.handleSync(CodexMicroIpc.getAvailability);
  if (!codexMicro.available) return;
  yield* CodexMicroIpc.installEventForwarding();
  yield* ipc.handle(CodexMicroIpc.getState);
  yield* ipc.handle(CodexMicroIpc.setLighting);
  yield* ipc.handle(CodexMicroIpc.openInputMonitoringSettings);
  yield* (yield* DesktopClientSettings.DesktopClientSettings).get.pipe(
    Effect.map(
      Option.match({
        onNone: () => DEFAULT_CLIENT_SETTINGS.codexMicro,
        onSome: (settings) => settings.codexMicro,
      }),
    ),
    Effect.flatMap(codexMicro.configure),
    Effect.catchTags({
      DesktopClientSettingsReadError: (error) =>
        logWarning("could not read client settings", { operation: error.operation }),
    }),
  );
}).pipe(Effect.withSpan("desktop.codexMicro.install"));

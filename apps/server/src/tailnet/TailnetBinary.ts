import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";

export type TailnetBinaryResolution =
  | { readonly _tag: "Found"; readonly path: string }
  | { readonly _tag: "Missing" }
  | { readonly _tag: "Unsupported" };

export class TailnetBinary extends Context.Service<
  TailnetBinary,
  { readonly resolve: Effect.Effect<TailnetBinaryResolution> }
>()("supaterm/tailnet/TailnetBinary") {}

function tailnetBinaryName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "supaterm-tailnet.exe" : "supaterm-tailnet";
}

function platformKey(platform: NodeJS.Platform, architecture: string): string | undefined {
  if (platform !== "darwin" && platform !== "linux" && platform !== "win32") return undefined;
  if (architecture !== "arm64" && architecture !== "x64") return undefined;
  return `${platform}-${architecture}`;
}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  const architecture = yield* HostProcess.Architecture;
  const environment = yield* HostProcess.Environment;
  const name = tailnetBinaryName(platform);
  const key = platformKey(platform, architecture);
  const overrides = [environment.SUPATERM_TAILNET_PATH, config.tailnetPath].filter(
    (candidate): candidate is string => Boolean(candidate),
  );
  const bundled =
    key === undefined
      ? []
      : [
          path.resolve(import.meta.dirname, "tailnet", key, name),
          path.resolve(import.meta.dirname, "tailnet", name),
          path.resolve(import.meta.dirname, "../tailnet", name),
          path.resolve(import.meta.dirname, "../../../../native/tailnet/bin", name),
          path.resolve(import.meta.dirname, "../../../native/tailnet/bin", name),
        ];
  const candidates = [...overrides, ...bundled];

  const isExecutableFile = (candidate: string) =>
    fileSystem
      .stat(candidate)
      .pipe(
        Effect.option,
        Effect.map(
          Option.exists(
            (stat) => stat.type === "File" && (platform === "win32" || (stat.mode & 0o111) !== 0),
          ),
        ),
      );

  const resolve: Effect.Effect<TailnetBinaryResolution> =
    candidates.length === 0
      ? Effect.succeed({ _tag: "Unsupported" })
      : Effect.gen(function* () {
          for (const candidate of candidates) {
            if (yield* isExecutableFile(candidate)) return { _tag: "Found", path: candidate };
          }
          return { _tag: "Missing" };
        });

  return TailnetBinary.of({ resolve });
});

export const layer = Layer.effect(TailnetBinary, make);

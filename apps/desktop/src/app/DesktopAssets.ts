import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";

export interface DesktopIconPaths {
  readonly ico: Option.Option<string>;
  readonly icns: Option.Option<string>;
  readonly png: Option.Option<string>;
  /** The macOS icon with its bolt switched off, for the Dock's launch animation. */
  readonly unlitPng: Option.Option<string>;
}

export class DesktopAssetProbeError extends Schema.TaggedError<DesktopAssetProbeError>()(
  "DesktopAssetProbeError",
  {
    fileName: Schema.String,
    candidatePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to probe desktop asset "${this.fileName}" at ${this.candidatePath}.`;
  }
}

export class DesktopAssets extends Context.Service<
  DesktopAssets,
  {
    readonly iconPaths: Effect.Effect<DesktopIconPaths>;
    readonly resolveResourcePath: (
      fileName: string,
    ) => Effect.Effect<Option.Option<string>, DesktopAssetProbeError>;
  }
>()("@supaterm/desktop/app/DesktopAssets") {}

const resolveResourcePath = Effect.fn("desktop.assets.resolveResourcePath")(function* (
  fileName: string,
): Effect.fn.Return<
  Option.Option<string>,
  DesktopAssetProbeError,
  FileSystem.FileSystem | DesktopEnvironment.DesktopEnvironment
> {
  const fileSystem = yield* FileSystem.FileSystem;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const candidates = environment.resolveResourcePathCandidates(fileName);
  for (const candidate of candidates) {
    const exists = yield* fileSystem
      .exists(candidate)
      .pipe(
        Effect.mapError(
          (cause) => new DesktopAssetProbeError({ fileName, candidatePath: candidate, cause }),
        ),
      );
    if (exists) {
      return Option.some(candidate);
    }
  }
  return Option.none<string>();
});

const sourceTreeIconFileNames = {
  dev: {
    ico: "blueprint-windows.ico",
    macPng: "blueprint-macos-1024.png",
    macUnlitPng: "blueprint-macos-unlit-512.png",
    universalPng: "blueprint-universal-1024.png",
  },
  prod: {
    ico: "supaterm-black-windows.ico",
    macPng: "black-macos-1024.png",
    macUnlitPng: "black-macos-unlit-512.png",
    universalPng: "black-universal-1024.png",
  },
} as const;

const resourceIconFileNames = {
  ico: "icon.ico",
  icns: "icon.icns",
  png: "icon.png",
  unlitPng: "icon-unlit.png",
} satisfies Record<keyof DesktopIconPaths, string>;

function resolveSourceTreeIconPath(
  environment: DesktopEnvironment.DesktopEnvironment["Service"],
  icon: keyof DesktopIconPaths,
): string | undefined {
  if (environment.isPackaged || icon === "icns") return undefined;
  if (icon === "unlitPng" && environment.platform !== "darwin") return undefined;
  const brand = environment.isDevelopment ? "dev" : "prod";
  const fileNames = sourceTreeIconFileNames[brand];
  const fileName =
    icon === "ico"
      ? fileNames.ico
      : icon === "unlitPng"
        ? fileNames.macUnlitPng
        : environment.platform === "darwin"
          ? fileNames.macPng
          : fileNames.universalPng;
  return environment.path.join(environment.rootDir, "assets", brand, fileName);
}

const resolveIconPath = Effect.fn("desktop.assets.resolveIconPath")(function* (
  icon: keyof DesktopIconPaths,
): Effect.fn.Return<
  Option.Option<string>,
  DesktopAssetProbeError,
  FileSystem.FileSystem | DesktopEnvironment.DesktopEnvironment
> {
  const fileSystem = yield* FileSystem.FileSystem;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const sourceTreeIconPath = resolveSourceTreeIconPath(environment, icon);
  if (sourceTreeIconPath !== undefined) {
    const sourceTreeIconExists = yield* fileSystem.exists(sourceTreeIconPath).pipe(
      Effect.mapError(
        (cause) =>
          new DesktopAssetProbeError({
            fileName: resourceIconFileNames[icon],
            candidatePath: sourceTreeIconPath,
            cause,
          }),
      ),
    );
    if (sourceTreeIconExists) {
      return Option.some(sourceTreeIconPath);
    }
  }

  return yield* resolveResourcePath(resourceIconFileNames[icon]);
});

/** @public */
export const make = Effect.gen(function* () {
  const context = yield* Effect.context<
    FileSystem.FileSystem | DesktopEnvironment.DesktopEnvironment
  >();
  const [ico, icns, png, unlitPng] = yield* Effect.all(
    [
      resolveIconPath("ico"),
      resolveIconPath("icns"),
      resolveIconPath("png"),
      resolveIconPath("unlitPng"),
    ] as const,
    { concurrency: "unbounded" },
  );
  const iconPaths = { ico, icns, png, unlitPng } satisfies DesktopIconPaths;

  return DesktopAssets.of({
    iconPaths: Effect.succeed(iconPaths),
    resolveResourcePath: Effect.fn("desktop.assets.resolveResourcePath.scoped")(
      function* (fileName) {
        return yield* resolveResourcePath(fileName).pipe(Effect.provide(context));
      },
    ),
  });
});

export const layer = Layer.effect(DesktopAssets, make);

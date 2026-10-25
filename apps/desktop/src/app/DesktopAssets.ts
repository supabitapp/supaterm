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
}

export type IconAppearance = "light" | "dark";

/** The macOS icon with its bolt lit and with it switched off, for the Dock's launch animation. */
export interface LaunchIconPaths {
  readonly lit: string;
  readonly unlit: string;
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
    readonly launchIconPaths: (
      appearance: IconAppearance,
    ) => Effect.Effect<Option.Option<LaunchIconPaths>, DesktopAssetProbeError>;
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
    universalPng: "blueprint-universal-1024.png",
  },
  prod: {
    ico: "supaterm-black-windows.ico",
    macPng: "black-macos-1024.png",
    universalPng: "black-universal-1024.png",
  },
} as const;

function resolveSourceTreeIconPath(
  environment: DesktopEnvironment.DesktopEnvironment["Service"],
  ext: keyof DesktopIconPaths,
): string | undefined {
  if (environment.isPackaged || ext === "icns") return undefined;
  const brand = environment.isDevelopment ? "dev" : "prod";
  const fileNames = sourceTreeIconFileNames[brand];
  const fileName =
    ext === "ico"
      ? fileNames.ico
      : environment.platform === "darwin"
        ? fileNames.macPng
        : fileNames.universalPng;
  return environment.path.join(environment.rootDir, "assets", brand, fileName);
}

const resolveAssetPath = Effect.fn("desktop.assets.resolveAssetPath")(function* (
  sourceTreePath: string | undefined,
  resourceFileName: string,
): Effect.fn.Return<
  Option.Option<string>,
  DesktopAssetProbeError,
  FileSystem.FileSystem | DesktopEnvironment.DesktopEnvironment
> {
  const fileSystem = yield* FileSystem.FileSystem;
  if (sourceTreePath !== undefined) {
    const sourceTreeExists = yield* fileSystem.exists(sourceTreePath).pipe(
      Effect.mapError(
        (cause) =>
          new DesktopAssetProbeError({
            fileName: resourceFileName,
            candidatePath: sourceTreePath,
            cause,
          }),
      ),
    );
    if (sourceTreeExists) {
      return Option.some(sourceTreePath);
    }
  }

  return yield* resolveResourcePath(resourceFileName);
});

const resolveIconPath = Effect.fn("desktop.assets.resolveIconPath")(function* (
  ext: keyof DesktopIconPaths,
) {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  return yield* resolveAssetPath(resolveSourceTreeIconPath(environment, ext), `icon.${ext}`);
});

// Brands differ only in the bolt, so one unlit render per appearance serves all of them.
const launchIconFileNames = {
  light: {
    resource: { lit: "icon.png", unlit: "icon-unlit.png" },
    sourceTree: {
      dev: "blueprint-macos-1024.png",
      prod: "black-macos-1024.png",
      unlit: "black-macos-unlit-1024.png",
    },
  },
  dark: {
    resource: { lit: "icon-dark.png", unlit: "icon-unlit-dark.png" },
    sourceTree: {
      dev: "blueprint-macos-dark-512.png",
      prod: "black-macos-dark-512.png",
      unlit: "black-macos-unlit-dark-512.png",
    },
  },
} as const;

const resolveLaunchIconPaths = Effect.fn("desktop.assets.resolveLaunchIconPaths")(function* (
  appearance: IconAppearance,
) {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const { resource, sourceTree } = launchIconFileNames[appearance];
  const brand = environment.isDevelopment ? "dev" : "prod";
  const inSourceTree = (brandDirectory: string, fileName: string) =>
    environment.isPackaged
      ? undefined
      : environment.path.join(environment.rootDir, "assets", brandDirectory, fileName);
  const lit = yield* resolveAssetPath(inSourceTree(brand, sourceTree[brand]), resource.lit);
  const unlit = yield* resolveAssetPath(inSourceTree("prod", sourceTree.unlit), resource.unlit);
  return Option.zipWith(lit, unlit, (lit, unlit) => ({ lit, unlit }));
});

/** @public */
export const make = Effect.gen(function* () {
  const context = yield* Effect.context<
    FileSystem.FileSystem | DesktopEnvironment.DesktopEnvironment
  >();
  const [ico, icns, png] = yield* Effect.all(
    [resolveIconPath("ico"), resolveIconPath("icns"), resolveIconPath("png")] as const,
    { concurrency: "unbounded" },
  );
  const iconPaths = { ico, icns, png } satisfies DesktopIconPaths;

  return DesktopAssets.of({
    iconPaths: Effect.succeed(iconPaths),
    launchIconPaths: Effect.fn("desktop.assets.launchIconPaths.scoped")(function* (appearance) {
      return yield* resolveLaunchIconPaths(appearance).pipe(Effect.provide(context));
    }),
    resolveResourcePath: Effect.fn("desktop.assets.resolveResourcePath.scoped")(
      function* (fileName) {
        return yield* resolveResourcePath(fileName).pipe(Effect.provide(context));
      },
    ),
  });
});

export const layer = Layer.effect(DesktopAssets, make);

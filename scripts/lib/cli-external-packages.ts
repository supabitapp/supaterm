/**
 * Two consumers derive from this list, and they must never disagree:
 *
 * - apps/server/vite.config.ts decides what stays external to the bundle.
 * - scripts/build-desktop-artifact.ts selects the runtime dependency roots for
 *   the Windows server sidecar.
 *
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

/**
 * An external package is loaded from the real filesystem, so its own `require`
 * also resolves from the real filesystem; a dependency that was bundled away
 * exists only inside the emitted bundle and is unreachable there.
 */
export const CLI_RUNTIME_EXTERNAL_PREFIXES = [
  // Cursor ships computed Webpack imports and platform helper packages.
  "@cursor/sdk",
  // Playwright reads package.json and browsers.json beside its runtime modules.
  "playwright-core",
  "node-pty",
  "ffi-rs",
  "@yuuang/",
  "@ff-labs/",
  "@napi-rs/keyring",
  "node-gyp-build",
  "node-addon-api",
  "bufferutil",
  "utf-8-validate",
] as const;

// These are Cursor's disk-backed dependency closure. Match package boundaries
// so "zod" does not also externalize unrelated packages such as zod-to-json-schema.
const CURSOR_RUNTIME_DEPENDENCIES = [
  "@bufbuild/protobuf",
  "@connectrpc/connect",
  "@connectrpc/connect-node",
  "@connectrpc/connect-web",
  "@statsig/js-client",
  "@statsig/client-core",
  "zod",
  "undici",
  "@fastify/busboy",
] as const;

export function isRuntimeExternalCliDependency(id: string): boolean {
  return (
    CLI_RUNTIME_EXTERNAL_PREFIXES.some((prefix) => id.startsWith(prefix)) ||
    CURSOR_RUNTIME_DEPENDENCIES.some((name) => id === name || id.startsWith(`${name}/`))
  );
}

/**
 * This has to be wired to the bundler's `neverBundle`, not just to
 * `alwaysBundle`. `alwaysBundle` only forces packages IN — returning false from
 * it means "no opinion", and the default then applies: a declared dependency
 * stays external, but a transitive one gets bundled.
 */
export function isExternalCliDependency(id: string): boolean {
  return isRuntimeExternalCliDependency(id);
}

export function shouldBundleCliDependency(id: string): boolean {
  if (id.startsWith("node:")) return false;
  return !isExternalCliDependency(id);
}

export function selectCliRuntimeExternalDependencies(
  dependencies: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(dependencies).filter(([name]) => isRuntimeExternalCliDependency(name)),
  );
}

/**
 * `regionCount` is reported so the caller can tell "nothing was inlined" apart
 * from "the marker format changed and this scan no longer sees anything".
 */
export function findInlinedExternalPackages(source: string): {
  readonly regionCount: number;
  readonly inlined: ReadonlyArray<string>;
  readonly inlinedPackages: ReadonlyArray<string>;
} {
  // Rolldown marks each inlined module with a `//#region <path>` comment.
  const regionPattern = /\/\/#region\s+(\S+)/g;
  const packagePattern = /node_modules\/((?:@[^/\s]+\/)?[^/\s]+)\//g;

  let regionCount = 0;
  const inlined = new Set<string>();
  const inlinedPackages = new Set<string>();
  for (const region of source.matchAll(regionPattern)) {
    regionCount += 1;
    const regionPath = region[1] ?? "";
    for (const candidate of regionPath.matchAll(packagePattern)) {
      const name = candidate[1];
      if (name === undefined || name === ".pnpm") continue;
      inlinedPackages.add(name);
      if (isExternalCliDependency(name)) inlined.add(name);
    }
  }

  return {
    regionCount,
    inlined: [...inlined].sort(),
    inlinedPackages: [...inlinedPackages].sort(),
  };
}

const PackageManifest = Schema.Struct({
  name: Schema.String,
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  devDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  optionalDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  peerDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
const decodeManifest = Schema.decodeEffect(Schema.fromJsonString(PackageManifest));

// Follow Node's directory lookup without importing package code or requiring
// package.json to be public in the package's exports map.
const resolveDependencyDirectory = Effect.fn("resolveDependencyDirectory")(function* (
  fromDirectory: string,
  name: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  let directory = fromDirectory;
  for (;;) {
    const candidate = path.join(directory, "node_modules", name);
    if (yield* fs.exists(path.join(candidate, "package.json"))) {
      return yield* fs.realPath(candidate);
    }
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
});

/** Inventory the installed graph, retaining different versions and peer contexts. */
export const readInstalledPackages = Effect.fn("readInstalledPackages")(function* (
  packageDirectories: ReadonlyArray<string>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const installed = new Map<string, typeof PackageManifest.Type>();
  const roots = new Set(
    yield* Effect.forEach(packageDirectories, (directory) => fs.realPath(directory)),
  );
  const pending = [...roots];
  for (const directory of pending) {
    if (installed.has(directory)) continue;
    const manifest = yield* fs
      .readFileString(path.join(directory, "package.json"))
      .pipe(Effect.flatMap(decodeManifest));
    installed.set(directory, manifest);
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
      // Dependency packages do not install their own development dependencies.
      ...(roots.has(directory) ? manifest.devDependencies : undefined),
    };
    for (const name of Object.keys(dependencies)) {
      const dependency = yield* resolveDependencyDirectory(directory, name);
      // Optional/platform-specific packages and optional peers may be absent.
      if (dependency !== null && !installed.has(dependency)) pending.push(dependency);
    }
  }
  return installed;
});

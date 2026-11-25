import { EnvironmentThemeFile } from "@supaterm/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@supaterm/shared/HostProcess";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as ServerConfig from "./config.ts";
import * as EnvironmentTheme from "./environmentTheme.ts";
import { symlinksSupported } from "@supaterm/shared/testing/symlinks";

const encodeThemeFile = Schema.encodeSync(Schema.fromJsonString(EnvironmentThemeFile));

const NIGHTFALL_THEME: EnvironmentThemeFile = {
  name: "Nightfall",
  appearance: "dark",
  canvas: "#1a1b26",
  accent: "#7aa2f7",
};

const SHARED_THEME: EnvironmentThemeFile = {
  version: 1,
  name: "Shared Light",
  appearance: "light",
  colors: { canvas: "#eff1f5", accent: "#1e66f5" },
};

const withEnvironmentThemes = <A, E>(
  seeds: Readonly<Record<string, string>>,
  body: Effect.Effect<
    A,
    E,
    | EnvironmentTheme.EnvironmentThemeService
    | ServerConfig.ServerConfig
    | FileSystem.FileSystem
    | Path.Path
    | Scope.Scope
  >,
  options: {
    wrapFileSystem?: (fs: FileSystem.FileSystem) => FileSystem.FileSystem;
  } = {},
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-environment-theme-" });
    const themesDir = path.join(baseDir, "userdata", "themes");
    yield* fs.makeDirectory(themesDir, { recursive: true });
    for (const [filename, contents] of Object.entries(seeds)) {
      yield* fs.writeFileString(path.join(themesDir, filename), contents);
    }

    return yield* body.pipe(
      Effect.provide(
        EnvironmentTheme.layer.pipe(
          Layer.provide(Layer.succeed(FileSystem.FileSystem, options.wrapFileSystem?.(fs) ?? fs)),
          Layer.provideMerge(ServerConfig.layerTest(process.cwd(), baseDir)),
        ),
      ),
    );
  }).pipe(Effect.provide(NodeServices.layer));

const currentThemes = Effect.gen(function* () {
  const environmentTheme = yield* EnvironmentTheme.EnvironmentThemeService;
  return yield* environmentTheme.current;
});

describe("environment theme", () => {
  it.effect("follows the directory rather than the set read at start", () =>
    withEnvironmentThemes(
      { "nightfall.json": encodeThemeFile(NIGHTFALL_THEME) },
      Effect.gen(function* () {
        const { environmentThemesDir } = yield* ServerConfig.ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        yield* fs.writeFileString(
          path.join(environmentThemesDir, "shared-light.json"),
          encodeThemeFile(SHARED_THEME),
        );
        assert.equal((yield* currentThemes).length, 2);

        yield* fs.remove(path.join(environmentThemesDir, "nightfall.json"));
        assert.deepEqual(
          (yield* currentThemes).map((theme) => theme.id),
          ["shared-light"],
        );
      }),
    ),
  );

  it.effect("never replays a set older than the snapshot it started from", () =>
    withEnvironmentThemes(
      { "nightfall.json": encodeThemeFile(NIGHTFALL_THEME) },
      Effect.gen(function* () {
        const environmentTheme = yield* EnvironmentTheme.EnvironmentThemeService;
        const { environmentThemesDir } = yield* ServerConfig.ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        yield* fs.writeFileString(
          path.join(environmentThemesDir, "shared-light.json"),
          encodeThemeFile(SHARED_THEME),
        );
        const seen = yield* Queue.unbounded<ReadonlyArray<{ readonly id: string }>>();
        yield* Stream.runForEach(environmentTheme.streamChanges, (themes) =>
          Queue.offer(seen, themes),
        ).pipe(Effect.forkScoped);
        assert.deepEqual(
          (yield* Queue.take(seen)).map((theme) => theme.id),
          ["nightfall", "shared-light"],
        );
        yield* fs.remove(path.join(environmentThemesDir, "nightfall.json"));
        yield* currentThemes;
        assert.deepEqual(
          (yield* Queue.take(seen)).map((theme) => theme.id),
          ["shared-light"],
        );
      }),
    ),
  );

  it.live("publishes restored themes to subscribers that saw the directory disappear", () =>
    withEnvironmentThemes(
      { "nightfall.json": encodeThemeFile(NIGHTFALL_THEME) },
      Effect.gen(function* () {
        const service = yield* EnvironmentTheme.EnvironmentThemeService;
        const { environmentThemesDir } = yield* ServerConfig.ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const restored = path.join(path.dirname(environmentThemesDir), "themes-restored");
        yield* fs.makeDirectory(restored);
        yield* fs.writeFileString(
          path.join(restored, "shared-light.json"),
          encodeThemeFile(SHARED_THEME),
        );

        const snapshots = yield* service.streamChanges.pipe(
          Stream.map((themes) => themes.map((theme) => theme.name)),
          Stream.toQueue({ capacity: "unbounded" }),
        );
        assert.deepEqual(yield* Queue.take(snapshots), ["Nightfall"]);

        yield* fs.rename(
          environmentThemesDir,
          path.join(path.dirname(restored), "themes-previous"),
        );
        assert.deepEqual(yield* Queue.take(snapshots), []);

        yield* fs.rename(restored, environmentThemesDir);
        assert.deepEqual(yield* Queue.take(snapshots), ["Shared Light"]);

        yield* fs.writeFileString(
          path.join(environmentThemesDir, "nightfall.json"),
          encodeThemeFile(NIGHTFALL_THEME),
        );
        assert.deepEqual(yield* Queue.take(snapshots), ["Nightfall", "Shared Light"]);
      }),
    ),
  );

  it.live.skipIf(!symlinksSupported)(
    "publishes edits after the target of a symlinked themes directory is restored",
    () =>
      withEnvironmentThemes(
        { "nightfall.json": encodeThemeFile(NIGHTFALL_THEME) },
        Effect.gen(function* () {
          const service = yield* EnvironmentTheme.EnvironmentThemeService;
          const { environmentThemesDir } = yield* ServerConfig.ServerConfig;
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const outside = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-linked-themes-" });
          const targetParent = path.join(outside, "active-parent");
          const target = path.join(targetParent, "active");
          const restored = path.join(outside, "restored");
          yield* fs.makeDirectory(target, { recursive: true });
          yield* fs.makeDirectory(restored);
          let linkTarget = target;
          if ((yield* HostProcess.Platform) !== "win32") {
            const userdata = path.dirname(environmentThemesDir);
            const anchor = path.join(targetParent, "anchor");
            yield* fs.makeDirectory(anchor);
            yield* fs.makeDirectory(path.join(userdata, "active"));
            yield* fs.symlink(anchor, path.join(userdata, "alias"));
            linkTarget = "alias/../active";
          }
          yield* fs.writeFileString(
            path.join(target, "shared-light.json"),
            encodeThemeFile(SHARED_THEME),
          );
          yield* fs.writeFileString(
            path.join(restored, "nightfall.json"),
            encodeThemeFile(NIGHTFALL_THEME),
          );

          const snapshots = yield* service.streamChanges.pipe(
            Stream.map((themes) => themes.map((theme) => theme.name)),
            Stream.toQueue({ capacity: "unbounded" }),
          );
          assert.deepEqual(yield* Queue.take(snapshots), ["Nightfall"]);

          yield* fs.rename(environmentThemesDir, path.join(outside, "original"));
          yield* fs.symlink(linkTarget, environmentThemesDir);
          assert.deepEqual(
            yield* Stream.fromQueue(snapshots).pipe(
              Stream.filter((names) => names.length > 0),
              Stream.runHead,
              Effect.map((names) => names.valueOrUndefined),
            ),
            ["Shared Light"],
          );

          yield* fs.writeFileString(
            path.join(target, "nightfall.json"),
            encodeThemeFile(NIGHTFALL_THEME),
          );
          assert.deepEqual(yield* Queue.take(snapshots), ["Nightfall", "Shared Light"]);

          yield* fs.rename(target, path.join(outside, "previous"));
          assert.deepEqual(yield* Queue.take(snapshots), []);
          yield* fs.rename(restored, target);
          assert.deepEqual(yield* Queue.take(snapshots), ["Nightfall"]);

          yield* fs.writeFileString(
            path.join(target, "shared-light.json"),
            encodeThemeFile(SHARED_THEME),
          );
          assert.deepEqual(yield* Queue.take(snapshots), ["Nightfall", "Shared Light"]);

          const restoredParent = path.join(outside, "restored-parent");
          const restoredTarget = path.join(restoredParent, "active");
          yield* fs.makeDirectory(restoredTarget, { recursive: true });
          yield* fs.makeDirectory(path.join(restoredParent, "anchor"));
          yield* fs.writeFileString(
            path.join(restoredTarget, "shared-light.json"),
            encodeThemeFile(SHARED_THEME),
          );

          yield* fs.rename(targetParent, path.join(outside, "previous-parent"));
          assert.deepEqual(yield* Queue.take(snapshots), []);
          yield* fs.rename(restoredParent, targetParent);
          assert.deepEqual(yield* Queue.take(snapshots), ["Shared Light"]);

          yield* fs.writeFileString(
            path.join(target, "nightfall.json"),
            encodeThemeFile(NIGHTFALL_THEME),
          );
          assert.deepEqual(yield* Queue.take(snapshots), ["Nightfall", "Shared Light"]);
        }),
      ),
  );

  it.live.skipIf(!symlinksSupported)(
    "publishes later edits after a linked theme directory's grandparent is restored",
    () =>
      withEnvironmentThemes(
        { "nightfall.json": encodeThemeFile(NIGHTFALL_THEME) },
        Effect.gen(function* () {
          const service = yield* EnvironmentTheme.EnvironmentThemeService;
          const { environmentThemesDir } = yield* ServerConfig.ServerConfig;
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const fixture = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-linked-themes-" });
          const active = path.join(fixture, "active");
          const restored = path.join(fixture, "restored");
          const target = path.join(active, "shared", "themes");
          const restoredTarget = path.join(restored, "shared", "themes");
          for (const directory of [target, restoredTarget]) {
            yield* fs.makeDirectory(directory, { recursive: true });
            yield* fs.writeFileString(
              path.join(directory, "shared-light.json"),
              encodeThemeFile(SHARED_THEME),
            );
          }

          const snapshots = yield* service.streamChanges.pipe(
            Stream.map((themes) => themes.map((theme) => theme.name)),
            Stream.toQueue({ capacity: "unbounded" }),
          );
          assert.deepEqual(yield* Queue.take(snapshots), ["Nightfall"]);
          yield* fs.rename(environmentThemesDir, path.join(fixture, "original"));
          yield* fs.symlink(target, environmentThemesDir);
          assert.deepEqual(
            yield* Stream.fromQueue(snapshots).pipe(
              Stream.filter((names) => names.length > 0),
              Stream.runHead,
              Effect.map((names) => names.valueOrUndefined),
            ),
            ["Shared Light"],
          );

          yield* fs.rename(active, path.join(fixture, "active-previous"));
          assert.deepEqual(yield* Queue.take(snapshots), []);
          yield* fs.rename(restored, active);
          assert.deepEqual(yield* Queue.take(snapshots), ["Shared Light"]);

          yield* fs.writeFileString(
            path.join(fixture, "active-previous", "shared", "themes", "nightfall.json"),
            encodeThemeFile(NIGHTFALL_THEME),
          );
          yield* fs.writeFileString(
            path.join(target, "shared-light.json"),
            encodeThemeFile({ ...SHARED_THEME, name: "Edited Shared Light" }),
          );
          assert.deepEqual(yield* Queue.take(snapshots), ["Edited Shared Light"]);
        }),
      ),
  );

  // With probes held, only a watch event can publish; macOS FSEvents can drop it under load.
  it.live.skipIf(!symlinksSupported || HostProcess.Platform.defaultValue() === "darwin")(
    "publishes themes when a linked theme tree vanishes after listing and returns between probes",
    () =>
      Effect.gen(function* () {
        const resumeProbes = yield* Deferred.make<void>();
        let linkedEntry: string | undefined;
        let moveAfterListing: Effect.Effect<void> | undefined;
        let holdProbes = false;
        yield* withEnvironmentThemes(
          { "nightfall.json": encodeThemeFile(NIGHTFALL_THEME) },
          Effect.gen(function* () {
            const service = yield* EnvironmentTheme.EnvironmentThemeService;
            const { environmentThemesDir } = yield* ServerConfig.ServerConfig;
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const fixture = yield* fs.makeTempDirectoryScoped({
              prefix: "supaterm-linked-themes-",
            });
            const active = path.join(fixture, "active");
            const previous = path.join(fixture, "previous");
            const target = path.join(active, "shared", "themes");
            yield* fs.makeDirectory(target, { recursive: true });
            yield* fs.writeFileString(
              path.join(target, "shared-light.json"),
              encodeThemeFile(SHARED_THEME),
            );

            const snapshots = yield* service.streamChanges.pipe(
              Stream.map((themes) => themes.map((theme) => theme.name)),
              Stream.toQueue({ capacity: "unbounded" }),
            );
            assert.deepEqual(yield* Queue.take(snapshots), ["Nightfall"]);
            linkedEntry = environmentThemesDir;
            yield* fs.rename(environmentThemesDir, path.join(fixture, "original"));
            yield* fs.symlink(target, environmentThemesDir);
            assert.deepEqual(
              (yield* Stream.fromQueue(snapshots).pipe(
                Stream.filter((names) => names.length > 0),
                Stream.runHead,
              )).valueOrUndefined,
              ["Shared Light"],
            );

            // The next listing succeeds, then the tree moves before its files are opened.
            moveAfterListing = Effect.orDie(fs.rename(active, previous));
            holdProbes = true;
            yield* fs.writeFileString(
              path.join(target, "nightfall.json"),
              encodeThemeFile(NIGHTFALL_THEME),
            );
            assert.deepEqual(yield* Queue.take(snapshots), []);
            yield* fs.rename(previous, active);
            yield* Deferred.succeed(resumeProbes, undefined);
            assert.deepEqual(yield* Queue.take(snapshots), ["Nightfall", "Shared Light"]);
          }),
          {
            wrapFileSystem: (fs) =>
              FileSystem.FileSystem.of({
                ...fs,
                readDirectory: (directory, options) =>
                  fs.readDirectory(directory, options).pipe(
                    Effect.tap(() => {
                      const move = directory === linkedEntry ? moveAfterListing : undefined;
                      if (move === undefined) return Effect.void;
                      moveAfterListing = undefined;
                      return move;
                    }),
                  ),
                stat: (entry) =>
                  Effect.suspend(() =>
                    entry === linkedEntry && holdProbes
                      ? Deferred.await(resumeProbes).pipe(Effect.andThen(fs.stat(entry)))
                      : fs.stat(entry),
                  ),
              }),
          },
        );
      }),
  );

  // Needs inotify's event when a watched directory's ancestor moves; macOS FSEvents send none.
  it.live.skipIf(!symlinksSupported || HostProcess.Platform.defaultValue() === "darwin")(
    "publishes themes when a linked theme directory's original grandparent is restored between probes",
    () =>
      Effect.gen(function* () {
        const resumeProbes = yield* Deferred.make<void>();
        let linkedEntry: string | undefined;
        let holdProbes = false;
        yield* withEnvironmentThemes(
          { "nightfall.json": encodeThemeFile(NIGHTFALL_THEME) },
          Effect.gen(function* () {
            const service = yield* EnvironmentTheme.EnvironmentThemeService;
            const { environmentThemesDir } = yield* ServerConfig.ServerConfig;
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const fixture = yield* fs.makeTempDirectoryScoped({
              prefix: "supaterm-linked-themes-",
            });
            const active = path.join(fixture, "active");
            const previous = path.join(fixture, "previous");
            const target = path.join(active, "shared", "themes");
            yield* fs.makeDirectory(target, { recursive: true });
            yield* fs.writeFileString(
              path.join(target, "shared-light.json"),
              encodeThemeFile(SHARED_THEME),
            );

            const snapshots = yield* service.streamChanges.pipe(
              Stream.map((themes) => themes.map((theme) => theme.name)),
              Stream.toQueue({ capacity: "unbounded" }),
            );
            assert.deepEqual(yield* Queue.take(snapshots), ["Nightfall"]);
            linkedEntry = environmentThemesDir;
            yield* fs.rename(environmentThemesDir, path.join(fixture, "original"));
            yield* fs.symlink(target, environmentThemesDir);
            assert.deepEqual(
              (yield* Stream.fromQueue(snapshots).pipe(
                Stream.filter((names) => names.length > 0),
                Stream.runHead,
              )).valueOrUndefined,
              ["Shared Light"],
            );

            holdProbes = true;
            yield* fs.rename(active, previous);
            yield* fs.writeFileString(
              path.join(previous, "shared", "themes", "nightfall.json"),
              encodeThemeFile(NIGHTFALL_THEME),
            );
            assert.deepEqual(yield* Queue.take(snapshots), []);
            yield* fs.rename(previous, active);
            yield* Deferred.succeed(resumeProbes, undefined);
            assert.deepEqual(yield* Queue.take(snapshots), ["Nightfall", "Shared Light"]);
          }),
          {
            wrapFileSystem: (fs) =>
              FileSystem.FileSystem.of({
                ...fs,
                stat: (entry) =>
                  Effect.suspend(() =>
                    entry === linkedEntry && holdProbes
                      ? Deferred.await(resumeProbes).pipe(Effect.andThen(fs.stat(entry)))
                      : fs.stat(entry),
                  ),
              }),
          },
        );
      }),
  );

  it.effect("skips invalid files while keeping valid ones", () =>
    withEnvironmentThemes(
      {
        "nightfall.json": encodeThemeFile(NIGHTFALL_THEME),
        "notepad.json": `\uFEFF${encodeThemeFile(SHARED_THEME)}`,
        "unresolved.json":
          '{ "name": "X", "appearance": "dark", "canvas": "{{ background }}", "accent": "#7aa2f7" }',
        "malformed.json": "{ not json",
        "no-colors.json": '{ "name": "Empty", "appearance": "dark" }',
        "Bad Name.json": encodeThemeFile(SHARED_THEME),
        "ocean.json": encodeThemeFile(SHARED_THEME),
        "dark.json": encodeThemeFile(SHARED_THEME),
        "notes.txt": "not a theme",
      },
      Effect.gen(function* () {
        assert.deepEqual(
          (yield* currentThemes).map((theme) => theme.id),
          ["nightfall", "notepad"],
        );
      }),
    ),
  );

  it.effect.skipIf(!symlinksSupported)("ignores a symlinked theme file", () =>
    withEnvironmentThemes(
      {},
      Effect.gen(function* () {
        const { environmentThemesDir } = yield* ServerConfig.ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const outside = path.join(environmentThemesDir, "..", "outside.json");
        yield* fs.writeFileString(outside, encodeThemeFile(NIGHTFALL_THEME));
        yield* fs.symlink(outside, path.join(environmentThemesDir, "nightfall.json"));
        assert.deepEqual(yield* currentThemes, []);
      }),
    ),
  );

  it.effect("does not charge skipped files against the total size limit", () =>
    withEnvironmentThemes(
      {
        ...Object.fromEntries(
          Array.from({ length: 7 }, (_, index) => [`junk-${index}.json`, "{".repeat(30_000)]),
        ),
        "zz-valid.json": encodeThemeFile(NIGHTFALL_THEME),
      },
      Effect.gen(function* () {
        assert.deepEqual(
          (yield* currentThemes).map((theme) => theme.id),
          ["zz-valid"],
        );
      }),
    ),
  );
});

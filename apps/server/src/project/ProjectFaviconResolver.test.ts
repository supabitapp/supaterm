import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, describe, expect } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import { TestClock } from "effect/testing";

import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as ProjectFaviconResolver from "./ProjectFaviconResolver.ts";
import * as SupatermProjectFileLoader from "./SupatermProjectFileLoader.ts";

const layerTest = Layer.empty.pipe(
  Layer.provideMerge(
    ProjectFaviconResolver.layer.pipe(
      Layer.provide(WorkspacePaths.layer),
      Layer.provide(SupatermProjectFileLoader.layer),
    ),
  ),
  Layer.provideMerge(NodeServices.layer),
);

const makeTempDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({
    prefix: "supaterm-project-favicon-",
  });
});

const writeTextFile = Effect.fn("writeTextFile")(function* (
  cwd: string,
  relativePath: string,
  contents: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolutePath = path.join(cwd, relativePath);
  yield* fileSystem
    .makeDirectory(path.dirname(absolutePath), { recursive: true })
    .pipe(Effect.orDie);
  yield* fileSystem.writeFileString(absolutePath, contents).pipe(Effect.orDie);
});

const makeResolverWithFileSystem = (fileSystem: FileSystem.FileSystem) =>
  ProjectFaviconResolver.make.pipe(
    Effect.provide([WorkspacePaths.layer, SupatermProjectFileLoader.layer]),
    Effect.provideService(FileSystem.FileSystem, fileSystem),
  );

it.layer(layerTest)("ProjectFaviconResolverLive", (it) => {
  describe("resolvePath", () => {
    it.effect("serves repeated resolves from cache instead of re-walking candidates", () =>
      Effect.gen(function* () {
        const resolver = yield* ProjectFaviconResolver.ProjectFaviconResolver;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "public/favicon.svg", "<svg>public</svg>");

        const resolved = yield* resolver.resolvePath(cwd);
        expect(resolved?.endsWith(path.join("public", "favicon.svg"))).toBe(true);

        yield* writeTextFile(cwd, "favicon.svg", "<svg>root</svg>");

        for (const _attempt of [1, 2, 3]) {
          expect(yield* resolver.resolvePath(cwd)).toBe(resolved);
        }

        yield* TestClock.adjust(Duration.minutes(11));

        expect(yield* resolver.resolvePath(cwd)).toBe(path.join(cwd, "favicon.svg"));
        expect(yield* resolver.resolvePath(cwd)).not.toBe(resolved);
      }).pipe(Effect.provide(TestClock.layer())),
    );

    it.effect("finds a favicon added after a cached miss once the workspace is invalidated", () =>
      Effect.gen(function* () {
        const resolver = yield* ProjectFaviconResolver.ProjectFaviconResolver;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;

        // A clone's project exists while its folder is still empty.
        expect(yield* resolver.resolvePath(cwd)).toBeNull();
        yield* writeTextFile(cwd, "favicon.ico", "icon");
        expect(yield* resolver.resolvePath(cwd)).toBeNull();

        yield* resolver.invalidate(cwd);
        expect(yield* resolver.resolvePath(cwd)).toBe(path.join(cwd, "favicon.ico"));
      }),
    );

    it.effect("falls back at once when a cached favicon is deleted", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const resolver = yield* ProjectFaviconResolver.ProjectFaviconResolver;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "favicon.svg", "<svg>favicon</svg>");

        expect(yield* resolver.resolvePath(cwd)).not.toBeNull();

        yield* fileSystem.remove(path.join(cwd, "favicon.svg")).pipe(Effect.orDie);

        expect(yield* resolver.resolvePath(cwd)).toBeNull();
      }).pipe(Effect.provide(TestClock.layer())),
    );

    it.effect("re-probes for a favicon added after a miss once the negative TTL expires", () =>
      Effect.gen(function* () {
        const resolver = yield* ProjectFaviconResolver.ProjectFaviconResolver;
        const cwd = yield* makeTempDir;

        expect(yield* resolver.resolvePath(cwd)).toBeNull();

        yield* writeTextFile(cwd, "favicon.svg", "<svg>favicon</svg>");
        expect(yield* resolver.resolvePath(cwd)).toBeNull();

        yield* TestClock.adjust(Duration.minutes(2));

        expect(yield* resolver.resolvePath(cwd)).not.toBeNull();
      }).pipe(Effect.provide(TestClock.layer())),
    );

    it.effect("prefers well-known favicon files", () =>
      Effect.gen(function* () {
        const resolver = yield* ProjectFaviconResolver.ProjectFaviconResolver;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "favicon.svg", "<svg>favicon</svg>");

        const resolved = yield* resolver.resolvePath(cwd);

        expect(resolved).not.toBeNull();
        expect(resolved).toContain("favicon.svg");
      }),
    );

    it.effect("prefers a supaterm.json iconPath over well-known files", () =>
      Effect.gen(function* () {
        const resolver = yield* ProjectFaviconResolver.ProjectFaviconResolver;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "supaterm.json", '{ "iconPath": "brand/mark.svg" }');
        yield* writeTextFile(cwd, "brand/mark.svg", "<svg>mark</svg>");
        yield* writeTextFile(cwd, "favicon.svg", "<svg>favicon</svg>");

        const resolved = yield* resolver.resolvePath(cwd);

        expect(resolved).not.toBeNull();
        expect(resolved).toBe(path.join(cwd, "brand", "mark.svg"));
      }),
    );

    it.effect("uses a saved project favicon override", () =>
      Effect.gen(function* () {
        const resolver = yield* ProjectFaviconResolver.ProjectFaviconResolver;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "brand/custom.svg", "<svg>custom</svg>");
        yield* writeTextFile(cwd, "favicon.svg", "<svg>automatic</svg>");

        const resolved = yield* resolver.resolvePath(cwd, "brand/custom.svg");

        expect(resolved).not.toBeNull();
        expect(resolved).toBe(path.join(cwd, "brand", "custom.svg"));
      }),
    );

    it.effect("uses a saved project favicon outside the workspace", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const resolver = yield* ProjectFaviconResolver.ProjectFaviconResolver;
        const cwd = yield* makeTempDir;
        const pictures = yield* makeTempDir;
        yield* writeTextFile(pictures, "custom.png", "image");
        const externalPath = path.join(pictures, "custom.png");

        const resolved = yield* resolver.resolvePath(cwd, externalPath);

        expect(resolved).toBe(externalPath);
      }),
    );

    it.effect("falls back when a saved override is missing from a checkout", () =>
      Effect.gen(function* () {
        const resolver = yield* ProjectFaviconResolver.ProjectFaviconResolver;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "favicon.svg", "<svg>automatic</svg>");

        const resolved = yield* resolver.resolvePath(cwd, "brand/missing.svg");

        expect(resolved).not.toBeNull();
        expect(resolved).toContain("favicon.svg");
      }),
    );

    it.effect("falls back to well-known files when the supaterm.json iconPath does not exist", () =>
      Effect.gen(function* () {
        const resolver = yield* ProjectFaviconResolver.ProjectFaviconResolver;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "supaterm.json", '{ "iconPath": "brand/missing.svg" }');
        yield* writeTextFile(cwd, "favicon.svg", "<svg>favicon</svg>");

        const resolved = yield* resolver.resolvePath(cwd);

        expect(resolved).not.toBeNull();
        expect(resolved).toContain("favicon.svg");
      }),
    );

    it.effect("ignores invalid supaterm.json files", () =>
      Effect.gen(function* () {
        const resolver = yield* ProjectFaviconResolver.ProjectFaviconResolver;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "supaterm.json", "{ not json");
        yield* writeTextFile(cwd, "favicon.svg", "<svg>favicon</svg>");

        const resolved = yield* resolver.resolvePath(cwd);

        expect(resolved).not.toBeNull();
        expect(resolved).toContain("favicon.svg");
      }),
    );

    it.effect("does not resolve a supaterm.json iconPath outside the workspace root", () =>
      Effect.gen(function* () {
        const resolver = yield* ProjectFaviconResolver.ProjectFaviconResolver;
        const parent = yield* makeTempDir;
        const cwd = `${parent}/app`;
        yield* writeTextFile(parent, "secret.svg", "<svg>secret</svg>");
        yield* writeTextFile(cwd, "supaterm.json", '{ "iconPath": "../secret.svg" }');

        const resolved = yield* resolver.resolvePath(cwd);

        expect(resolved).toBeNull();
      }),
    );

    it.effect("resolves icon hrefs from project source files", () =>
      Effect.gen(function* () {
        const resolver = yield* ProjectFaviconResolver.ProjectFaviconResolver;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "index.html", '<link rel="icon" href="/brand/logo.svg">');
        yield* writeTextFile(cwd, "public/brand/logo.svg", "<svg>brand</svg>");

        const resolved = yield* resolver.resolvePath(cwd);

        expect(resolved).not.toBeNull();
        expect(resolved).toBe((yield* Path.Path).join(cwd, "public", "brand", "logo.svg"));
      }),
    );

    it.effect("resolves icon hrefs from object-literal route metadata", () =>
      Effect.gen(function* () {
        const resolver = yield* ProjectFaviconResolver.ProjectFaviconResolver;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(
          cwd,
          "src/routes/__root.tsx",
          `export const Route = createRootRoute({
  head: () => ({
    links: [
      { rel: "stylesheet", href: "/app.css" },
      { rel: "icon", href: "/brand/logo.svg" },
    ],
  }),
});`,
        );
        yield* writeTextFile(cwd, "public/brand/logo.svg", "<svg>brand</svg>");

        const resolved = yield* resolver.resolvePath(cwd);

        expect(resolved).not.toBeNull();
        expect(resolved).toBe((yield* Path.Path).join(cwd, "public", "brand", "logo.svg"));
      }),
    );

    it.effect("resolves object-literal icon metadata when href precedes rel", () =>
      Effect.gen(function* () {
        const resolver = yield* ProjectFaviconResolver.ProjectFaviconResolver;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(
          cwd,
          "src/root.tsx",
          `const links = [{ href: "/brand/logo.svg", rel: "shortcut icon" }];`,
        );
        yield* writeTextFile(cwd, "public/brand/logo.svg", "<svg>brand</svg>");

        const resolved = yield* resolver.resolvePath(cwd);

        expect(resolved).not.toBeNull();
        expect(resolved).toBe((yield* Path.Path).join(cwd, "public", "brand", "logo.svg"));
      }),
    );

    it.effect("resolves object-literal icon metadata alongside nested objects", () =>
      Effect.gen(function* () {
        const resolver = yield* ProjectFaviconResolver.ProjectFaviconResolver;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(
          cwd,
          "src/root.tsx",
          `const links = [{ attributes: {}, rel: "icon", href: "/brand/logo.svg" }];`,
        );
        yield* writeTextFile(cwd, "public/brand/logo.svg", "<svg>brand</svg>");

        const resolved = yield* resolver.resolvePath(cwd);

        expect(resolved).not.toBeNull();
        expect(resolved).toBe((yield* Path.Path).join(cwd, "public", "brand", "logo.svg"));
      }),
    );

    it.effect("skips icon metadata without an href and keeps scanning", () =>
      Effect.gen(function* () {
        const resolver = yield* ProjectFaviconResolver.ProjectFaviconResolver;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(
          cwd,
          "src/root.tsx",
          `const links = [{ rel: "icon" }, { rel: "icon", href: "/brand/logo.svg" }];`,
        );
        yield* writeTextFile(cwd, "public/brand/logo.svg", "<svg>brand</svg>");

        const resolved = yield* resolver.resolvePath(cwd);

        expect(resolved).not.toBeNull();
        expect(resolved).toBe((yield* Path.Path).join(cwd, "public", "brand", "logo.svg"));
      }),
    );

    it.effect("scans large icon sources without an icon in reasonable time", () =>
      Effect.gen(function* () {
        const resolver = yield* ProjectFaviconResolver.ProjectFaviconResolver;
        const cwd = yield* makeTempDir;
        const filler = `<p>${"pokopia companion guide ".repeat(24)}</p>\n`;
        yield* writeTextFile(
          cwd,
          "index.html",
          `<!doctype html><html><head><title>guide</title></head><body>\n${filler.repeat(1200)}</body></html>`,
        );

        const startedAt = performance.now();
        const resolved = yield* resolver.resolvePath(cwd);
        const elapsedMs = performance.now() - startedAt;

        expect(resolved).toBeNull();
        expect(elapsedMs).toBeLessThan(5_000);
      }),
    );

    it.effect("prefers a root icon over monorepo package icons", () =>
      Effect.gen(function* () {
        const resolver = yield* ProjectFaviconResolver.ProjectFaviconResolver;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "apps/web/public/favicon.svg", "<svg>web</svg>");
        yield* writeTextFile(cwd, "assets/logo.png", "root");

        expect(yield* resolver.resolvePath(cwd)).toBe(path.join(cwd, "assets", "logo.png"));
      }),
    );

    it.effect("ranks monorepo package icons by candidate before package name", () =>
      Effect.gen(function* () {
        const resolver = yield* ProjectFaviconResolver.ProjectFaviconResolver;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "apps/mobile/assets/icon.png", "mobile");
        yield* writeTextFile(cwd, "apps/web/public/favicon.svg", "<svg>web</svg>");

        expect(yield* resolver.resolvePath(cwd)).toBe(
          path.join(cwd, "apps", "web", "public", "favicon.svg"),
        );
      }),
    );

    it.effect("prefers apps over packages in a monorepo", () =>
      Effect.gen(function* () {
        const resolver = yield* ProjectFaviconResolver.ProjectFaviconResolver;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "packages/ui/favicon.svg", "<svg>ui</svg>");
        yield* writeTextFile(cwd, "apps/web/assets/logo.png", "web");

        expect(yield* resolver.resolvePath(cwd)).toBe(
          path.join(cwd, "apps", "web", "assets", "logo.png"),
        );
      }),
    );

    it.effect("resolves icon hrefs relative to the monorepo package that declares them", () =>
      Effect.gen(function* () {
        const resolver = yield* ProjectFaviconResolver.ProjectFaviconResolver;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "apps/web/index.html", '<link rel="icon" href="/brand.svg">');
        yield* writeTextFile(cwd, "apps/web/public/brand.svg", "<svg>brand</svg>");

        expect(yield* resolver.resolvePath(cwd)).toBe(
          path.join(cwd, "apps", "web", "public", "brand.svg"),
        );
      }),
    );

    it.effect("breaks ties between equally ranked package icons by package name", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "apps/alpha/public/favicon.svg", "<svg>alpha</svg>");
        yield* writeTextFile(cwd, "apps/beta/public/favicon.svg", "<svg>beta</svg>");
        const alphaPath = path.join(cwd, "apps", "alpha");
        const betaPath = path.join(cwd, "apps", "beta");
        const betaStatted = yield* Deferred.make<void>();
        const resolver = yield* makeResolverWithFileSystem(
          FileSystem.FileSystem.of({
            ...fileSystem,
            stat: (filePath) => {
              if (filePath === alphaPath) {
                return Deferred.await(betaStatted).pipe(Effect.andThen(fileSystem.stat(filePath)));
              }
              if (filePath === betaPath) {
                return fileSystem
                  .stat(filePath)
                  .pipe(Effect.tap(Deferred.succeed(betaStatted, undefined)));
              }
              return fileSystem.stat(filePath);
            },
          }),
        );

        expect(yield* resolver.resolvePath(cwd)).toBe(
          path.join(alphaPath, "public", "favicon.svg"),
        );
      }),
    );

    it.effect("does not inspect package entries beyond the cap", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        for (let index = 0; index < 64; index += 1) {
          yield* writeTextFile(cwd, `apps/app-${String(index).padStart(2, "0")}/README.md`, "");
        }
        yield* writeTextFile(cwd, "apps/app-63/public/favicon.svg", "<svg>last</svg>");
        yield* writeTextFile(cwd, "apps/zz-unreadable/README.md", "");
        const unreadablePath = path.join(cwd, "apps", "zz-unreadable");
        const resolver = yield* makeResolverWithFileSystem(
          FileSystem.FileSystem.of({
            ...fileSystem,
            stat: (filePath) =>
              filePath === unreadablePath
                ? Effect.fail(
                    PlatformError.systemError({
                      _tag: "PermissionDenied",
                      module: "FileSystem",
                      method: "stat",
                      pathOrDescriptor: unreadablePath,
                    }),
                  )
                : fileSystem.stat(filePath),
          }),
        );

        expect(yield* resolver.resolvePath(cwd)).toBe(
          path.join(cwd, "apps", "app-63", "public", "favicon.svg"),
        );
      }),
    );

    it.effect("ignores regular files beside monorepo packages", () =>
      Effect.gen(function* () {
        const resolver = yield* ProjectFaviconResolver.ProjectFaviconResolver;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "apps/README.md", "# apps");
        yield* writeTextFile(cwd, "apps/web/public/favicon.ico", "web");

        expect(yield* resolver.resolvePath(cwd)).toBe(
          path.join(cwd, "apps", "web", "public", "favicon.ico"),
        );
      }),
    );

    it.effect("returns null when no icon is present", () =>
      Effect.gen(function* () {
        const resolver = yield* ProjectFaviconResolver.ProjectFaviconResolver;
        const cwd = yield* makeTempDir;

        const resolved = yield* resolver.resolvePath(cwd);

        expect(resolved).toBeNull();
      }),
    );

    it.effect("preserves workspace normalization context", () =>
      Effect.gen(function* () {
        const resolver = yield* ProjectFaviconResolver.ProjectFaviconResolver;
        const cwd = yield* makeTempDir;
        const missingCwd = `${cwd}/missing`;

        const error = yield* resolver.resolvePath(missingCwd).pipe(Effect.flip);

        expect(error).toMatchObject({
          _tag: "ProjectFaviconResolutionError",
          operation: "normalize-workspace",
          workspaceRoot: missingCwd,
        });
        expect(error.cause).toBeInstanceOf(WorkspacePaths.WorkspaceRootNotExistsError);
      }),
    );

    it.effect("preserves non-missing candidate stat failures", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const faviconPath = path.join(cwd, "favicon.svg");
        const cause = PlatformError.systemError({
          _tag: "PermissionDenied",
          module: "FileSystem",
          method: "stat",
          pathOrDescriptor: faviconPath,
        });
        const resolver = yield* makeResolverWithFileSystem(
          FileSystem.FileSystem.of({
            ...fileSystem,
            stat: (filePath) =>
              filePath === faviconPath ? Effect.fail(cause) : fileSystem.stat(filePath),
          }),
        );

        const error = yield* resolver.resolvePath(cwd).pipe(Effect.flip);

        expect(error).toMatchObject({
          _tag: "ProjectFaviconResolutionError",
          operation: "stat-candidate",
          workspaceRoot: cwd,
          relativePath: "favicon.svg",
          absolutePath: faviconPath,
        });
        expect(error.cause).toBe(cause);
      }),
    );

    it.effect("probes well-known candidates concurrently", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const cwd = yield* makeTempDir;
        let inFlight = 0;
        let peakInFlight = 0;
        const resolver = yield* makeResolverWithFileSystem(
          FileSystem.FileSystem.of({
            ...fileSystem,
            stat: (filePath) =>
              Effect.suspend(() => {
                inFlight += 1;
                peakInFlight = Math.max(peakInFlight, inFlight);
                return Effect.yieldNow.pipe(Effect.andThen(fileSystem.stat(filePath)));
              }).pipe(Effect.ensuring(Effect.sync(() => (inFlight -= 1)))),
          }),
        );

        expect(yield* resolver.resolvePath(cwd)).toBeNull();
        expect(peakInFlight).toBeGreaterThan(1);
      }),
    );

    it.effect("returns a found favicon without waiting for lower-ranked probes", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "favicon.svg", "<svg>root</svg>");
        const stuckPath = path.join(cwd, "favicon.ico");
        const resolver = yield* makeResolverWithFileSystem(
          FileSystem.FileSystem.of({
            ...fileSystem,
            stat: (filePath) => (filePath === stuckPath ? Effect.never : fileSystem.stat(filePath)),
          }),
        );

        expect(yield* resolver.resolvePath(cwd)).toBe(path.join(cwd, "favicon.svg"));
      }),
    );

    it.effect("ignores a failing candidate that ranks below a found favicon", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "favicon.svg", "<svg>root</svg>");
        const failingPath = path.join(cwd, "favicon.ico");
        const resolver = yield* makeResolverWithFileSystem(
          FileSystem.FileSystem.of({
            ...fileSystem,
            stat: (filePath) =>
              filePath === failingPath
                ? Effect.fail(
                    PlatformError.systemError({
                      _tag: "PermissionDenied",
                      module: "FileSystem",
                      method: "stat",
                      pathOrDescriptor: failingPath,
                    }),
                  )
                : fileSystem.stat(filePath),
          }),
        );

        expect(yield* resolver.resolvePath(cwd)).toBe(path.join(cwd, "favicon.svg"));
      }),
    );

    it.effect("preserves icon source read failures", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const sourcePath = path.join(cwd, "index.html");
        yield* writeTextFile(cwd, "index.html", '<link rel="icon" href="/favicon.svg">');
        const cause = PlatformError.systemError({
          _tag: "PermissionDenied",
          module: "FileSystem",
          method: "readFileString",
          pathOrDescriptor: sourcePath,
        });
        const resolver = yield* makeResolverWithFileSystem(
          FileSystem.FileSystem.of({
            ...fileSystem,
            readFileString: (filePath, options) =>
              filePath === sourcePath
                ? Effect.fail(cause)
                : fileSystem.readFileString(filePath, options),
          }),
        );

        const error = yield* resolver.resolvePath(cwd).pipe(Effect.flip);

        expect(error).toMatchObject({
          _tag: "ProjectFaviconResolutionError",
          operation: "read-source",
          workspaceRoot: cwd,
          relativePath: "index.html",
          absolutePath: sourcePath,
        });
        expect(error.cause).toBe(cause);
      }),
    );

    it.effect("skips icon metadata paths outside the workspace", () =>
      Effect.gen(function* () {
        const resolver = yield* ProjectFaviconResolver.ProjectFaviconResolver;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "index.html", '<link rel="icon" href="../../secret.svg">');

        const resolved = yield* resolver.resolvePath(cwd);

        expect(resolved).toBeNull();
      }),
    );

    it.effect("continues to later sources after an outside-root icon href", () =>
      Effect.gen(function* () {
        const resolver = yield* ProjectFaviconResolver.ProjectFaviconResolver;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "index.html", '<link rel="icon" href="../../secret.svg">');
        yield* writeTextFile(cwd, "public/index.html", '<link rel="icon" href="/brand/logo.svg">');
        yield* writeTextFile(cwd, "public/brand/logo.svg", "<svg>brand</svg>");

        const resolved = yield* resolver.resolvePath(cwd);

        expect(resolved).not.toBeNull();
        expect(resolved).toBe((yield* Path.Path).join(cwd, "public", "brand", "logo.svg"));
      }),
    );
  });
});

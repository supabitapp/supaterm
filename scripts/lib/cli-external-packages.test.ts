import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { findEsmImportsOfExternalPackages } from "./cli-executable-imports.ts";

import {
  isRuntimeExternalCliDependency,
  findInlinedExternalPackages,
  readInstalledPackages,
  shouldBundleCliDependency,
} from "./cli-external-packages.ts";

describe("shouldBundleCliDependency", () => {
  it("leaves native addons and their dlopen wrappers external", () => {
    for (const id of [
      "node-pty",
      "ffi-rs",
      "@yuuang/ffi-rs-win32-x64-msvc",
      "@ff-labs/fff-node",
      "@napi-rs/keyring",
      "node-addon-api",
    ]) {
      assert.strictEqual(shouldBundleCliDependency(id), false, id);
    }
  });

  it("treats prefix-matched siblings as external", () => {
    assert.strictEqual(shouldBundleCliDependency("node-gyp-build-optional-packages"), false);
  });
});

it.layer(NodeServices.layer)("external package dependency closure", (it) => {
  const installedPackages = readInstalledPackages([
    NodeURL.fileURLToPath(new URL("../../apps/server/", import.meta.url)),
  ]).pipe(Effect.cached, Effect.runSync);

  // Runtime-external only. The build-only entries resolve `bun:*` and are never
  // loaded by Node, so their closure genuinely does not need to be external.
  const isRuntimeExternal = isRuntimeExternalCliDependency;

  it.effect("keeps every runtime dependency of an external package external too", () =>
    Effect.gen(function* () {
      const installed = yield* installedPackages;
      const violations: string[] = [];
      for (const manifest of installed.values()) {
        if (!isRuntimeExternal(manifest.name)) continue;

        const declared = {
          ...manifest.dependencies,
          ...manifest.optionalDependencies,
          ...manifest.peerDependencies,
        };
        for (const dependency of Object.keys(declared)) {
          if (!isRuntimeExternal(dependency)) {
            violations.push(`${manifest.name} -> ${dependency}`);
          }
        }
      }

      assert.deepStrictEqual(
        violations,
        [],
        `these dependencies of external packages would be bundled away and fail to resolve under WSL: ${violations.join(", ")}`,
      );
    }),
  );
});

describe("findInlinedExternalPackages", () => {
  const region = (path: string) => `//#region ${path}
var x = 1;
//#endregion
`;

  it("flags an external package that was inlined", () => {
    const source =
      region("../../node_modules/.pnpm/node-addon-api@7.1.1/node_modules/node-addon-api/index.js") +
      region(
        "../../node_modules/.pnpm/node-gyp-build-optional-packages@5.2.2/node_modules/node-gyp-build-optional-packages/index.js",
      );
    const result = findInlinedExternalPackages(source);

    assert.deepStrictEqual(result.inlined, ["node-addon-api", "node-gyp-build-optional-packages"]);
    assert.strictEqual(result.regionCount, 2);
  });

  it("reports the packages that were inlined, not just the violations", () => {
    const source =
      region("../../node_modules/.pnpm/effect@4.0.0/node_modules/effect/dist/index.js") +
      region("../../node_modules/.pnpm/yaml@2.4.0/node_modules/yaml/dist/index.js") +
      region("../../src/server/main.ts");
    const result = findInlinedExternalPackages(source);

    assert.deepStrictEqual(result.inlinedPackages, ["effect", "yaml"]);
    assert.deepStrictEqual(result.inlined, []);
  });

  it("reads the plain `// <path>` markers newer Rolldown emits", () => {
    const source = [
      "// \0rolldown/runtime.js",
      "var x = 1;",
      "// ../../node_modules/.pnpm/node-addon-api@7.1.1/node_modules/node-addon-api/index.js",
      "var y = 2; // trailing comment",
      "// ../../src/server/main.ts",
      "",
    ].join("\n");
    const result = findInlinedExternalPackages(source);

    assert.strictEqual(result.regionCount, 3);
    assert.deepStrictEqual(result.inlined, ["node-addon-api"]);
  });
});

describe("findEsmImportsOfExternalPackages", () => {
  it("flags static and dynamic imports of file-backed packages", () => {
    const source = [
      'import { FileFinder } from "@ff-labs/fff-node";',
      'import * as fs from "fs";',
      'import { createRequire } from "node:module";',
      'const pty = () => import("node-pty");',
      'const data = () => import("@ff-labs/fff-bin-linux-x64-gnu", { with: { type: "json" } });',
      'const lazy = () => import(/* @vite-ignore */ "ffi-rs");',
      'const local = () => import("./chunk-abc.mjs");',
    ].join("\n");

    assert.deepStrictEqual(findEsmImportsOfExternalPackages(source), [
      "@ff-labs/fff-bin-linux-x64-gnu",
      "@ff-labs/fff-node",
      "ffi-rs",
      "node-pty",
    ]);
  });

  it("flags side-effect imports and re-exports too", () => {
    const source = ['import "msgpackr-extract";', 'export { load } from "ffi-rs";'].join("\n");
    assert.deepStrictEqual(findEsmImportsOfExternalPackages(source), [
      "ffi-rs",
      "msgpackr-extract",
    ]);
  });

  it("ignores imports inside generated extension source and comments", () => {
    const source = [
      'const extension = `import { Type } from "typebox";\nimport type { ExtensionAPI } from "@earendil-works/pi-coding-agent";`;',
      '// import "comment-only";',
      "const example = 'import(\"string-only\")';",
      'const interpolated = `source ${import("real-package")}`;',
    ].join("\n");
    assert.deepStrictEqual(findEsmImportsOfExternalPackages(source), ["real-package"]);
  });

  it("allows optional dynamic Bun built-ins but rejects static imports", () => {
    assert.deepStrictEqual(
      findEsmImportsOfExternalPackages('const load = () => import("bun:sqlite");'),
      [],
    );
    assert.deepStrictEqual(
      findEsmImportsOfExternalPackages('import { Database } from "bun:sqlite";'),
      ["bun:sqlite"],
    );
  });

  it("does not mistake createRequire calls for imports", () => {
    const source = 'const { FileFinder } = createRequire(import.meta.url)("@ff-labs/fff-node");';
    assert.deepStrictEqual(findEsmImportsOfExternalPackages(source), []);
  });
});

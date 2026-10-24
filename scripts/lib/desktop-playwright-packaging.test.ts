// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import desktopPackage from "../../apps/desktop/package.json" with { type: "json" };
import {
  DESKTOP_RUNTIME_FILE_EXCLUSIONS,
  selectDesktopRuntimeExternalDependencies,
} from "./desktop-external-packages.ts";

const decodeManifest = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      name: Schema.optionalKey(Schema.String),
      dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
      peerDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
    }),
  ),
);

const repoRoot = NodeURL.fileURLToPath(new URL("../..", import.meta.url));
const desktopPackagePath = NodePath.join(repoRoot, "apps/desktop/package.json");

// Stage the same external package closure the desktop artifact installs, applying
// the production runtime file exclusions without retaining pnpm links to this checkout.
async function stagePackage(
  name: string,
  from: string,
  destination: string,
  staged = new Set<string>(),
): Promise<void> {
  if (staged.has(name)) return;
  staged.add(name);

  const require = NodeModule.createRequire(from);
  let source = NodePath.dirname(require.resolve(name));
  while (!NodeFS.existsSync(NodePath.join(source, "package.json"))) {
    const parent = NodePath.dirname(source);
    if (parent === source) throw new Error(`Cannot locate ${name}`);
    source = parent;
  }
  let manifest = decodeManifest(
    await NodeFSP.readFile(NodePath.join(source, "package.json"), "utf8"),
  );
  while (manifest.name !== name) {
    source = NodePath.dirname(source);
    if (source === NodePath.dirname(source)) throw new Error(`Cannot locate ${name}`);
    if (NodeFS.existsSync(NodePath.join(source, "package.json"))) {
      manifest = decodeManifest(
        await NodeFSP.readFile(NodePath.join(source, "package.json"), "utf8"),
      );
    }
  }

  const target = NodePath.join(destination, "node_modules", name);
  await NodeFSP.mkdir(NodePath.dirname(target), { recursive: true });
  await NodeFSP.cp(source, target, {
    recursive: true,
    filter: (entry) =>
      NodePath.basename(entry) !== "node_modules" &&
      !DESKTOP_RUNTIME_FILE_EXCLUSIONS.some((pattern) =>
        NodePath.matchesGlob(
          `node_modules/${name}/${NodePath.relative(source, entry).replaceAll("\\", "/")}`,
          pattern.slice(1),
        ),
      ),
  });

  const dependencies = { ...manifest.dependencies, ...manifest.peerDependencies };
  for (const dependency of Object.keys(dependencies)) {
    await stagePackage(dependency, NodePath.join(source, "package.json"), target, staged);
  }
}

it("loads the packaged Playwright runtime through the server browser loader path", async () => {
  const scratch = await NodeFSP.mkdtemp(
    NodePath.join(NodeOS.tmpdir(), "supaterm-playwright-package-"),
  );
  try {
    // Missing staged dependencies must not resolve from a developer's /tmp tree.
    for (let parent = NodePath.dirname(scratch); ; parent = NodePath.dirname(parent)) {
      assert.isFalse(NodeFS.existsSync(NodePath.join(parent, "node_modules")));
      if (parent === NodePath.dirname(parent)) break;
    }

    const output = NodePath.join(scratch, "package");
    const runtimeDependencies = selectDesktopRuntimeExternalDependencies(
      desktopPackage.dependencies,
    );
    assert.equal(
      runtimeDependencies["playwright-core"],
      desktopPackage.dependencies["playwright-core"],
    );
    await stagePackage("playwright-core", desktopPackagePath, output);

    const probe = NodePath.join(output, "probe.mjs");
    await NodeFSP.writeFile(
      probe,
      `
      import assert from 'node:assert/strict';
      import * as NodeModule from 'node:module';

      // Keep this require path aligned with ServerBrowserContexts.loadPlaywright.
      const requirePlaywright = NodeModule.createRequire(import.meta.url);
      const loadPlaywright = () => requirePlaywright('playwright-core');
      assert.equal(typeof loadPlaywright().chromium.launch, 'function');
      console.log('Packaged Playwright runtime loaded');
    `,
    );

    const stdout = NodeChildProcess.execFileSync(
      process.execPath,
      ["--no-global-search-paths", probe],
      {
        cwd: output,
        env: {
          HOME: scratch,
          USERPROFILE: scratch,
          PATH: "",
          SystemRoot: process.env.SystemRoot ?? "",
        },
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    assert.include(stdout, "Packaged Playwright runtime loaded");
  } finally {
    await NodeFSP.rm(scratch, { recursive: true, force: true });
  }
});

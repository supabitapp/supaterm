// @effect-diagnostics nodeBuiltinImport:off - compiles real source files on disk.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { transform } from "oxc-transform-react";
import { describe, expect, it } from "vite-plus/test";

const repoRoot = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../../..",
);

const webSourceFiles = NodeFS.readdirSync(NodePath.join(repoRoot, "apps/web/src"), {
  recursive: true,
})
  .map(String)
  .filter((file) => /\.tsx?$/.test(file) && !/\.(test|browser)\.tsx?$/.test(file))
  .filter((file) => !file.endsWith(".gen.ts"))
  .map((file) => `apps/web/src/${file}`);

const slowFiles = new Set(["apps/web/src/components/ChatView.tsx"]);

const compile = async (file: string) => {
  const absolute = NodePath.join(repoRoot, file);
  const result = await transform(absolute, NodeFS.readFileSync(absolute, "utf8"), {
    jsx: { runtime: "automatic", development: false, refresh: false },
    reactCompiler: { reportDiagnostics: true },
  });
  const bailouts = result.errors.map((error) => error.codeframe ?? error.message);
  expect(bailouts).toEqual([]);
};

describe("React Compiler coverage", () => {
  it.each(webSourceFiles.filter((file) => !slowFiles.has(file)))("compiles %s", compile);
  // oxlint-disable-next-line supaterm/no-test-timeout-or-retry -- CPU-bound compile of a huge file, not a hidden wait.
  it.each([...slowFiles])("compiles %s", compile, 60_000);
});

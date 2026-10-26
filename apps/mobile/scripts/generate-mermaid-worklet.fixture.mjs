import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeVM from "node:vm";
import { generateMermaidWorklet } from "./generate-mermaid-worklet.mts";

const mobileRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const mobileRequire = NodeModule.createRequire(NodePath.join(mobileRoot, "package.json"));
const workletsRequire = NodeModule.createRequire(
  mobileRequire.resolve("react-native-worklets/plugin"),
);
const { transformFileSync } = workletsRequire("@babel/core");
const babelRequire = NodeModule.createRequire(mobileRequire.resolve("babel-preset-expo"));
const sources = JSON.parse(NodeFS.readFileSync(0, "utf8"));
const outputRoot = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "mermaid-worklet-"));

try {
  await generateMermaidWorklet(outputRoot);
  const filename = NodePath.join(outputRoot, "index.js");
  const initialModified = (await NodeFSP.stat(filename)).mtimeMs;
  await generateMermaidWorklet(outputRoot);
  const unchanged = initialModified === (await NodeFSP.stat(filename)).mtimeMs;
  const platforms = {};

  for (const platform of ["ios", "android"]) {
    const transformed = transformFileSync(filename, {
      configFile: NodePath.join(mobileRoot, "babel.config.js"),
      babelrc: false,
      caller: { name: "metro", bundler: "metro", platform, supportsStaticESM: false },
    });
    const context = { module: { exports: {} }, global: globalThis, require: babelRequire };
    NodeVM.runInNewContext(transformed.code, context);
    const worklet = context.module.exports;
    const runtime = NodeVM.createContext({ performance });
    const render = NodeVM.runInContext(`(${worklet.__initData.code})`, runtime);
    const outputs = sources.map((source) => render(source, { maxWidth: 320, now: 0 }));
    let clock = 0;
    runtime.performance = { now: () => (clock += 1_000) };
    runtime.Date = { now: () => -clock };
    const rejectsExpiredBudget = render("flowchart LR\nA --> B", { now: 0 }) === null;
    runtime.performance = performance;
    runtime.Date = Date;
    platforms[platform] = {
      closureSize: Object.keys(worklet.__closure ?? {}).length,
      outputs,
      rejectsExpiredBudget,
      recoversAfterBudget: render("flowchart LR\nA --> B", { now: 0 }) !== null,
    };
  }

  process.stdout.write(JSON.stringify({ unchanged, platforms }));
} finally {
  await NodeFSP.rm(outputRoot, { recursive: true, force: true });
}

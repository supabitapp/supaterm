import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

// oxlint-disable-next-line supaterm/no-global-process-runtime -- Native compilation only runs on the actual macOS host.
const hostPlatform = process.platform;

const { values } = NodeUtil.parseArgs({ options: { output: { type: "string" } } });

if (hostPlatform === "darwin") {
  const root = NodeURL.fileURLToPath(new URL("../../../native/sd-eject-guard/", import.meta.url));
  const source = NodePath.resolve(root, "main.c");
  const output = values.output ?? NodePath.resolve(root, "build", "supaterm-sd-eject-guard");
  let current = false;
  try {
    current =
      NodeFS.statSync(output).mtimeMs >=
      Math.max(
        NodeFS.statSync(source).mtimeMs,
        NodeFS.statSync(NodeURL.fileURLToPath(import.meta.url)).mtimeMs,
      );
  } catch {}
  if (!current) {
    NodeFS.mkdirSync(NodePath.dirname(output), { recursive: true });
    const temporary = `${output}.${process.pid}.tmp`;
    try {
      NodeChildProcess.execFileSync(
        "clang",
        [
          "-std=c11",
          "-O2",
          "-Wall",
          "-Wextra",
          "-Werror",
          "-arch",
          "arm64",
          "-arch",
          "x86_64",
          "-mmacosx-version-min=12.0",
          source,
          "-o",
          temporary,
          "-framework",
          "DiskArbitration",
          "-framework",
          "CoreFoundation",
        ],
        { stdio: "inherit" },
      );
      NodeFS.renameSync(temporary, output);
    } finally {
      NodeFS.rmSync(temporary, { force: true });
    }
  }
}

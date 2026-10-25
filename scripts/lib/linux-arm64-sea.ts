import { resolveSpawnCommand } from "@supaterm/shared/shell";
import * as NodeModule from "node:module";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

class LinuxArm64SeaError extends Schema.TaggedError<LinuxArm64SeaError>()("LinuxArm64SeaError", {
  message: Schema.String,
}) {}

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const run = Effect.fn("LinuxArm64Sea.run")(function* (
  nodeExecutable: string,
  args: Array<string>,
  verbose: boolean,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(
    ChildProcess.make(nodeExecutable, args, {
      stdout: verbose ? "inherit" : "ignore",
      stderr: "inherit",
    }),
  );
  const exitCode = yield* child.exitCode;
  if (exitCode !== 0) {
    return yield* new LinuxArm64SeaError({ message: `${args[0]} exited with code ${exitCode}.` });
  }
});

export const injectLinuxArm64Sea = Effect.fn("LinuxArm64Sea.inject")(function* (input: {
  bundlePath: string;
  outputPath: string;
  nodeVersion: string;
  verbose: boolean;
}) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const selected = yield* resolveSpawnCommand("vp", [
    "env",
    "exec",
    "--node",
    input.nodeVersion,
    "--",
    "node",
    "--print",
    "process.execPath",
  ]);
  const nodeExecutable = (yield* spawner.string(
    ChildProcess.make(selected.command, selected.args, { shell: selected.shell }),
  )).trim();
  const actualVersion = (yield* spawner.string(
    ChildProcess.make(nodeExecutable, ["--print", "process.versions.node"]),
  )).trim();
  if (actualVersion !== input.nodeVersion) {
    return yield* new LinuxArm64SeaError({
      message: `Expected Node ${input.nodeVersion}, got ${actualVersion}.`,
    });
  }
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const temp = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-sea-" });
  const blobPath = path.join(temp, "sea.blob");
  const configPath = path.join(temp, "sea.json");
  yield* fs.writeFileString(
    configPath,
    yield* encodeJson({
      main: input.bundlePath,
      output: blobPath,
      mainFormat: "module",
      disableExperimentalSEAWarning: true,

      useCodeCache: false,
    }),
  );
  yield* run(nodeExecutable, ["--experimental-sea-config", configPath], input.verbose);
  yield* fs.copyFile(nodeExecutable, input.outputPath);
  yield* fs.chmod(input.outputPath, 0o755);
  const require = NodeModule.createRequire(import.meta.url);
  yield* run(
    nodeExecutable,
    [
      require.resolve("postject/dist/cli.js"),
      input.outputPath,
      "NODE_SEA_BLOB",
      blobPath,
      "--sentinel-fuse",
      "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
    ],
    input.verbose,
  );
}, Effect.scoped);

export function assertLinuxArm64PageCompatibility(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length < 64 ||
    view.getUint32(0, false) !== 0x7f454c46 ||
    bytes[4] !== 2 ||
    bytes[5] !== 1 ||
    view.getUint16(18, true) !== 183
  ) {
    throw new Error("Expected a little-endian ELF64 ARM64 executable.");
  }
  const tableOffset = Number(view.getBigUint64(32, true));
  const entrySize = view.getUint16(54, true);
  const count = view.getUint16(56, true);
  if (
    !Number.isSafeInteger(tableOffset) ||
    entrySize < 56 ||
    count === 0 ||
    tableOffset + entrySize * count > bytes.length
  ) {
    throw new Error("Invalid ELF program header table.");
  }
  const pageSize = 0x10000n;
  const ranges: Array<{ start: bigint; end: bigint }> = [];
  for (let index = 0; index < count; index++) {
    const header = tableOffset + index * entrySize;
    if (view.getUint32(header, true) !== 1) continue;
    const offset = view.getBigUint64(header + 8, true);
    const address = view.getBigUint64(header + 16, true);
    const size = view.getBigUint64(header + 40, true);
    if (offset % pageSize !== address % pageSize) {
      throw new Error(`ARM64 LOAD segment ${index} is incompatible with 64 KiB pages.`);
    }
    if (size === 0n) continue;
    const start = address / pageSize;
    const end = (address + size + pageSize - 1n) / pageSize;
    if (ranges.some((range) => start < range.end && range.start < end)) {
      throw new Error(`ARM64 LOAD segments overlap on a 64 KiB page (segment ${index}).`);
    }
    ranges.push({ start, end });
  }
  if (ranges.length === 0) throw new Error("ELF executable has no LOAD segments.");
}

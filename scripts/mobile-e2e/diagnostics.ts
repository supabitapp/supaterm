// @effect-diagnostics nodeBuiltinImport:off - Records resource pressure on the device host.
import * as NodeProcess from "node:process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { run } from "./process.ts";

export async function captureHostResources(directory: string, phase: string) {
  const commands: ReadonlyArray<readonly [string, ReadonlyArray<string>]> =
    NodeProcess.platform === "darwin"
      ? [
          ["sysctl", ["hw.memsize", "hw.ncpu"]],
          ["vm_stat", []],
          ["memory_pressure", ["-Q"]],
        ]
      : [
          ["free", ["-m"]],
          ["cat", ["/proc/pressure/cpu", "/proc/pressure/memory"]],
          ["dmesg", ["--level=err"]],
        ];
  const results = await Promise.all(
    commands.map(async ([command, args]) => {
      const output = await run(command, args, { allowFailure: true, timeoutMs: 10_000 }).then(
        ({ stdout, stderr }) => stdout || stderr,
        (error: unknown) => String(error),
      );
      return `${command} ${args.join(" ")}\n${output}`;
    }),
  );
  await NodeFSP.appendFile(
    NodePath.join(directory, "host-resources.log"),
    `\n${phase}\n${results.join("\n")}\n`,
  ).catch(() => undefined);
}

import * as NodeServices from "@effect/platform-node/NodeServices";
import { EDITORS } from "@supaterm/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { vi } from "vite-plus/test";
import * as HostProcess from "./HostProcess.ts";
import { resolveEditorCommand } from "./editor.ts";

const { available } = vi.hoisted(() => ({ available: new Set<string>() }));
vi.mock("./shell.ts", () => ({
  isCommandAvailable: (command: string) => Effect.succeed(available.has(command)),
}));

it.effect.each(
  (
    [
      [["zed", "zeditor"], "zeditor"],
      [["zed", "/usr/bin/zeditor"], "/usr/bin/zeditor"],
      [["/home/test/.local/bin/zed", "/snap/bin/zeditor"], "/snap/bin/zeditor"],
      [["zeditor", "/usr/bin/zeditor"], "zeditor"],
      [["zed"], "zed"],
      [["/usr/bin/zed"], "/usr/bin/zed"],
    ] as const
  ).map(([commands, expected]) => ({ commands, expected })),
)("uses the editor executable from $commands", ({ commands, expected }) =>
  Effect.gen(function* () {
    available.clear();
    for (const command of commands) available.add(command);
    const editor = EDITORS.find((candidate) => candidate.id === "zed")!;
    const resolved = yield* resolveEditorCommand(editor, { HOME: "/home/test", PATH: "/bin" });
    assert.equal(Option.getOrThrow(resolved).command, expected);
  }).pipe(Effect.provideService(HostProcess.Platform, "linux"), Effect.provide(NodeServices.layer)),
);

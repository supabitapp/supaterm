// @effect-diagnostics nodeBuiltinImport:off - CLI integration exercises the filesystem boundary.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { TRIAGE_PROMPT_FILE_NAME } from "@supaterm/contracts";
import * as NetService from "@supaterm/shared/Net";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/cli";
import { vi } from "vite-plus/test";

import { cli } from "../binCli.ts";
import { buildTriageLaunchPrompt, TRIAGE_PLAYBOOK } from "../triage/triagePrompt.ts";

it.effect("--print prints the prompt with machine facts inline and writes nothing", () =>
  Effect.gen(function* () {
    const baseDir = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({
      prefix: "supaterm-triage-cli-",
    });
    yield* Command.runWith(cli, { version: "0.0.0" })(["triage", "--print", "--base-dir", baseDir]);
    const output = (yield* TestConsole.logLines).join("\n");
    assert.include(output, "supaterm triage --print");
    assert.include(output, NodePath.join(baseDir, "userdata", "statev2.sqlite"));
    assert.include(output, NodePath.join(baseDir, "userdata", "secrets"));
    assert.include(output, TRIAGE_PLAYBOOK);
    assert.isFalse(NodeFS.existsSync(NodePath.join(baseDir, "userdata", "triage")));
  }).pipe(
    Effect.scoped,
    Effect.provide(
      Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, NetService.layer, TestConsole.layer),
    ),
  ),
);

const FAILING_AGENT_POSIX = `#!/bin/sh
echo "Error: There is not enough space on the disk. (os error 112)" >&2
exit 1
`;
const FAILING_AGENT_WINDOWS = `@echo Error: There is not enough space on the disk. (os error 112) 1>&2
@exit /b 1
`;

it.live("a failed agent launch points at the prompt it could not run", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-triage-cli-" });
    const binDir = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-triage-bin-" });
    const codexHome = NodePath.join(baseDir, "codex-home");
    NodeFS.writeFileSync(NodePath.join(binDir, "codex"), FAILING_AGENT_POSIX, { mode: 0o755 });
    NodeFS.writeFileSync(NodePath.join(binDir, "codex.cmd"), FAILING_AGENT_WINDOWS);
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        vi.stubEnv("PATH", binDir);
        vi.stubEnv("CODEX_HOME", codexHome);
      }),
      () => Effect.sync(() => vi.unstubAllEnvs()),
    );
    const previousExitCode = process.exitCode;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        process.exitCode = previousExitCode;
      }),
    );

    yield* Command.runWith(cli, { version: "0.0.0" })([
      "triage",
      "--agent",
      "codex",
      "--base-dir",
      baseDir,
    ]);
    const output = (yield* TestConsole.logLines).join("\n");

    assert.equal(process.exitCode, 1);
    const promptFilePath = NodeFS.readdirSync(baseDir, { recursive: true, encoding: "utf8" })
      .filter((entry) => NodePath.basename(entry) === TRIAGE_PROMPT_FILE_NAME)
      .map((entry) => NodePath.join(baseDir, entry))[0];
    assert.isDefined(promptFilePath);
    assert.include(output, promptFilePath);
    assert.include(output, buildTriageLaunchPrompt(promptFilePath));
    assert.include(output, NodePath.join(NodePath.dirname(promptFilePath), "context.md"));
    assert.include(output, `Codex keeps its state in ${codexHome}.`);
    assert.include(output, "set CODEX_HOME to a folder on another drive");
  }).pipe(
    Effect.provide(
      Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, NetService.layer, TestConsole.layer),
    ),
  ),
);

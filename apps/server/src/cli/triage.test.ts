// @effect-diagnostics nodeBuiltinImport:off - CLI integration exercises the filesystem boundary.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@supaterm/shared/Net";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/cli";

import packageJson from "../../package.json" with { type: "json" };
import { cli } from "../binCli.ts";
import {
  makePersistedServerRuntimeState,
  persistServerRuntimeState,
} from "../serverRuntimeState.ts";
import { describeServerProcess } from "./triage.ts";
import { TRIAGE_PLAYBOOK } from "./triagePrompt.ts";

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
    Effect.provide(Layer.mergeAll(NodeServices.layer, NetService.layer, TestConsole.layer)),
  ),
);

it.effect("reports the version the running server recorded, not the CLI's", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const statePath = path.join(
      yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-triage-" }),
      "server-runtime.json",
    );
    const state = yield* makePersistedServerRuntimeState({
      config: { host: undefined, devUrl: undefined },
      port: 3773,
    });
    yield* persistServerRuntimeState({ path: statePath, state });

    assert.equal(
      yield* describeServerProcess(statePath),
      `running (pid ${String(process.pid)}, http://127.0.0.1:3773, version ${packageJson.version})`,
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

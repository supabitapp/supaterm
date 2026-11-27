#!/usr/bin/env node
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/cli";
import { ChildProcess } from "effect/process";

import * as HostProcess from "@supaterm/shared/HostProcess";

export const TailnetTarget = Schema.Literals([
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-arm64",
  "win32-x64",
]);
export type TailnetTarget = typeof TailnetTarget.Type;

const GO_TARGETS: Record<
  TailnetTarget,
  { readonly platform: NodeJS.Platform; readonly GOOS: string; readonly GOARCH: string }
> = {
  "darwin-arm64": { platform: "darwin", GOOS: "darwin", GOARCH: "arm64" },
  "darwin-x64": { platform: "darwin", GOOS: "darwin", GOARCH: "amd64" },
  "linux-arm64": { platform: "linux", GOOS: "linux", GOARCH: "arm64" },
  "linux-x64": { platform: "linux", GOOS: "linux", GOARCH: "amd64" },
  "win32-arm64": { platform: "win32", GOOS: "windows", GOARCH: "arm64" },
  "win32-x64": { platform: "win32", GOOS: "windows", GOARCH: "amd64" },
};

export const tailnetExecutableName = (platform: NodeJS.Platform): string =>
  platform === "win32" ? "supaterm-tailnet.exe" : "supaterm-tailnet";

export const TAILNET_BIN_DIR = "native/tailnet/bin";

export const tailnetTargetFile = (target: TailnetTarget): string =>
  `${target}/${tailnetExecutableName(GO_TARGETS[target].platform)}`;

class TailnetBuildError extends Schema.TaggedError<TailnetBuildError>()("TailnetBuildError", {
  target: Schema.String,
  exitCode: Schema.Number,
}) {
  override get message(): string {
    return `go build of the tailnet helper for ${this.target} exited with ${this.exitCode}.`;
  }
}

export const buildTailnet = Effect.fn("buildTailnet")(function* (input: {
  readonly repoRoot: string;
  readonly target: Option.Option<TailnetTarget>;
}) {
  const path = yield* Path.Path;
  const hostPlatform = yield* HostProcess.Platform;
  const output = path.join(
    input.repoRoot,
    TAILNET_BIN_DIR,
    Option.match(input.target, {
      onNone: () => tailnetExecutableName(hostPlatform),
      onSome: tailnetTargetFile,
    }),
  );
  const crossCompile = Option.match(input.target, {
    onNone: () => ({}),
    onSome: (target) => ({ GOOS: GO_TARGETS[target].GOOS, GOARCH: GO_TARGETS[target].GOARCH }),
  });
  const exitCode = yield* ChildProcess.make(
    "go",
    ["build", "-trimpath", "-buildvcs=false", "-ldflags", "-s -w", "-o", output, "."],
    {
      cwd: path.join(input.repoRoot, "native/tailnet"),
      env: { CGO_ENABLED: "0", ...crossCompile },
      extendEnv: true,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    },
  ).pipe(
    Effect.flatMap((child) => child.exitCode),
    Effect.scoped,
  );
  if (exitCode !== 0) {
    return yield* new TailnetBuildError({
      target: Option.getOrElse(input.target, () => "the host"),
      exitCode,
    });
  }
  return output;
});

const command = Command.make(
  "build-tailnet",
  {
    target: Flag.Literals("target", TailnetTarget.literals).pipe(
      Flag.withDescription(
        "Cross-compile for <platform>-<arch> into native/tailnet/bin/<target>/. Without it, builds native/tailnet/bin/supaterm-tailnet for this machine.",
      ),
      Flag.optional,
    ),
  },
  (input) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const output = yield* buildTailnet({
        repoRoot: path.dirname(import.meta.dirname),
        target: input.target,
      });
      yield* Effect.log(`[tailnet] Built ${output}`);
    }),
).pipe(Command.withDescription("Build the supaterm-tailnet helper with Go."));

if (import.meta.main) {
  Command.run(command, { version: "0.0.0" }).pipe(
    Effect.provide(Layer.mergeAll(Logger.layer([Logger.consolePretty()]), NodeServices.layer)),
    NodeRuntime.runMain,
  );
}

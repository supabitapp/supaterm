// @effect-diagnostics nodeBuiltinImport:off globalTimers:off -- The probe is a plain Node child; this deadline kills it if it hangs.
import * as NodeChildProcess from "node:child_process";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it } from "@effect/vitest";
import type { CursorConfigureOptions } from "@cursor/sdk";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Path from "effect/Path";
import { vi } from "vite-plus/test";

import * as CursorSdk from "./CursorSdk.ts";

const cursorSdkUrl = new URL("./CursorSdk.ts", import.meta.url).href;

// The vitest worker already has its own unhandledRejection listener, which
// would hide the process-exit behavior.
const probeProgram = `
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const dir = mkdtempSync(join(tmpdir(), "cursor-sdk-stub-"));
const stub = join(dir, "stub.cjs");
writeFileSync(
  stub,
  "module.exports = { Agent: {}, AuthenticationError: class {}, createAgentPlatform: () => ({}), Cursor: {}, CursorSdkError: class {}, InMemoryCredentialStore: class {} };",
);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@cursor/sdk" || specifier === "@cursor/sdk/sqlite") {
      return { url: pathToFileURL(stub).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const { layer } = await import(${JSON.stringify(cursorSdkUrl)});
const Effect = await import("effect/Effect");
const Layer = await import("effect/Layer");
const NodeServices = await import("@effect/platform-node/NodeServices");
const Exit = await import("effect/Exit");
const Scope = await import("effect/Scope");
const scope = Scope.makeUnsafe();
await Effect.runPromise(
  Layer.buildWithScope(layer.pipe(Layer.provide(NodeServices.layer)), scope),
);
const mode = process.argv[1];
const missingCwd = join(tmpdir(), "supaterm-missing-cwd-" + process.pid);

if (mode === "cursor-shell") {
  const child = spawn("/bin/zsh", ["-c", "dump_zsh_state >&4", "--", "true"], {
    cwd: missingCwd,
  });
  child.on("error", (error) => {
    Promise.reject(error);
  });
  setTimeout(() => process.exit(0), 500);
} else if (mode === "released") {
  await Effect.runPromise(Scope.close(scope, Exit.void));
  Promise.reject(
    Object.assign(new Error("spawn /bin/zsh ENOENT"), {
      code: "ENOENT",
      syscall: "spawn /bin/zsh",
      spawnargs: ["-c", "dump_zsh_state >&4"],
    }),
  );
  setTimeout(() => process.exit(0), 500);
} else if (mode === "other-spawn") {
  Promise.reject(
    Object.assign(new Error("spawn git ENOENT"), {
      code: "ENOENT",
      syscall: "spawn git",
      path: "git",
      spawnargs: ["status"],
    }),
  );
  setTimeout(() => process.exit(0), 500);
} else if (mode === "closed-stream-write") {
  // Shaped like the SDK's minified class: the constructor is not named after the error.
  class o extends Error {
    name = "WriteIterableClosedError";
  }
  Promise.reject(new o("WritableIterable is closed"));
  setTimeout(() => process.exit(0), 500);
} else if (mode === "write-after-end") {
  // Shaped like \`ConnectError.from(e, Code.Aborted)\` from the SDK's connect-node body pump.
  const cause = Object.assign(new Error("write after end"), { code: "ERR_STREAM_WRITE_AFTER_END" });
  Promise.reject(
    Object.assign(new Error("[aborted] write after end", { cause }), {
      name: "ConnectError",
      code: 10,
      rawMessage: "write after end",
    }),
  );
  setTimeout(() => process.exit(0), 500);
} else if (mode === "aborted-other") {
  const cause = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
  Promise.reject(
    Object.assign(new Error("[aborted] socket hang up", { cause }), {
      name: "ConnectError",
      code: 10,
    }),
  );
  setTimeout(() => process.exit(0), 500);
} else if (mode === "closed-stream-message") {
  Promise.reject(new Error("WritableIterable is closed"));
  setTimeout(() => process.exit(0), 500);
} else if (mode === "other-rejection") {
  Promise.reject(new Error("boom"));
  setTimeout(() => process.exit(0), 500);
} else if (mode === "spawn-without-listener") {
  spawn(process.execPath, ["-e", "process.exit(0)"], { cwd: missingCwd });
  setTimeout(() => process.exit(0), 500);
} else {
  console.error("Unknown cursor shell spawn guard probe: " + mode);
  process.exit(2);
}
`;

function runProbe(mode: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = NodeChildProcess.spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        "--disable-warning=ExperimentalWarning",
        "--input-type=module",
        "-e",
        probeProgram,
        mode,
      ],
      // A hung probe is killed so it cannot outlive the test.
      { stdio: ["ignore", "pipe", "pipe"], timeout: 5_000 },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

const sdkDefaults = vi.hoisted(() => ({ useHttp1ForAgent: undefined as boolean | undefined }));

// Holds the SDK's process-wide default the way it does: only keys present change, null clears.
vi.mock("./sdk.ts", () => ({
  loadCursorSdk: () => ({
    Cursor: {
      configure: ({ local }: CursorConfigureOptions) => {
        if (local !== undefined && "useHttp1ForAgent" in local) {
          sdkDefaults.useHttp1ForAgent = local.useHttp1ForAgent ?? undefined;
        }
      },
    },
  }),
  loadCursorSqlite: () => ({}),
}));

const withHost = (environment: NodeJS.ProcessEnv, home: string) =>
  Effect.provide(
    Layer.mergeAll(
      NodeServices.layer,
      Layer.succeed(HostProcess.Environment, environment),
      Layer.succeed(HostProcess.HomeDirectory, home),
    ),
  );

describe("Cursor shell spawn guard", () => {
  it("keeps the process alive when the SDK writes to a closed exec stream", async () => {
    const result = await runProbe("closed-stream-write");
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("wrote to a closed stream");
  });

  it("keeps the process alive when the SDK writes after its request stream ended", async () => {
    const result = await runProbe("write-after-end");
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("wrote to a closed stream");
  });

  it("still exits when only the message looks like a closed-stream write", async () => {
    const result = await runProbe("closed-stream-message");
    expect(result.code).toBe(1);
    expect(result.stderr).not.toContain("The server will keep running.");
  });

  it("still exits on aborted requests other than a write after end", async () => {
    const result = await runProbe("aborted-other");
    expect(result.code).toBe(1);
    expect(result.stderr).not.toContain("The server will keep running.");
  });
});

const http1 = JSON.stringify({ network: { useHttp1ForAgent: true } });

describe("CursorSdk agent transport", () => {
  it.effect.each([
    {
      name: "when set in CURSOR_CONFIG_DIR over XDG_CONFIG_HOME",
      env: { CURSOR_CONFIG_DIR: "config", XDG_CONFIG_HOME: "xdg" },
      file: "config/cli-config.json",
      text: http1,
      expected: true,
    },
    {
      name: "when set in XDG_CONFIG_HOME",
      env: { XDG_CONFIG_HOME: "xdg" },
      file: "xdg/cursor/cli-config.json",
      text: http1,
      expected: true,
    },
    {
      name: "when set in the home directory",
      env: {},
      file: "home/.cursor/cli-config.json",
      text: http1,
      expected: true,
    },
    {
      name: "when it is off",
      env: {},
      file: "home/.cursor/cli-config.json",
      text: JSON.stringify({ network: { useHttp1ForAgent: false } }),
      expected: undefined,
    },
    {
      name: "when the file is damaged",
      env: {},
      file: "home/.cursor/cli-config.json",
      text: "{",
      expected: undefined,
      warns: true,
    },
    { name: "when there is no file", env: {}, file: undefined, text: "", expected: undefined },
  ])("follows the Cursor CLI's HTTP/1.1 setting $name", ({ env, file, text, expected, warns }) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "supaterm-cursor-cli-config-",
      });
      if (file !== undefined) {
        yield* fileSystem.makeDirectory(path.dirname(path.join(root, file)), { recursive: true });
        yield* fileSystem.writeFileString(path.join(root, file), text);
      }
      const environment = Object.fromEntries(
        Object.entries(env).map(([key, directory]) => [key, path.join(root, directory)]),
      );
      const warnings: Array<unknown> = [];
      const captureWarnings = Logger.make(({ logLevel, message }) => {
        if (logLevel === "Warn") warnings.push(message);
      });
      yield* Effect.gen(function* () {
        const sdk = Context.get(yield* Layer.build(CursorSdk.layer), CursorSdk.CursorSdk);
        assert.isUndefined(sdkDefaults.useHttp1ForAgent);
        sdk.load();
        assert.strictEqual(sdkDefaults.useHttp1ForAgent, expected);
      }).pipe(
        Effect.scoped,
        withHost(environment, path.join(root, "home")),
        Effect.provide(Logger.layer([captureWarnings], { mergeWithExisting: false })),
      );
      assert.isUndefined(sdkDefaults.useHttp1ForAgent);
      assert.lengthOf(warnings, warns ? 1 : 0);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

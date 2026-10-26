// @effect-diagnostics nodeBuiltinImport:off globalTimers:off -- The probe is a plain Node child; this deadline kills it if it hangs.
import * as NodeChildProcess from "node:child_process";
import { describe, expect, it } from "vite-plus/test";

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
const Exit = await import("effect/Exit");
const Scope = await import("effect/Scope");
const scope = Scope.makeUnsafe();
await Effect.runPromise(Layer.buildWithScope(layer, scope));
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

describe("Cursor shell spawn guard", () => {
  it("keeps the process alive when the SDK writes to a closed exec stream", async () => {
    const result = await runProbe("closed-stream-write");
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("wrote to a closed exec stream");
  });

  it("still exits when only the message looks like a closed-stream write", async () => {
    const result = await runProbe("closed-stream-message");
    expect(result.code).toBe(1);
    expect(result.stderr).not.toContain("The server will keep running.");
  });
});

import * as NodeEvents from "node:events";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeVM from "node:vm";

import { assert, describe, it } from "vite-plus/test";

import {
  makeDevelopmentEnvironmentScript,
  makeDevelopmentLauncherScript,
  resolveElectronBinaryPath,
  resolveMacLauncherPaths,
  writeDevelopmentLauncherScript,
} from "./electron-launcher.mjs";

describe("electron development launcher", () => {
  it("uses captured values only as fallbacks for a live runner environment", () => {
    const environmentScript = makeDevelopmentEnvironmentScript({
      VITE_DEV_SERVER_URL: "http://127.0.0.1:8526",
      SUPATERM_PORT: "16566",
      SUPATERM_HOME: "/tmp/supaterm",
      SUPATERM_OTLP_PROTOCOL: "http/protobuf",
    });

    assert.include(
      environmentScript,
      "if [ -z \"${VITE_DEV_SERVER_URL:-}\" ]; then export VITE_DEV_SERVER_URL='http://127.0.0.1:8526'; fi",
    );
    assert.include(
      environmentScript,
      "if [ -z \"${SUPATERM_OTLP_PROTOCOL:-}\" ]; then export SUPATERM_OTLP_PROTOCOL='http/protobuf'; fi",
    );
    assert.notInclude(environmentScript, "\nexport VITE_DEV_SERVER_URL=");
  });

  it("keeps the launcher script free of volatile environment values", () => {
    const script = makeDevelopmentLauncherScript({
      electronBinaryPath: "/repo/node_modules/electron/Electron",
      mainEntryPath: "/repo/apps/desktop/dist-electron/main.cjs",
      desktopRoot: "/repo/apps/desktop",
      environmentFilePath: "/repo/apps/desktop/.electron-runtime/dev-environment.sh",
    });

    assert.include(
      script,
      "if [ -f '/repo/apps/desktop/.electron-runtime/dev-environment.sh' ]; then . '/repo/apps/desktop/.electron-runtime/dev-environment.sh'; fi",
    );
    assert.notInclude(script, "VITE_DEV_SERVER_URL");
    assert.include(
      script,
      "exec '/repo/node_modules/electron/Electron' --supaterm-dev-root='/repo/apps/desktop' '/repo/apps/desktop/dist-electron/main.cjs' \"$@\"",
    );
  });

  it("repairs Electron before loading the package entrypoint", () => {
    const calls = [];
    const electronPath = resolveElectronBinaryPath({
      ensureRuntime: () => {
        calls.push("ensure");
      },
      createRequire: () => (specifier) => {
        calls.push(`require:${specifier}`);
        return "/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron";
      },
      moduleUrl: import.meta.url,
    });

    assert.equal(
      electronPath,
      "/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
    );
    assert.deepEqual(calls, ["ensure", "require:electron"]);
  });

  it("keeps the native Electron executable name inside the branded macOS bundle", () => {
    const paths = resolveMacLauncherPaths(
      "/repo/apps/desktop/.electron-runtime/Supaterm (Dev).app",
      "Supaterm (Dev)",
    );

    assert.equal(paths.launcherExecutableName, "Supaterm (Dev) Launcher");
    assert.equal(
      paths.launcherBinaryPath,
      "/repo/apps/desktop/.electron-runtime/Supaterm (Dev).app/Contents/MacOS/Supaterm (Dev) Launcher",
    );
    assert.equal(
      paths.runtimeElectronBinaryPath,
      "/repo/apps/desktop/.electron-runtime/Supaterm (Dev).app/Contents/MacOS/Electron",
    );

    const script = makeDevelopmentLauncherScript({
      electronBinaryPath: paths.runtimeElectronBinaryPath,
      mainEntryPath: "/repo/apps/desktop/dist-electron/main.cjs",
      desktopRoot: "/repo/apps/desktop",
      environmentFilePath: "/repo/apps/desktop/.electron-runtime/dev-environment.sh",
    });
    assert.include(
      script,
      "exec '/repo/apps/desktop/.electron-runtime/Supaterm (Dev).app/Contents/MacOS/Electron'",
    );
    assert.notInclude(script, "node_modules/electron");
  });

  it("restores execute permissions on an unchanged launcher", () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "supaterm-launcher-"));
    const launcherPath = NodePath.join(directory, "launcher");
    try {
      writeDevelopmentLauncherScript(launcherPath, "/runtime/Electron");
      NodeFS.chmodSync(launcherPath, 0o644);

      assert.isFalse(writeDevelopmentLauncherScript(launcherPath, "/runtime/Electron"));
      assert.equal(NodeFS.statSync(launcherPath).mode & 0o777, 0o755);
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });
});

async function runDevElectronStartup({ desktopDir = "/repo/apps/desktop", spawn, ...context }) {
  const source = NodeFS.readFileSync(new URL("./dev-electron.mjs", import.meta.url), "utf8");
  await NodeVM.runInNewContext(
    `(async () => { ${source.replace(/^import\s[\s\S]*?;\n/gm, "")} })()`,
    {
      NodeChildProcess: {
        execFileSync: () => undefined,
        spawnSync: () => undefined,
        spawn: spawn ?? (() => new NodeEvents.EventEmitter()),
      },
      NodeFS: { watch: () => ({ close: () => undefined }) },
      NodeOS: { platform: () => "linux" },
      NodePath,
      desktopDir,
      resolveDevProtocolClient: () => null,
      resolveElectronLaunchCommand: (args) => ({ electronPath: "electron", args }),
      waitForResources: async () => undefined,
      URL,
      ...context,
    },
  );
}

function makeFakeClock() {
  let now = 0;
  let timers = [];
  const schedule = (callback, delay, repeat) => {
    const timer = { callback, due: now + (delay ?? 0), repeat: repeat ? (delay ?? 0) : null };
    timer.handle = { unref: () => timer.handle, ref: () => timer.handle };
    timers.push(timer);
    return timer.handle;
  };
  const clear = (handle) => {
    timers = timers.filter((timer) => timer.handle !== handle);
  };
  const flushMicrotasks = async () => {
    for (let index = 0; index < 50; index += 1) await Promise.resolve();
  };
  return {
    setTimeout: (callback, delay) => schedule(callback, delay, false),
    setInterval: (callback, delay) => schedule(callback, delay, true),
    clearTimeout: clear,
    clearInterval: clear,
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        await flushMicrotasks();
        const next = timers
          .filter((timer) => timer.due <= end)
          .toSorted((a, b) => a.due - b.due)[0];
        if (!next) break;
        now = next.due;
        if (next.repeat === null) clear(next.handle);
        else next.due = now + Math.max(next.repeat, 1);
        next.callback();
      }
      now = end;
      await flushMicrotasks();
    },
  };
}

it("dev supervisor stops Electron and exits once its parent process goes away", async () => {
  const clock = makeFakeClock();
  let ppid = 4242;
  const exitCodes = [];
  const appSignals = [];
  const app = new NodeEvents.EventEmitter();
  app.pid = 5151;
  let appExited = false;
  await runDevElectronStartup({
    ...clock,
    spawn: () => app,
    process: {
      env: { VITE_DEV_SERVER_URL: "http://localhost:1234" },
      execPath: "node",
      pid: 4343,
      get ppid() {
        return ppid;
      },
      kill: (pid, signal) => {
        if (pid !== -app.pid || appExited) return;
        appSignals.push(signal);
        appExited = true;
        app.emit("exit", null, signal);
      },
      once: () => undefined,
      exit: (code) => {
        exitCodes.push(code);
      },
    },
  });

  await clock.advance(5_000);
  assert.deepEqual(appSignals, [], "supervisor stopped Electron while its parent was alive");

  ppid = 1;
  await clock.advance(5_000);

  assert.include(
    appSignals,
    "SIGTERM",
    "supervisor kept Electron running after its parent process went away",
  );
  assert.lengthOf(exitCodes, 1, "supervisor did not exit after its parent process went away");
});

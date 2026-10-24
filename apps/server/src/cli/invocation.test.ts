import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import packageJson from "../../package.json" with { type: "json" };
import {
  resolveHostCliCommand,
  resolveRootCliCommand,
  resolveServerInstallation,
} from "./invocation.ts";

it.layer(NodeServices.layer)("root CLI commands", (it) => {
  const rootCommand = (input: {
    readonly node: string;
    readonly entry: string;
    readonly path?: string;
    readonly env?: Record<string, string>;
    readonly executable?: boolean;
  }) =>
    resolveRootCliCommand("browser setup").pipe(
      Effect.provideService(HostProcess.ExecutablePath, input.node),
      Effect.provideService(HostProcess.Arguments, [input.node, input.entry]),
      Effect.provideService(HostProcess.IsExecutable, input.executable ?? false),
      Effect.provideService(HostProcess.Platform, "linux"),
      Effect.provideService(HostProcess.Environment, { PATH: input.path ?? "", ...input.env }),
    );

  const pathWithSupaterm = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const bin = yield* fs.makeTempDirectoryScoped();
    yield* fs.writeFileString(path.join(bin, "supaterm"), "#!/bin/sh\n", { mode: 0o755 });
    return bin;
  });

  it.effect("keeps a user-installed Node reachable when the command runs under sudo", () =>
    Effect.gen(function* () {
      const npx = "/home/theo/.npm/_npx/abc/node_modules/supaterm/dist/bin.mjs";
      // sudo's secure_path already has a system Node.
      expect(yield* rootCommand({ node: "/usr/bin/node", entry: npx })).toBe(
        "sudo npx supaterm browser setup",
      );
      // nvm, fnm, and tarball installs are dropped by sudo's PATH reset.
      expect(
        yield* rootCommand({ node: "/home/theo/.nvm/versions/node/v24/bin/node", entry: npx }),
      ).toBe('sudo env "PATH=$PATH" npx supaterm browser setup');
      expect(
        yield* rootCommand({
          node: "/home/theo/.local/node/bin/node",
          entry: "/home/theo/.local/lib/node_modules/supaterm/dist/bin.mjs",
          path: yield* pathWithSupaterm,
        }),
      ).toBe('sudo env "PATH=$PATH" supaterm browser setup');
    }).pipe(Effect.scoped),
  );

  it.effect("runs the current script install when WSL has no global command or desktop shim", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped();
      const entry = path.join(root, "wsl runtime", "bin.mjs");
      yield* fs.makeDirectory(path.dirname(entry), { recursive: true });
      yield* fs.writeFileString(entry, "");
      expect(yield* rootCommand({ node: "/opt/runtime/node", entry })).toBe(
        `sudo /opt/runtime/node '${entry}' browser setup`,
      );
      expect(
        yield* rootCommand({
          node: "/opt/runtime/electron",
          entry,
          env: { ELECTRON_RUN_AS_NODE: "1" },
        }),
      ).toBe(`sudo env ELECTRON_RUN_AS_NODE=1 /opt/runtime/electron '${entry}' browser setup`);
    }).pipe(Effect.scoped),
  );

  it.effect("names this install's launcher when supaterm is not on PATH", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped();
      const shim = path.join(home, ".local bin", "supaterm");
      yield* fs.makeDirectory(path.dirname(shim), { recursive: true });
      yield* fs.writeFileString(shim, "#!/bin/sh\n", { mode: 0o755 });
      const desktop = {
        node: "/tmp/.mount_Supatermabc/supaterm",
        entry: "/tmp/.mount_Supatermabc/resources/app.asar/apps/server/dist/bin.mjs",
        env: { SUPATERM_CLI_SHIM_PATH: shim },
      };

      expect(yield* rootCommand(desktop)).toBe(`sudo '${shim}' browser setup`);

      expect(yield* rootCommand({ ...desktop, path: yield* pathWithSupaterm })).toBe(
        'sudo env "PATH=$PATH" supaterm browser setup',
      );

      expect(
        yield* rootCommand({
          node: "/opt/supaterm/supaterm",
          entry: "/opt/supaterm/supaterm",
          executable: true,
        }),
      ).toBe("sudo /opt/supaterm/supaterm browser setup");

      expect(
        yield* rootCommand({
          ...desktop,
          env: { SUPATERM_CLI_SHIM_PATH: path.join(home, "gone") },
        }),
      ).toBe('sudo env "PATH=$PATH" supaterm browser setup');
    }).pipe(Effect.scoped),
  );
});

it.layer(NodeServices.layer)("host CLI commands", (it) => {
  it.effect("renders a PowerShell command line on Windows", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped();
      const shim = path.join(home, "supaterm.cmd");
      yield* fs.writeFileString(shim, "@echo off\r\n");
      const hostCommand = (platform: NodeJS.Platform, env: Record<string, string>) =>
        resolveHostCliCommand("doctor", ["--base-dir", "C:\\Users\\Jane Doe\\.supaterm"]).pipe(
          Effect.provideService(
            HostProcess.ExecutablePath,
            "C:\\Program Files\\Supaterm\\supaterm.exe",
          ),
          Effect.provideService(HostProcess.Arguments, [
            "C:\\Program Files\\Supaterm\\supaterm.exe",
            "C:\\Program Files\\Supaterm\\resources\\app.asar\\apps\\server\\dist\\bin.mjs",
          ]),
          Effect.provideService(HostProcess.IsExecutable, false),
          Effect.provideService(HostProcess.Platform, platform),
          Effect.provideService(HostProcess.Environment, { PATH: "", ...env }),
        );
      // The desktop shim is called through `&`, and each argument is quoted
      // the PowerShell way: no POSIX single quotes anywhere.
      expect((yield* hostCommand("win32", { SUPATERM_CLI_SHIM_PATH: shim })).command).toBe(
        `& "${shim}" doctor "--base-dir" "C:\\Users\\Jane Doe\\.supaterm"`,
      );
      // Without a launcher, plain `supaterm` with PowerShell-quoted arguments.
      expect((yield* hostCommand("win32", {})).command).toBe(
        'supaterm doctor "--base-dir" "C:\\Users\\Jane Doe\\.supaterm"',
      );
      // Typographic quotes also delimit PowerShell strings; doubling keeps them.
      expect(
        (yield* resolveHostCliCommand("doctor", [
          "--base-dir",
          "C:\\Supaterm\\\u201CArchive\u201D",
        ]).pipe(
          Effect.provideService(HostProcess.Platform, "win32"),
          Effect.provideService(HostProcess.Environment, { PATH: "" }),
          Effect.provideService(HostProcess.ExecutablePath, "C:\\supaterm.exe"),
          Effect.provideService(HostProcess.Arguments, ["C:\\supaterm.exe", "C:\\bin.mjs"]),
          Effect.provideService(HostProcess.IsExecutable, false),
        )).command,
      ).toBe('supaterm doctor "--base-dir" "C:\\Supaterm\\\u201C\u201CArchive\u201D\u201D"');
      // POSIX hosts keep single quotes for the same input. The shim prefix is
      // a host path, so only the arguments are asserted.
      expect((yield* hostCommand("linux", { SUPATERM_CLI_SHIM_PATH: shim })).command).toMatch(
        / doctor --base-dir 'C:\\Users\\Jane Doe\\\.supaterm'$/,
      );
    }).pipe(Effect.scoped),
  );
});

it.layer(NodeServices.layer)("host CLI commands through an Electron runtime", (it) => {
  it.effect("runs the entrypoint as Node in the host's shell syntax", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped();
      const entry = path.join(root, "bin.mjs");
      yield* fs.writeFileString(entry, "");
      const hostCommand = (platform: NodeJS.Platform) =>
        resolveHostCliCommand("doctor", ["--base-dir", "/home/jane/.supaterm"]).pipe(
          Effect.provideService(HostProcess.ExecutablePath, "/opt/supaterm/supaterm"),
          Effect.provideService(HostProcess.Arguments, ["/opt/supaterm/supaterm", entry]),
          Effect.provideService(HostProcess.IsExecutable, false),
          Effect.provideService(HostProcess.Platform, platform),
          Effect.provideService(HostProcess.Environment, { PATH: "", ELECTRON_RUN_AS_NODE: "1" }),
        );
      expect((yield* hostCommand("linux")).command).toBe(
        `env ELECTRON_RUN_AS_NODE=1 /opt/supaterm/supaterm ${entry} doctor --base-dir /home/jane/.supaterm`,
      );
      expect((yield* hostCommand("win32")).command).toBe(
        `$env:ELECTRON_RUN_AS_NODE=1; & "/opt/supaterm/supaterm" "${entry}" doctor "--base-dir" "/home/jane/.supaterm"`,
      );
    }).pipe(Effect.scoped),
  );
});

it.layer(NodeServices.layer)("manual server installation ownership", (it) => {
  it.effect("recognizes runner caches for script packages and the npm launcher", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped().pipe(Effect.flatMap(fs.realPath));
      const executable = path.join(root, ".supaterm/runtime/versions/26.10.1/supaterm");
      yield* fs.makeDirectory(path.dirname(executable), { recursive: true });
      yield* fs.writeFileString(executable, "");
      for (const [relative, kind] of [
        ["npm/_npx/hash/node_modules/supaterm/dist/bin.mjs", "npx"],
        ["npm/_npx/hash/node_modules/supaterm/bin/supaterm.mjs", "npx"],
        ["pnpm/dlx/hash/node_modules/supaterm/dist/bin.mjs", "pnpm-dlx"],
        [".bun/install/cache/supaterm/dist/bin.mjs", "bunx"],
      ] as const) {
        const entry = path.join(root, relative);
        yield* fs.makeDirectory(path.dirname(entry), { recursive: true });
        yield* fs.writeFileString(entry, "");
        yield* fs.writeFileString(
          path.join(path.dirname(entry), "../package.json"),
          `{"name":"supaterm","version":"${packageJson.version}","bin":{"supaterm":"./bin/supaterm.mjs"}}`,
        );
        const launchedBy = entry.endsWith("supaterm.mjs");
        const installation = yield* resolveServerInstallation.pipe(
          Effect.provideService(HostProcess.Arguments, [launchedBy ? executable : "node", entry]),
          Effect.provideService(HostProcess.ExecutablePath, executable),
          Effect.provideService(HostProcess.IsExecutable, launchedBy),
          Effect.provideService(
            HostProcess.Environment,
            launchedBy ? { SUPATERM_NPM_LAUNCHER_PATH: entry } : {},
          ),
        );
        expect(installation).toEqual({ kind });
      }
    }),
  );

  it.effect("requires the npm prefix's bin to point to the running package", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped().pipe(Effect.flatMap(fs.realPath));
      const prefix = path.join(root, "bunx-tools");
      const packageRoot = path.join(prefix, "lib/node_modules/supaterm");
      const entry = path.join(packageRoot, "bin/supaterm.mjs");
      const globalBin = path.join(prefix, "bin/supaterm");
      yield* fs.makeDirectory(path.dirname(entry), { recursive: true });
      yield* fs.makeDirectory(path.dirname(globalBin), { recursive: true });
      yield* fs.writeFileString(entry, "");
      yield* fs.writeFileString(
        path.join(packageRoot, "package.json"),
        '{"name":"supaterm","version":"0.0.45","bin":{"supaterm":"./bin/supaterm.mjs"}}',
      );
      const resolve = resolveServerInstallation.pipe(
        Effect.provideService(HostProcess.Arguments, ["node", entry]),
        Effect.provideService(HostProcess.IsExecutable, false),
        Effect.provideService(HostProcess.Platform, "linux"),
      );
      expect(yield* resolve).toBeNull();
      yield* fs.symlink(entry, globalBin);
      expect(yield* resolve).toEqual({ kind: "npm-global", prefix });
      yield* fs.remove(globalBin);
      yield* fs.writeFileString(globalBin, "an unrelated supaterm command");
      expect(yield* resolve).toBeNull();
      expect(yield* resolve.pipe(Effect.provideService(HostProcess.Platform, "win32"))).toBeNull();
    }),
  );

  it.effect("proves the downloaded executable was started by a global npm launcher", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped().pipe(Effect.flatMap(fs.realPath));
      const prefix = path.join(root, "bunx-tools");
      const packageRoot = path.join(prefix, "lib/node_modules/supaterm");
      const launcher = path.join(packageRoot, "bin/supaterm.mjs");
      const executable = path.join(root, ".supaterm/runtime/versions/26.10.1/supaterm");
      yield* fs.makeDirectory(path.dirname(launcher), { recursive: true });
      yield* fs.makeDirectory(path.dirname(executable), { recursive: true });
      yield* fs.makeDirectory(path.join(prefix, "bin"));
      yield* fs.writeFileString(launcher, "");
      yield* fs.writeFileString(executable, "");
      yield* fs.symlink(launcher, path.join(prefix, "bin/supaterm"));
      const resolve = resolveServerInstallation.pipe(
        Effect.provideService(HostProcess.ExecutablePath, executable),
        Effect.provideService(HostProcess.Arguments, [executable, executable]),
        Effect.provideService(HostProcess.IsExecutable, true),
        Effect.provideService(HostProcess.Platform, "linux"),
        Effect.provideService(HostProcess.Environment, { SUPATERM_NPM_LAUNCHER_PATH: launcher }),
      );
      // A launcher for another version is some other `supaterm` the server spawned
      // (the variable is inherited), not the install this executable runs from.
      for (const [version, expected] of [
        ["26.0.1", null],
        [packageJson.version, { kind: "npm-global", prefix }],
      ] as const) {
        yield* fs.writeFileString(
          path.join(packageRoot, "package.json"),
          `{"name":"supaterm","version":"${version}","bin":{"supaterm":"./bin/supaterm.mjs"}}`,
        );
        expect(yield* resolve).toEqual(expected);
      }
    }),
  );

  it.effect("leaves local, standalone, missing and unreadable installs unknown", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped().pipe(Effect.flatMap(fs.realPath));
      for (const relative of [
        "project/node_modules/supaterm/dist/bin.mjs",
        "project/apps/server/dist/bin.mjs",
        ".supaterm/runtime/0.0.45/supaterm",
        "missing/dist/bin.mjs",
      ]) {
        const entry = path.join(root, relative);
        if (!relative.startsWith("missing")) {
          yield* fs.makeDirectory(path.dirname(entry), { recursive: true });
          yield* fs.writeFileString(entry, "");
        }
        expect(
          yield* resolveServerInstallation.pipe(
            Effect.provideService(HostProcess.Arguments, ["node", entry]),
            Effect.provideService(HostProcess.IsExecutable, false),
          ),
        ).toBeNull();
      }
    }),
  );
});

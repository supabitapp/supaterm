// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";

import { buildTriageContext, buildTriageLaunchPrompt, TRIAGE_PLAYBOOK } from "./triagePrompt.ts";

it("stays byte-identical to .github/triage/PLAYBOOK.md", () => {
  // Old releases fetch the repo copy from `main` and follow it when it differs
  // from their bundled playbook. The two must say the same thing at HEAD, or a
  // playbook edit silently changes behavior only for old (or only for new)
  // installs.
  const canonicalPath = NodePath.join(
    import.meta.dirname,
    "../../../../.github/triage/PLAYBOOK.md",
  );
  assert.equal(TRIAGE_PLAYBOOK, NodeFS.readFileSync(canonicalPath, "utf8"));
});

it("launch prompt stays a single argv-safe line naming the prompt file", () => {
  // The launch argument goes through cmd.exe on Windows (.cmd shims), which
  // cannot carry newlines; the playbook itself must stay on disk.
  const launch = buildTriageLaunchPrompt(
    String.raw`C:\Users\a b\.supaterm\userdata\triage\x\prompt.md`,
  );
  assert.notInclude(launch, "\n");
  assert.include(launch, String.raw`C:\Users\a b\.supaterm\userdata\triage\x\prompt.md`);
  assert.isBelow(launch.length, 1_000);
});

it("context file labels the CLI version as the CLI's, not the user's build", () => {
  // `npx supaterm triage` can resolve a different `supaterm` than the app the bug
  // happened on, so the agent must not read it as the user's version.
  const context = buildTriageContext({
    generatedAt: "2026-09-24T00:00:00.000Z",
    cliVersion: "26.10.1",
    os: "linux x64 (7.2.0)",
    nodeVersion: "v26.8.2",
    launchedAs: "npx supaterm triage",
    server: "running (pid 42, http://127.0.0.1:3773, version 26.10.2-nightly.20261016.227)",
    paths: {
      stateDir: "/home/u/.supaterm/userdata",
      dbPath: "/home/u/.supaterm/userdata/state.sqlite",
      settingsPath: "/home/u/.supaterm/userdata/settings.json",
      logsDir: "/home/u/.supaterm/userdata/logs",
      serviceLogPath: "/home/u/.supaterm/userdata/logs/boot-service.log",
      desktopBackendLogGlob: "/home/u/.supaterm/userdata/logs/server-child*.log*",
      serverTracePath: "/home/u/.supaterm/userdata/logs/server.trace.ndjson",
      providerEventLogPath: "/home/u/.supaterm/userdata/logs/provider/events.log",
      terminalLogsDir: "/home/u/.supaterm/userdata/logs/terminals",
      providerStatusCacheDir: "/home/u/.supaterm/caches",
      secretsDir: "/home/u/.supaterm/userdata/secrets",
      sourceCacheDir: "/home/u/.supaterm/source",
    },
  });
  assert.notInclude(context, "Installed version");
  assert.notInclude(context, "Release tag");
  assert.include(context, "- Triage CLI version: 26.10.1 (");
  assert.include(context, "version 26.10.2-nightly.20261016.227");
});

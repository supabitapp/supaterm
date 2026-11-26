// @effect-diagnostics nodeBuiltinImport:off - CLI integration exercises the filesystem boundary.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NetService from "@supaterm/shared/Net";
import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ConfigProvider from "effect/ConfigProvider";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/cli";
import type { ManagedPolicyDocument } from "@supaterm/contracts";

import { cli } from "../binCli.ts";

const settingsPathFor = (baseDir: string) => NodePath.join(baseDir, "userdata", "settings.json");
const makeBaseDir = () =>
  NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "supaterm-settings-cli-"));
const runCli = (args: ReadonlyArray<string>) =>
  Command.runWith(cli, { version: "0.0.0" })(args).pipe(
    Effect.provide(
      Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, NetService.layer, TestConsole.layer),
    ),
  );

// Source builds read the policy from this variable, so a test never needs the machine's.
const withPolicy = (directory: string, policy: ManagedPolicyDocument) => {
  const policyPath = NodePath.join(directory, "policy.json");
  NodeFS.writeFileSync(policyPath, JSON.stringify(policy));
  return Effect.provide(
    ConfigProvider.layer(
      ConfigProvider.fromEnv({ env: { SUPATERM_DEV_MANAGED_POLICY_PATH: policyPath } }),
    ),
  );
};

const captureStdout = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    yield* effect;
    return (
      (yield* TestConsole.logLines).findLast((line): line is string => typeof line === "string") ??
      ""
    );
  });

describe("supaterm settings", () => {
  it.effect("sets relay state without dropping unknown settings", () =>
    Effect.gen(function* () {
      const baseDir = makeBaseDir();
      const settingsPath = settingsPathFor(baseDir);
      NodeFS.mkdirSync(NodePath.dirname(settingsPath), { recursive: true });
      NodeFS.writeFileSync(
        settingsPath,
        JSON.stringify({ futureSetting: { keep: true }, publicRelayUrl: "wss://old.example" }),
      );

      const output = yield* captureStdout(
        runCli(["settings", "set", "publicRelayEnabled", "true", "--base-dir", baseDir]),
      );

      expect(JSON.parse(NodeFS.readFileSync(settingsPath, "utf8"))).toEqual({
        futureSetting: { keep: true },
        publicRelayUrl: "wss://old.example",
        publicRelayEnabled: true,
      });
      assert.include(output, "Set publicRelayEnabled");
    }),
  );

  it.effect("updates relay state when the file contains legacy or invalid unrelated values", () =>
    Effect.gen(function* () {
      const baseDir = makeBaseDir();
      const settingsPath = settingsPathFor(baseDir);
      NodeFS.mkdirSync(NodePath.dirname(settingsPath), { recursive: true });
      NodeFS.writeFileSync(
        settingsPath,
        JSON.stringify({ responseStreamingMode: "token", addProjectBaseDirectory: 42 }),
      );

      yield* runCli(["settings", "set", "publicRelayEnabled", "true", "--base-dir", baseDir]);

      expect(JSON.parse(NodeFS.readFileSync(settingsPath, "utf8"))).toEqual({
        responseStreamingMode: "token",
        addProjectBaseDirectory: 42,
        publicRelayEnabled: true,
      });
    }),
  );

  it.effect("reads effective defaults and validates relay URLs", () =>
    Effect.gen(function* () {
      const baseDir = makeBaseDir();
      const defaultValue = yield* captureStdout(
        runCli(["settings", "get", "publicRelayEnabled", "--base-dir", baseDir]),
      );
      assert.equal(defaultValue, "true");

      yield* runCli([
        "settings",
        "set",
        "publicRelayUrl",
        "wss://relay.example",
        "--base-dir",
        baseDir,
      ]);
      const value = yield* captureStdout(
        runCli(["settings", "get", "publicRelayUrl", "--base-dir", baseDir]),
      );
      assert.equal(value, '"wss://relay.example"');

      const failure = yield* Effect.flip(
        runCli([
          "settings",
          "set",
          "publicRelayUrl",
          "http://relay.example",
          "--base-dir",
          baseDir,
        ]),
      );
      assert.include(String(failure), "Invalid value for publicRelayUrl");
    }),
  );

  it.effect("honors SUPATERM_HOME before linked-worktree fallback", () =>
    Effect.gen(function* () {
      const baseDir = makeBaseDir();
      yield* runCli(["settings", "set", "publicRelayEnabled", "false"]).pipe(
        Effect.provide(
          ConfigProvider.layer(ConfigProvider.fromEnv({ env: { SUPATERM_HOME: baseDir } })),
        ),
      );

      expect(JSON.parse(NodeFS.readFileSync(settingsPathFor(baseDir), "utf8"))).toEqual({
        publicRelayEnabled: false,
      });
    }),
  );

  it.effect("accepts a locked setting's own value without writing and refuses any other", () =>
    Effect.gen(function* () {
      const baseDir = makeBaseDir();
      const settingsPath = settingsPathFor(baseDir);
      NodeFS.mkdirSync(NodePath.dirname(settingsPath), { recursive: true });
      NodeFS.writeFileSync(settingsPath, JSON.stringify({ publicRelayUrl: "wss://old.example" }));
      const underPolicy = withPolicy(baseDir, {
        schemaVersion: 1,
        organization: "Example Corp",
        settings: { publicRelayUrl: { value: "wss://relay.example.com", locked: true } },
      });
      const set = (value: string) =>
        runCli(["settings", "set", "publicRelayUrl", value, "--base-dir", baseDir]).pipe(
          underPolicy,
        );

      const unchanged = yield* captureStdout(set("wss://relay.example.com"));
      assert.include(unchanged, "managed by Example Corp");
      // The user's own value stays, ready for when the policy is removed.
      expect(JSON.parse(NodeFS.readFileSync(settingsPath, "utf8"))).toEqual({
        publicRelayUrl: "wss://old.example",
      });

      const refused = yield* Effect.flip(set("wss://other.example"));
      assert.include(
        String(refused),
        "publicRelayUrl is managed by Example Corp and cannot be changed.",
      );
      expect(JSON.parse(NodeFS.readFileSync(settingsPath, "utf8"))).toEqual({
        publicRelayUrl: "wss://old.example",
      });

      const effective = yield* captureStdout(
        runCli(["settings", "get", "publicRelayUrl", "--base-dir", baseDir]).pipe(underPolicy),
      );
      assert.equal(effective, '"wss://relay.example.com"');
    }),
  );

  it.effect("saves a runtime mode above the policy's ceiling and says what applies", () =>
    Effect.gen(function* () {
      const baseDir = makeBaseDir();
      const output = yield* captureStdout(
        runCli([
          "settings",
          "set",
          "defaultRuntimeMode",
          "full-access",
          "--base-dir",
          baseDir,
        ]).pipe(
          withPolicy(baseDir, {
            schemaVersion: 1,
            organization: "Example Corp",
            limits: { maxRuntimeMode: "auto-accept-edits" },
          }),
        ),
      );

      expect(JSON.parse(NodeFS.readFileSync(settingsPathFor(baseDir), "utf8"))).toEqual({
        defaultRuntimeMode: "full-access",
      });
      assert.include(output, 'Example Corp\'s policy lowers it to "auto-accept-edits"');
    }),
  );

  it.effect("rejects unknown settings and malformed boolean values", () =>
    Effect.gen(function* () {
      const baseDir = makeBaseDir();
      const unknown = yield* Effect.flip(
        runCli(["settings", "set", "notASetting", "true", "--base-dir", baseDir]),
      );
      assert.include(String(unknown), "Unknown setting");

      const invalid = yield* Effect.flip(
        runCli(["settings", "set", "publicRelayEnabled", "yes", "--base-dir", baseDir]),
      );
      assert.include(String(invalid), "Expected true or false");
    }),
  );

  it.effect("lists the supported operational settings", () =>
    Effect.gen(function* () {
      const output = yield* captureStdout(runCli(["settings", "list"]));
      assert.include(output, "publicRelayEnabled\ttrue or false");
      assert.include(output, "enableAgentBrowserAccess\ttrue or false");
      assert.include(
        output,
        "defaultRuntimeMode\tapproval-required | auto-accept-edits | auto | full-access",
      );
    }),
  );
});

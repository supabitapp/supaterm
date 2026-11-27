// @effect-diagnostics nodeBuiltinImport:off - CLI integration exercises the filesystem boundary.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import type { ManagedPolicyDocument } from "@supaterm/contracts";
import * as NetService from "@supaterm/shared/Net";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/cli";

import { cli } from "../binCli.ts";

const runUnderPolicy = (
  policy: ManagedPolicyDocument,
  args: ReadonlyArray<string>,
  stored?: Record<string, unknown>,
) => {
  const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "supaterm-tailscale-cli-"));
  const policyPath = NodePath.join(baseDir, "policy.json");
  NodeFS.writeFileSync(policyPath, JSON.stringify(policy));
  const settingsPath = NodePath.join(baseDir, "userdata", "settings.json");
  if (stored !== undefined) {
    NodeFS.mkdirSync(NodePath.dirname(settingsPath), { recursive: true });
    NodeFS.writeFileSync(settingsPath, JSON.stringify(stored));
  }
  const tailnet = () =>
    NodeFS.existsSync(settingsPath)
      ? JSON.parse(NodeFS.readFileSync(settingsPath, "utf8")).tailnet
      : undefined;
  const run = (extra: ReadonlyArray<string>) =>
    Command.runWith(cli, { version: "0.0.0" })(["tailscale", ...extra, "--base-dir", baseDir]).pipe(
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          NodeCrypto.layer,
          NetService.layer,
          TestConsole.layer,
          ConfigProvider.layer(
            ConfigProvider.fromEnv({ env: { SUPATERM_DEV_MANAGED_POLICY_PATH: policyPath } }),
          ),
        ),
      ),
    );
  return { result: run(args), run, tailnet };
};

const HOSTNAME_LOCKED: ManagedPolicyDocument = {
  schemaVersion: 1,
  organization: "Example Corp",
  settings: { "tailnet.hostname": { value: "studio", locked: true } },
};

describe("supaterm tailscale", () => {
  it.effect("refuses to turn on when the policy leaves out remote clients", () =>
    Effect.gen(function* () {
      const { result, tailnet } = runUnderPolicy(
        { schemaVersion: 1, organization: "Example Corp", limits: { clients: ["desktop"] } },
        ["on"],
      );
      const refused = yield* Effect.flip(result);
      expect(refused.message).toBe(
        "Example Corp's policy does not allow remote clients, so built-in Tailscale cannot be turned on.",
      );
      expect(tailnet()).toBeUndefined();
    }),
  );

  it.effect("refuses only the field a policy locks and keeps the user's own value", () =>
    Effect.gen(function* () {
      const { result, run, tailnet } = runUnderPolicy(
        HOSTNAME_LOCKED,
        ["on", "--hostname", "other-name"],
        { tailnet: { hostname: "original" } },
      );
      const refused = yield* Effect.flip(result);
      expect(refused.message).toBe(
        "tailnet.hostname is managed by Example Corp and cannot be changed.",
      );
      expect(tailnet()).toEqual({ hostname: "original" });

      yield* run(["on", "--hostname", "studio"]);
      expect(tailnet()).toEqual({ hostname: "original", enabled: true });
      yield* run(["off"]);
      expect(tailnet()).toEqual({ hostname: "original", enabled: false });
    }),
  );
});

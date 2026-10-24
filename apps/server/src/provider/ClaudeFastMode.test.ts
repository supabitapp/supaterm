import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import type { ServerProviderModel } from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { filterClaudeFastModeModels, makeClaudeFastModeAvailability } from "./ClaudeFastMode.ts";
import type { ClaudeCapabilitiesProbe } from "./ClaudeProvider.ts";

const probe = (overrides: Partial<ClaudeCapabilitiesProbe> = {}): ClaudeCapabilitiesProbe => ({
  email: "test@example.com",
  subscriptionType: "max",
  tokenSource: undefined,
  apiKeySource: "none",
  apiProvider: "firstParty",
  slashCommands: [],
  ...overrides,
});

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-fast-mode-" });
  const file = path.join(dir, ".claude.json");
  const write = (enabled: boolean) =>
    fs.writeFileString(file, JSON.stringify({ penguinModeOrgEnabled: enabled }));
  return { fs, file, write };
});

it.layer(NodeServices.layer)("Claude Fast availability", (it) => {
  it.effect(
    "reads cached denial before initialization and recovers without rewriting preferences",
    () =>
      Effect.gen(function* () {
        const { fs, file, write } = yield* fixture;
        yield* write(false);
        const fast = yield* makeClaudeFastModeAvailability(file, {});
        assert.isTrue(yield* fast.isBlocked);
        yield* fast.update(probe({ fastModeDisabledReason: "sdk_opt_in_required" }));
        yield* fast.refresh;
        assert.isTrue(yield* fast.isBlocked);
        yield* write(true);
        assert.isTrue(yield* fast.isBlocked);
        assert.isFalse(yield* fast.refresh);
        assert.isFalse(yield* fast.isBlocked);
        yield* write(false);
        assert.isFalse(yield* fast.isBlocked);
        assert.isTrue(yield* fast.refresh);
        yield* fs.writeFileString(file, "invalid");
        yield* fast.refresh;
        assert.isFalse(yield* fast.isBlocked);
        yield* fs.remove(file);
        yield* fast.refresh;
        assert.isFalse(yield* fast.isBlocked);
      }).pipe(Effect.scoped),
  );

  it.effect("keeps cached denials local to the instance's config directory", () =>
    Effect.gen(function* () {
      const first = yield* fixture;
      const second = yield* fixture;
      yield* first.write(false);
      yield* second.write(true);
      const one = yield* makeClaudeFastModeAvailability(first.file, {});
      const two = yield* makeClaudeFastModeAvailability(second.file, {});
      assert.isTrue(yield* one.isBlocked);
      assert.isFalse(yield* two.isBlocked);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "does not apply a probe's account denial to a config directory that varies by cwd",
    () =>
      Effect.gen(function* () {
        const { file, write } = yield* fixture;
        yield* write(false);
        const fast = yield* makeClaudeFastModeAvailability(file, {
          CLAUDE_CONFIG_DIR: ".claude-local",
        });
        yield* fast.update(probe({ fastModeDisabledReason: "extra_usage_disabled" }));
        yield* fast.refresh;
        assert.isFalse(yield* fast.isBlocked);
      }).pipe(Effect.scoped),
  );

  it.effect("applies cached org denials behind gateways and explicit credentials", () =>
    Effect.gen(function* () {
      const { file, write } = yield* fixture;
      yield* write(false);
      for (const environment of [
        { ANTHROPIC_API_KEY: "test-key" },
        { ANTHROPIC_AUTH_TOKEN: "test-token" },
        { CLAUDE_CODE_OAUTH_TOKEN: "test-token" },
        { ANTHROPIC_BASE_URL: "https://gateway.example.com", ANTHROPIC_AUTH_TOKEN: "test-token" },
      ]) {
        const fast = yield* makeClaudeFastModeAvailability(file, environment);
        assert.isTrue(yield* fast.isBlocked);
      }
      const fast = yield* makeClaudeFastModeAvailability(file, {});
      for (const account of [
        { tokenSource: "ANTHROPIC_AUTH_TOKEN" },
        { tokenSource: "claude.ai" },
        { tokenSource: "CLAUDE_CODE_OAUTH_TOKEN" },
        { apiKeySource: "ANTHROPIC_API_KEY" },
        { apiKeySource: "apiKeyHelper" },
      ]) {
        yield* fast.update(probe({ ...account, fastModeDisabledReason: "sdk_opt_in_required" }));
        assert.isTrue(yield* fast.refresh);
      }
    }).pipe(Effect.scoped),
  );

  it.effect("skips the cached org check only when Claude Code skips it", () =>
    Effect.gen(function* () {
      const { file, write } = yield* fixture;
      yield* write(false);
      const disabled = yield* makeClaudeFastModeAvailability(file, {
        CLAUDE_CODE_DISABLE_FAST_MODE: "1",
        CLAUDE_CODE_SKIP_FAST_MODE_ORG_CHECK: "1",
      });
      assert.isTrue(yield* disabled.isBlocked);
      for (const value of ["1", "true", "yes", "on", " TRUE ", " Yes "]) {
        const skipped = yield* makeClaudeFastModeAvailability(file, {
          CLAUDE_CODE_SKIP_FAST_MODE_ORG_CHECK: value,
        });
        assert.isFalse(yield* skipped.isBlocked);
        const disabled = yield* makeClaudeFastModeAvailability(file, {
          CLAUDE_CODE_DISABLE_FAST_MODE: value,
        });
        assert.isTrue(yield* disabled.isBlocked);
      }
    }).pipe(Effect.scoped),
  );

  it.effect(
    "blocks definitive init reasons but leaves opt-in, model scope, and uncertainty visible",
    () =>
      Effect.gen(function* () {
        const { file, write } = yield* fixture;
        yield* write(true);
        const fast = yield* makeClaudeFastModeAvailability(file, {});
        for (const reason of [
          "free",
          "preference",
          "extra_usage_disabled",
          "not_first_party",
          "disabled_by_env",
        ]) {
          yield* fast.update(probe({ fastModeDisabledReason: reason }));
          yield* fast.refresh;
          assert.isTrue(yield* fast.isBlocked);
        }
        for (const reason of [
          "sdk_opt_in_required",
          "pending",
          "network_error",
          "unknown",
          "model_not_allowed",
          "future-reason",
        ]) {
          yield* fast.update(probe({ fastModeDisabledReason: reason }));
          yield* fast.refresh;
          assert.isFalse(yield* fast.isBlocked);
        }
        yield* fast.update(probe());
        yield* fast.refresh;
        assert.isFalse(yield* fast.isBlocked);
      }).pipe(Effect.scoped),
  );
});

it("filters Fast without mutating the catalog or other options and always suppresses custom Fast", () => {
  const models: ReadonlyArray<ServerProviderModel> = [false, true].map((isCustom) => ({
    slug: isCustom ? "custom" : "claude-opus-5-5",
    name: "Model",
    isCustom,
    capabilities: {
      optionDescriptors: [
        { id: "fastMode", label: "Fast", type: "boolean" },
        { id: "thinking", label: "Thinking", type: "boolean" },
      ],
    },
  }));
  const blocked = filterClaudeFastModeModels(models, true);
  assert.deepEqual(
    blocked.map((model) => model.capabilities?.optionDescriptors?.map((option) => option.id)),
    [["thinking"], ["thinking"]],
  );
  const recovered = filterClaudeFastModeModels(models, false);
  assert.strictEqual(recovered[0], models[0]);
  assert.deepEqual(
    recovered[1]?.capabilities?.optionDescriptors?.map((option) => option.id),
    ["thinking"],
  );
});

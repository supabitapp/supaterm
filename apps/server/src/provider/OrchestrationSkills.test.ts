import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId } from "@supaterm/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type { ProviderInstance } from "@supaterm/provider-core/server/driver";
import * as ProviderInstanceRegistry from "./ProviderInstanceRegistry.ts";
import * as ProviderRegistry from "./ProviderRegistry.ts";
import * as ServerConfig from "../config.ts";
import { symlinksSupported } from "@supaterm/shared/testing/symlinks";
import * as OrchestrationSkills from "./OrchestrationSkills.ts";
import {
  ORCHESTRATION_SKILLS,
  ORCHESTRATION_SKILL_REFERENCE,
} from "./orchestrationSkillContent.ts";
import { discoverClaudeSkills } from "./Drivers/ClaudeSkills.ts";

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-native-skills-" });
  const claudeHome = path.join(home, ".claude");
  const claude = path.join(claudeHome, "skills");
  const codex = path.join(home, ".codex", "skills");
  let refreshes = 0;
  const instances = [
    { instanceId: "claude", driverKind: "claudeAgent", skillInstallDirectory: claude },
    { instanceId: "codex", driverKind: "codex", skillInstallDirectory: codex },
    { instanceId: "codex-work", driverKind: "codex", skillInstallDirectory: codex },
    { instanceId: "remote", driverKind: "opencode" },
  ].map(
    (instance) =>
      ({
        ...instance,
        instanceId: ProviderInstanceId.make(instance.instanceId),
        driverKind: ProviderDriverKind.make(instance.driverKind),
        enabled: true,
      }) as ProviderInstance,
  );
  const layer = OrchestrationSkills.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
          listInstances: Effect.succeed(instances),
        }),
        Layer.mock(ProviderRegistry.ProviderRegistry)({
          getProviders: Effect.succeed([]),
          refreshInstance: () =>
            Effect.sync(() => {
              refreshes++;
              return [];
            }),
        }),
      ),
    ),
    Layer.provideMerge(ServerConfig.layerTest(home, path.join(home, "app"))),
  );
  const context = yield* Layer.build(layer);
  return {
    reload: Layer.build(layer).pipe(
      Effect.map((context) => Context.get(context, OrchestrationSkills.OrchestrationSkills)),
    ),
    fs,
    path,
    home,
    claudeHome,
    claude,
    codex,
    service: Context.get(context, OrchestrationSkills.OrchestrationSkills),
    refreshes: () => refreshes,
  };
});

it.layer(NodeServices.layer)("native orchestration skill installation", (it) => {
  it.effect(
    "does not install on status reads and reports shared and unsupported destinations",
    () =>
      Effect.gen(function* () {
        const harness = yield* fixture;
        const status = yield* harness.service.status;
        assert.lengthOf(status.targets, 2);
        assert.deepEqual(status.targets[1]?.providers, ["codex", "codex-work"]);
        assert.deepEqual(status.unsupportedProviders, ["remote"]);
        assert.isTrue(
          status.targets.every((target) =>
            target.skills.every((skill) => skill.state === "not-installed"),
          ),
        );
        assert.isFalse(yield* harness.fs.exists(harness.claude));
        assert.isFalse(yield* harness.fs.exists(harness.codex));
        assert.equal(harness.refreshes(), 0);
      }),
  );

  it.effect(
    "explicit installation produces natively discoverable skills and complete references",
    () =>
      Effect.gen(function* () {
        const harness = yield* fixture;
        const status = yield* harness.service.install;
        assert.isTrue(
          status.targets.every((target) =>
            target.skills.every((skill) => skill.state === "installed" && skill.managed),
          ),
        );
        const discovered = yield* discoverClaudeSkills(
          { homePath: harness.claudeHome },
          harness.home,
        );
        assert.deepEqual(
          discovered.map((skill) => skill.name),
          ["supaterm-advisor", "supaterm-commitee"],
        );
        for (const root of [harness.claude, harness.codex]) {
          for (const skill of ORCHESTRATION_SKILLS) {
            assert.equal(
              yield* harness.fs.readFileString(harness.path.join(root, skill.name, "SKILL.md")),
              skill.content,
            );
            assert.equal(
              yield* harness.fs.readFileString(
                harness.path.join(root, skill.name, "references", "orchestration.md"),
              ),
              ORCHESTRATION_SKILL_REFERENCE,
            );
          }
        }
        yield* harness.service.install;
        assert.equal(harness.refreshes(), 3);
      }),
  );

  it.effect(
    "uninstalls only links, leaves the bundle intact, and stays uninstalled after restart",
    () =>
      Effect.gen(function* () {
        const harness = yield* fixture;
        yield* harness.service.install;
        const link = harness.path.join(harness.claude, "supaterm-advisor");
        const target = yield* harness.fs.readLink(link);
        const status = yield* harness.service.uninstall;
        assert.isTrue(
          status.targets.every((target) =>
            target.skills.every((skill) => skill.state === "not-installed"),
          ),
        );
        assert.isFalse(yield* harness.fs.exists(link));
        assert.isTrue(yield* harness.fs.exists(harness.path.join(target, "SKILL.md")));
        assert.deepEqual(
          yield* discoverClaudeSkills({ homePath: harness.claudeHome }, harness.home),
          [],
        );
        const restarted = yield* harness.reload;
        assert.isTrue(
          (yield* restarted.status).targets.every((target) =>
            target.skills.every((skill) => skill.state === "not-installed"),
          ),
        );
        yield* restarted.install;
        assert.lengthOf(
          yield* discoverClaudeSkills({ homePath: harness.claudeHome }, harness.home),
          2,
        );
      }),
  );

  it.effect("refreshes linked skill contents on app startup without reinstalling", () =>
    Effect.gen(function* () {
      const harness = yield* fixture;
      yield* harness.service.install;
      const skill = ORCHESTRATION_SKILLS[0];
      const claudeLink = harness.path.join(harness.claude, skill.name);
      const codexLink = harness.path.join(harness.codex, skill.name);
      const source = yield* harness.fs.readLink(claudeLink);
      assert.equal(yield* harness.fs.readLink(codexLink), source);
      yield* harness.fs.writeFileString(
        harness.path.join(source, "SKILL.md"),
        "previous app version",
      );
      yield* harness.fs.writeFileString(
        harness.path.join(source, "references", "orchestration.md"),
        "previous reference",
      );
      const restarted = yield* harness.reload;
      assert.equal(yield* harness.fs.readLink(claudeLink), source);
      assert.equal(
        yield* harness.fs.readFileString(harness.path.join(claudeLink, "SKILL.md")),
        skill.content,
      );
      assert.equal(
        yield* harness.fs.readFileString(
          harness.path.join(codexLink, "references", "orchestration.md"),
        ),
        ORCHESTRATION_SKILL_REFERENCE,
      );
      assert.isTrue(
        (yield* restarted.status).targets.every((target) =>
          target.skills.every((skill) => skill.state === "installed"),
        ),
      );
    }),
  );

  it.effect("repairs and removes owned dangling links", () =>
    Effect.gen(function* () {
      const harness = yield* fixture;
      yield* harness.service.install;
      const link = harness.path.join(harness.claude, "supaterm-advisor");
      const source = yield* harness.fs.readLink(link);
      yield* harness.fs.remove(source, { recursive: true });
      const broken = (yield* harness.service.status).targets[0]?.skills.find(
        (skill) => skill.name === "supaterm-advisor",
      );
      assert.deepEqual(broken, {
        name: "supaterm-advisor",
        state: "update-available",
        managed: true,
      });
      yield* harness.service.install;
      assert.isTrue(yield* harness.fs.exists(harness.path.join(link, "SKILL.md")));
      yield* harness.fs.remove(source, { recursive: true });
      yield* harness.service.uninstall;
      assert.isTrue(
        (yield* harness.service.status).targets.every((target) =>
          target.skills.every((skill) => skill.state === "not-installed"),
        ),
      );
    }),
  );

  it.effect("replaces an existing folder that holds a skill name", () =>
    Effect.gen(function* () {
      const harness = yield* fixture;
      const skill = ORCHESTRATION_SKILLS[0];
      const directory = harness.path.join(harness.claude, skill.name);
      yield* harness.fs.makeDirectory(directory, { recursive: true });
      yield* harness.fs.writeFileString(harness.path.join(directory, "SKILL.md"), "stale copy");
      const status = yield* harness.service.install;
      assert.deepEqual(status.targets[0]?.skills[0], {
        name: skill.name,
        state: "installed",
        managed: true,
      });
      assert.equal(
        yield* harness.fs.readFileString(harness.path.join(directory, "SKILL.md")),
        skill.content,
      );
    }),
  );

  it.effect.skipIf(!symlinksSupported)(
    "replaces a foreign skill link without touching its target",
    () =>
      Effect.gen(function* () {
        const harness = yield* fixture;
        const outside = harness.path.join(harness.home, "personal");
        yield* harness.fs.makeDirectory(outside);
        yield* harness.fs.writeFileString(harness.path.join(outside, "SKILL.md"), "personal");
        yield* harness.fs.makeDirectory(harness.claude, { recursive: true });
        const link = harness.path.join(harness.claude, "supaterm-advisor");
        yield* harness.fs.symlink(outside, link);
        const status = yield* harness.service.install;
        assert.equal(
          status.targets[0]?.skills.find((skill) => skill.name === "supaterm-advisor")?.state,
          "installed",
        );
        assert.notEqual(yield* harness.fs.readLink(link), outside);
        assert.equal(
          yield* harness.fs.readFileString(harness.path.join(outside, "SKILL.md")),
          "personal",
        );
      }),
  );
});

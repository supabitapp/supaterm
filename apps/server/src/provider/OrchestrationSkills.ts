// @effect-diagnostics-next-line nodeBuiltinImport:off - Effect symlink has no type argument; Windows needs directory junctions without elevation.
import * as NodeFSP from "node:fs/promises";
import * as HostProcess from "@supaterm/shared/HostProcess";
import { OrchestrationSkillsError, type OrchestrationSkillsStatus } from "@supaterm/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";
import * as ServerConfig from "../config.ts";
import { writeFileStringAtomically } from "@supaterm/shared/atomicWrite";
import * as ProviderInstanceRegistry from "./ProviderInstanceRegistry.ts";
import * as ProviderRegistry from "./ProviderRegistry.ts";
import {
  ORCHESTRATION_SKILLS,
  ORCHESTRATION_SKILL_REFERENCE,
} from "./orchestrationSkillContent.ts";

export class OrchestrationSkills extends Context.Service<
  OrchestrationSkills,
  {
    readonly status: Effect.Effect<OrchestrationSkillsStatus, OrchestrationSkillsError>;
    readonly install: Effect.Effect<OrchestrationSkillsStatus, OrchestrationSkillsError>;
    readonly uninstall: Effect.Effect<OrchestrationSkillsStatus, OrchestrationSkillsError>;
  }
>()("supaterm/provider/OrchestrationSkills") {}

const notFound = <A, E extends { readonly reason: { readonly _tag: string } }, R>(
  effect: Effect.Effect<A, E, R>,
) =>
  effect.pipe(
    Effect.map(Option.some),
    Effect.catchIf(
      (error) => error.reason._tag === "NotFound",
      () => Effect.succeedNone,
    ),
  );

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const providers = yield* ProviderRegistry.ProviderRegistry;
  const lock = yield* Semaphore.make(1);
  const config = yield* ServerConfig.ServerConfig;
  const platform = yield* HostProcess.Platform;
  // Native CLIs cannot read Electron's asar or a standalone executable's
  // embedded assets. Keep a stable on-disk target for links across upgrades.
  const bundleRoot = path.join(config.stateDir, "bundled-skills", "orchestration");
  const bundledDirectory = (name: string) => path.join(bundleRoot, name);
  const writeFile = (filePath: string, contents: string) =>
    writeFileStringAtomically({ filePath, contents }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );

  const materializeBundle = Effect.gen(function* () {
    let changed = false;
    for (const skill of ORCHESTRATION_SKILLS) {
      const directory = bundledDirectory(skill.name);
      for (const [relative, contents] of [
        ["SKILL.md", skill.content],
        ["references/orchestration.md", ORCHESTRATION_SKILL_REFERENCE],
      ] as const) {
        const filePath = path.join(directory, relative);
        const previous = yield* notFound(fs.readFileString(filePath));
        if (Option.isNone(previous) || previous.value !== contents) {
          yield* writeFile(filePath, contents);
          changed = true;
        }
      }
    }
    return changed;
  });
  // Refresh the bundle on every app start, without creating any provider links.
  // A failed refresh remains repairable by installing from Settings.
  const bundleChanged = yield* materializeBundle.pipe(
    Effect.catch((cause) =>
      Effect.logWarning("Could not refresh bundled orchestration skills.", { cause }).pipe(
        Effect.as(false),
      ),
    ),
  );

  const inspect = Effect.fn("OrchestrationSkills.inspect")(function* (
    root: string,
    skill: (typeof ORCHESTRATION_SKILLS)[number],
  ) {
    const directory = path.join(root, skill.name);
    const link = yield* fs.readLink(directory).pipe(Effect.option);
    if (Option.isSome(link)) {
      const target = path.resolve(path.dirname(directory), link.value);
      if (path.toNamespacedPath(target) !== path.toNamespacedPath(bundledDirectory(skill.name))) {
        return { name: skill.name, state: "conflict" as const, managed: false };
      }
      const content = yield* notFound(fs.readFileString(path.join(target, "SKILL.md")));
      const reference = yield* notFound(
        fs.readFileString(path.join(target, "references", "orchestration.md")),
      );
      const current =
        Option.isSome(content) &&
        content.value === skill.content &&
        Option.isSome(reference) &&
        reference.value === ORCHESTRATION_SKILL_REFERENCE;
      return {
        name: skill.name,
        state: current ? ("installed" as const) : ("update-available" as const),
        managed: true,
      };
    }
    return {
      name: skill.name,
      state: (yield* fs.exists(directory)) ? ("conflict" as const) : ("not-installed" as const),
      managed: false,
    };
  });

  const targets = Effect.gen(function* () {
    const instances = yield* registry.listInstances;
    const directories = new Map<string, { directory: string; providers: string[] }>();
    const unsupportedProviders: string[] = [];
    for (const instance of instances) {
      const label = instance.displayName ?? instance.instanceId;
      if (!instance.skillInstallDirectory) {
        unsupportedProviders.push(label);
        continue;
      }
      const directory = path.resolve(instance.skillInstallDirectory);
      const existing = directories.get(directory);
      if (existing) existing.providers.push(label);
      else directories.set(directory, { directory, providers: [label] });
    }
    return { targets: [...directories.values()], unsupportedProviders };
  });
  const readStatus = Effect.gen(function* () {
    const current = yield* targets;
    return {
      ...current,
      targets: yield* Effect.forEach(current.targets, (target) =>
        Effect.gen(function* () {
          const skills = yield* Effect.forEach(ORCHESTRATION_SKILLS, (skill) =>
            inspect(target.directory, skill),
          );
          return { ...target, skills };
        }),
      ),
    } satisfies OrchestrationSkillsStatus;
  });

  const installSkill = Effect.fn("OrchestrationSkills.installSkill")(function* (
    root: string,
    skill: (typeof ORCHESTRATION_SKILLS)[number],
  ) {
    const state = yield* inspect(root, skill);
    if (state.managed) return false;
    const directory = path.join(root, skill.name);
    // Replaces whatever holds our skill name. A link is removed without touching its target.
    if (state.state === "conflict") yield* fs.remove(directory, { recursive: true });
    yield* fs.makeDirectory(root, { recursive: true });
    yield* Effect.tryPromise(() =>
      NodeFSP.symlink(
        bundledDirectory(skill.name),
        directory,
        platform === "win32" ? "junction" : "dir",
      ),
    );
    return true;
  });
  const uninstallSkill = Effect.fn("OrchestrationSkills.uninstallSkill")(function* (
    root: string,
    skill: (typeof ORCHESTRATION_SKILLS)[number],
  ) {
    const state = yield* inspect(root, skill);
    if (!state.managed) return false;
    // Remove only our link, including dangling links. Never recurse into its target.
    yield* fs.remove(path.join(root, skill.name));
    return true;
  });
  const refreshProviders = Effect.gen(function* () {
    const snapshots = yield* providers.getProviders;
    for (const instance of yield* registry.listInstances) {
      if (!instance.skillInstallDirectory) continue;
      yield* instance.invalidateCaches ?? Effect.void;
      const workspaces =
        snapshots.find((snapshot) => snapshot.instanceId === instance.instanceId)
          ?.workspaceSnapshots ?? [];
      if (workspaces.length === 0) yield* providers.refreshInstance(instance.instanceId);
      else
        for (const workspace of workspaces) {
          yield* providers.refreshWorkspaceSnapshot({
            instanceId: instance.instanceId,
            cwd: workspace.cwd,
            fresh: true,
          });
        }
    }
  });
  const mutate = (operation: typeof installSkill) =>
    lock
      .withPermits(1)(
        Effect.gen(function* () {
          let changed = operation === installSkill ? yield* materializeBundle : false;
          const current = yield* targets;
          for (const target of current.targets) {
            for (const skill of ORCHESTRATION_SKILLS)
              changed = (yield* operation(target.directory, skill)) || changed;
          }
          if (changed) yield* refreshProviders;
          return yield* readStatus;
        }),
      )
      .pipe(Effect.mapError((cause) => new OrchestrationSkillsError({ cause })));
  if (bundleChanged) {
    // Updating the bundle must not make app startup wait on provider probes.
    const installed = yield* readStatus.pipe(Effect.orElseSucceed(() => null));
    if (installed?.targets.some((target) => target.skills.some((skill) => skill.managed))) {
      yield* refreshProviders.pipe(Effect.forkScoped);
    }
  }
  return OrchestrationSkills.of({
    status: lock
      .withPermits(1)(readStatus)
      .pipe(Effect.mapError((cause) => new OrchestrationSkillsError({ cause }))),
    install: mutate(installSkill),
    uninstall: mutate(uninstallSkill),
  });
});

export const layer = Layer.effect(OrchestrationSkills, make);

# Modularize `apps/mac` for Tuist build cache

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

No `PLANS.md` file is checked into this repository today. Maintain this document using the section rules written here.

## Purpose / Big Picture

After this change, `apps/mac` will build as a small app shell plus a set of cacheable internal frameworks. `tuist hash cache --configuration Debug` will list Supaterm-owned frameworks such as `SupatermCLIShared`, `SPCLI`, `SupatermSupport`, `SupatermTerminalCore`, `SupatermUpdateFeature`, `SupatermSettingsFeature`, `SupatermSocketFeature`, `SupatermTerminalFeature`, and the existing `GhosttyKit`. `supaterm` itself will stop compiling all feature code directly. The practical effect is that clean builds, CI builds, and branch switches can reuse warmed artifacts for unchanged internal features instead of recompiling the whole app.

This also removes one source of hidden build coupling that would poison cache usefulness: the mac app target currently writes `apps/supaterm.com/public/data/supaterm-settings.schema.json` as a post-build side effect. After this work, the website schema stays an explicit artifact owned by `make generate-settings-schema` and by the existing schema drift test, not by every app build.

The complexity we are paying today is change amplification in `apps/mac/Project.swift`, cognitive load from one giant app target, and unknown unknowns from feature APIs that only exist because everything shares one compilation unit. The simpler boundary after this work is: feature frameworks own their code and public types, the app target owns only lifecycle and AppKit orchestration, and Tuist’s cache profile can opt in internal frameworks by tag instead of by accident.

## Progress

- [x] 2026-04-07 14:19Z Initial repository and Tuist research completed; current graph, churn, and cache behavior were captured and this ExecPlan was authored.
- [ ] Add cacheable internal framework targets and a tag-based Tuist cache profile in `apps/mac/Tuist.swift` and `apps/mac/Project.swift`.
- [ ] Extract shared support code and terminal core code into stable internal frameworks without changing user-visible behavior.
- [ ] Move isolated feature folders into their own framework targets and reduce `supaterm` to an app shell target.
- [ ] Remove the app target’s schema-writing post-build phase and keep schema generation explicit.
- [ ] Split or retarget tests so each new framework is testable without importing the app target.
- [ ] Warm the cache, build the app, run tests, and confirm internal Supaterm targets now appear in `tuist hash cache`.

## Surprises & Discoveries

- Observation: The current cache profile is intentionally limited to external dependencies.
  Evidence: `apps/mac/Tuist.swift` sets `cacheOptions` to `.profile(.onlyExternal)`.

- Observation: Tuist currently hashes `GhosttyKit` but not `SupatermCLIShared` or `SPCLI`.
  Evidence:
    `cd /Users/Developer/code/github.com/supabitapp/supaterm/apps/mac && tuist hash cache --configuration Debug`
    prints `GhosttyKit - 8a1c107e2ce7c593a22953242270ca5c` and many external packages, but no internal `SupatermCLIShared` or `SPCLI` entry.

- Observation: The project graph is already explicit enough for modularization; there are no current implicit dependency problems to fix first.
  Evidence:
    `cd /Users/Developer/code/github.com/supabitapp/supaterm/apps/mac && mise exec -- tuist inspect dependencies --only implicit`
    returns `We did not find any dependency issues in your project (checked: implicit).`

- Observation: The app target mutates the website tree during every app build.
  Evidence: `apps/mac/Project.swift` contains a `Generate Settings Schema` post-build phase that writes `../supaterm.com/public/data/supaterm-settings.schema.json`.

- Observation: There is a real low-churn terminal core worth extracting; not every terminal folder should become its own target.
  Evidence: since 2026-01-01, `git log --name-only` touched `apps/mac/supaterm/Features/Terminal/Models/**` 33 times, while `Terminal/Views/Sidebar/**` was touched 174 times and `TerminalHostState.swift` alone 76 times.

## Decision Log

- Decision: Use a selective TMA-style split, not a five-target TMA module for every current folder.
  Rationale: the request is to unlock Tuist cache with the simplest forward-only architecture. Adding `Interface`, `Testing`, and `Example` targets for every feature today would introduce many shallow names without hiding more detail. We will use extra interface-style targets only where there are multiple consumers and real implementation hiding value.
  Date/Author: 2026-04-07 / Codex

- Decision: Preserve `apps/supaterm.com` outside the Tuist graph and only remove the schema-writing side effect.
  Rationale: the website is not built by Tuist, so modularizing it would not improve Tuist cache hits. The only relevant coupling is the mac app build writing into the web tree.
  Date/Author: 2026-04-07 / Codex

- Decision: Tag cacheable internal frameworks and use a custom cache profile based on `.onlyExternal` plus `.tagged("cacheable")`.
  Rationale: naming targets directly in `Tuist.swift` would create drift every time a new internal framework is added. Tags keep the policy local to target definitions.
  Date/Author: 2026-04-07 / Codex

- Decision: Keep the `supaterm` target as a shell and move only `AppFeature.swift` into the shell folder; do not create a separate `SupatermAppFeature` framework.
  Rationale: `AppFeature` is currently a 35-line composition reducer. A new framework for it would be pure ceremony.
  Date/Author: 2026-04-07 / Codex

- Decision: Put live adapters next to the implementation that owns them, not in shared interface modules.
  Rationale: `TerminalWindowsClient.live(registry:)` knows about `TerminalWindowRegistry`, so it belongs in the app shell. `TerminalWindowsClient` the type belongs in terminal core because socket and terminal features both use it.
  Date/Author: 2026-04-07 / Codex

- Decision: Prefer `.staticFramework` for new cacheable internal targets.
  Rationale: `GhosttyKit` already proves the current project can cache static frameworks, and static frameworks avoid adding runtime embedding work to the migration. If SwiftUI previews or another Xcode feature regresses, that can be revisited explicitly later.
  Date/Author: 2026-04-07 / Codex

## Outcomes & Retrospective

This document currently captures a researched implementation plan, not completed modularization. The repository evidence is strong enough to commit to a concrete target graph now: shared contracts, support services, terminal core, and isolated features become frameworks; the app target becomes orchestration only. The remaining work is mechanical but non-trivial because existing tests and a few cross-folder utility types must move with the new boundaries.

## Context and Orientation

`apps/mac` is generated by Tuist from three manifests: `apps/mac/Tuist.swift`, `apps/mac/Workspace.swift`, and `apps/mac/Project.swift`. Today the internal targets are:

- `SupatermCLIShared` as a `staticLibrary`
- `SPCLI` as a `staticLibrary`
- `sp` as a command-line tool
- `GhosttyKit` as a foreign-built `staticFramework`
- `supaterm` as an app target
- `supatermTests` as one large unit-test bundle

The core problem is that `supaterm` still compiles almost all application code directly. In `apps/mac/Project.swift`, the app target uses `buildableFolders` for `supaterm/App` and `supaterm/Features`, so reducers, views, runtimes, settings editors, socket control, and window orchestration all live in the same compilation unit. Tuist cannot reuse that work because an app target is not the right granularity for internal binary cache reuse. The current cache profile also opts into external dependencies only, so even cacheable internal frameworks would be ignored.

The current source layout is good enough to show where deep boundaries already exist:

- `apps/mac/SupatermCLIShared/**` is already a genuine shared contract used by the app, the CLI, and tests.
- `apps/mac/supaterm/Features/Update/**` is isolated and low churn.
- `apps/mac/supaterm/Features/Socket/**` is isolated and low churn once desktop notifications move out.
- `apps/mac/supaterm/Features/Terminal/Models/**` is a stable terminal domain and persistence layer.
- `apps/mac/supaterm/Features/Terminal/**` outside `Models` is the highest-churn implementation area and should stay as one deeper feature module rather than being split into many tiny targets.
- `apps/mac/supaterm/App/**` is AppKit lifecycle, window orchestration, menu wiring, telemetry bootstrapping, and Ghostty bootstrap.

There are also a few leaked implementation details that must be corrected as part of modularization. The most important are:

- `apps/mac/supaterm/Features/Settings/SupatermSettings.swift` defines the shared file storage key that both the app shell and settings feature use. That storage boundary is not settings-specific.
- `apps/mac/supaterm/Features/Terminal/TerminalWindowsClient.swift` defines the cross-feature client type, but its `live(registry:)` constructor currently depends on the app shell’s `TerminalWindowRegistry`.
- `apps/mac/supaterm/App/AppFeature.swift` lives under `Features`, even though it is only shell composition.
- The `supaterm` app target runs a post-build script that writes into `apps/supaterm.com`.

For a novice reader: a “cacheable target” here means a framework target that Tuist can hash, prebuild, and substitute during project generation. A “shell target” means the thin app layer that owns windows, menus, lifecycle, and dependency wiring, but not feature logic. A “deep module” means a target that hides real policy or sequencing from the rest of the system instead of merely renaming files.

## Plan of Work

### Milestone 1: make cache participation explicit

The first milestone changes only manifests and existing internal target products. In `apps/mac/Project.swift`, change `SupatermCLIShared` and `SPCLI` from `.staticLibrary` to `.staticFramework`, and add `metadata: .metadata(tags: ["cacheable"])` to every internal framework that we want Tuist to warm. Keep `sp` as the thin executable target and keep `GhosttyKit` as the foreign-built framework it already is. In `apps/mac/Tuist.swift`, replace the current cache profile with a custom profile that starts from `.onlyExternal` and additionally includes `.tagged("cacheable")`. In `apps/mac/Makefile`, update `warm-cache` so it warms internal cacheable frameworks too, not just externals.

The result of this milestone is observable immediately even before the full feature split is done: `tuist hash cache --configuration Debug` starts listing internal Supaterm frameworks rather than only `GhosttyKit` and external packages. This milestone hides cache policy inside target tags and removes the need to maintain a second list of target names in `Tuist.swift`.

### Milestone 2: extract shared support and terminal core

Create two new source roots whose folder structure matches the intended target graph:

- `apps/mac/supaterm/Support/`
- `apps/mac/supaterm/TerminalCore/`

Move the following files into `Support` and give them a target named `SupatermSupport`:

- `apps/mac/supaterm/Features/Analytics/AnalyticsClient.swift`
- `apps/mac/supaterm/Features/Socket/DesktopNotificationClient.swift`
- `apps/mac/supaterm/App/AppTelemetry.swift`
- `apps/mac/supaterm/App/AppCrashReporting.swift`
- `apps/mac/supaterm/App/HardwareInfo.swift`
- `apps/mac/supaterm/Features/Settings/SupatermSettings.swift`, renamed to a storage-oriented file name such as `SupatermSettingsStorage.swift`

`SupatermSupport` must hide PostHog, Sentry, `UNUserNotificationCenter`, and the persisted settings file path from feature modules. Settings, update, terminal, and the shell will all depend on this target instead of reaching across folders.

Move the following files into `TerminalCore` and give them a target named `SupatermTerminalCore`:

- everything currently under `apps/mac/supaterm/Features/Terminal/Models/`
- `apps/mac/supaterm/Features/Terminal/TerminalWindowsClient.swift`

If any cross-target terminal type still lives in the feature implementation tree after the move, extract it into a dedicated file under `TerminalCore` before continuing. The rule is simple: if socket control, the app shell, and terminal UI all need the type, it belongs in `TerminalCore`, not in a view or host-runtime file.

This milestone is the complexity dividend point. `SupatermSupport` hides platform services and storage, and `SupatermTerminalCore` hides terminal identity, session persistence, and cross-window request types. After this step, settings, socket control, and the app shell no longer need to know where those details are implemented.

### Milestone 3: turn isolated features into frameworks

Add four new feature targets in `apps/mac/Project.swift`, all `.staticFramework` and tagged `cacheable`:

- `SupatermUpdateFeature` from `apps/mac/supaterm/Features/Update/**`
- `SupatermSettingsFeature` from `apps/mac/supaterm/Features/Settings/**` after the settings storage file has been moved out
- `SupatermSocketFeature` from `apps/mac/supaterm/Features/Socket/**` after `DesktopNotificationClient.swift` has been moved out
- `SupatermTerminalFeature` from `apps/mac/supaterm/Features/Terminal/**` after `Models/**` has been moved out

Do not split terminal views, Ghostty runtime, and reducer logic into separate targets. The repo evidence says those files churn together, and splitting them would create shallow modules that still force readers to understand the same orchestration spread across more names.

At the same time, move `apps/mac/supaterm/Features/App/AppFeature.swift` into `apps/mac/supaterm/App/AppFeature.swift`. The shell owns that composition reducer. Keep `apps/mac/supaterm/App/ContentView.swift`, `AppAppearanceView.swift`, `GhosttyColorSchemeSyncView.swift`, window controllers, the menu controller, the registry, and the delegate in the app shell. They are orchestration and presentation glue, not reusable features.

Move `TerminalWindowsClient.live(registry:)` out of `TerminalCore` and into a new shell-owned file such as `apps/mac/supaterm/App/TerminalWindowsClient+Live.swift`. Keep `TerminalWindowsClient` the type in `TerminalCore`. This is the clearest boundary in the whole migration: the interface is shared; the adapter belongs to the shell that owns the registry.

After this milestone, the app target should depend on feature frameworks rather than compile those files directly. Changes to settings, update, socket, or terminal internals are now isolated to their own targets, and shell-only changes stop rebuilding feature code.

### Milestone 4: reduce the app target to a shell and remove website side effects

Once all extracted targets compile, change the `supaterm` app target in `apps/mac/Project.swift` to build only `apps/mac/supaterm/App/**` and resources. Delete `supaterm/Features` from the app target’s `buildableFolders`. The target’s job becomes: lifecycle, window creation, menu wiring, Ghostty bootstrap, store composition, resource embedding, and embedding the `sp` executable.

In the same edit, delete the `Generate Settings Schema` post-build phase from the `supaterm` target. Keep the existing explicit path in `apps/mac/Makefile`:

    make generate-settings-schema

That command already builds `sp`, generates the schema, and updates `apps/supaterm.com/public/data/supaterm-settings.schema.json`. The existing test `apps/mac/supatermTests/SupatermSettingsSchemaTests.swift` already checks that the committed web schema matches the generated schema; keep that guard and make it the only automation that enforces drift.

This milestone removes the most dangerous unknown unknown in the current graph: a mac app build should not mutate the website tree. It also makes the shell target genuinely small, which is necessary for build cache to pay off.

### Milestone 5: split tests by module boundary

Replace the current monolithic `supatermTests` target with test bundles that follow the new ownership boundaries. The minimum useful split is:

- `SupatermCLISharedTests`
- `SPCLITests`
- `SupatermSupportTests`
- `SupatermTerminalCoreTests`
- `SupatermUpdateFeatureTests`
- `SupatermSettingsFeatureTests`
- `SupatermSocketFeatureTests`
- `SupatermTerminalFeatureTests`
- `supatermAppTests`

Move existing tests by the module they actually exercise. For example:

- `SupatermSettingsSchemaTests.swift`, `SupatermSettingsTests.swift`, and hook-settings tests move to `SupatermCLISharedTests` or `SupatermSupportTests` depending on where the code lands.
- `SplitTreeTests.swift`, `TerminalSpaceManagerTests.swift`, `TerminalTabManagerTests.swift`, `TerminalSessionCatalogTests.swift`, and `TerminalSpaceCatalogTests.swift` move to `SupatermTerminalCoreTests`.
- `UpdateFeatureTests.swift`, `UpdatePhaseTests.swift`, and `UpdateSettingsTests.swift` move to `SupatermUpdateFeatureTests`.
- `SocketControlFeatureTests.swift` and `SocketControlRuntimeTests.swift` move to `SupatermSocketFeatureTests`.
- `TerminalWindowFeatureTests.swift`, `GhosttyRuntimeTests.swift`, `GhosttySurfaceBridgeTests.swift`, `TerminalHostState*Tests.swift`, and terminal view tests move to `SupatermTerminalFeatureTests`.
- `AppDelegateTests.swift`, `SupatermMenuControllerTests.swift`, `TerminalWindowRegistryTests.swift`, and window-controller tests move to `supatermAppTests`.

Update `apps/mac/Workspace.swift` so the main `supaterm` scheme runs all of these bundles. If feature-specific shared schemes make iteration easier, add them, but keep the main aggregate scheme authoritative for CI and `make test`.

## Concrete Steps

Run these commands from the listed directories as you work, and keep the snippets below up to date when reality changes.

From `apps/mac`, capture the current cache state before changing manifests:

    cd /Users/Developer/code/github.com/supabitapp/supaterm/apps/mac
    tuist hash cache --configuration Debug

Before implementation, the important observation is that `GhosttyKit` appears but `SupatermCLIShared` and `SPCLI` do not.

From `apps/mac`, validate dependency explicitness before and after the split:

    cd /Users/Developer/code/github.com/supabitapp/supaterm/apps/mac
    mise exec -- tuist inspect dependencies --only implicit

Expected output:

    Loading and constructing the graph
    It might take a while if the cache is empty
    We did not find any dependency issues in your project (checked: implicit).

After each major manifest edit, regenerate the workspace:

    cd /Users/Developer/code/github.com/supabitapp/supaterm/apps/mac
    make generate-project

After the new targets exist, verify the cache profile sees them:

    cd /Users/Developer/code/github.com/supabitapp/supaterm/apps/mac
    tuist hash cache --configuration Debug

Expected internal entries after the migration:

    GhosttyKit - <hash>
    SPCLI - <hash>
    SupatermCLIShared - <hash>
    SupatermSupport - <hash>
    SupatermTerminalCore - <hash>
    SupatermUpdateFeature - <hash>
    SupatermSettingsFeature - <hash>
    SupatermSocketFeature - <hash>
    SupatermTerminalFeature - <hash>

Warm the cache and confirm the command no longer uses `--external-only`:

    cd /Users/Developer/code/github.com/supabitapp/supaterm/apps/mac
    make warm-cache

Build and test from the generated workspace:

    cd /Users/Developer/code/github.com/supabitapp/supaterm/apps/mac
    make test

Regenerate the web schema explicitly and nowhere else:

    cd /Users/Developer/code/github.com/supabitapp/supaterm/apps/mac
    make generate-settings-schema

## Validation and Acceptance

Acceptance is behavior, not only file movement.

The migration is complete when all of the following are true:

- `cd apps/mac && tuist hash cache --configuration Debug` lists internal Supaterm frameworks in addition to external dependencies and `GhosttyKit`.
- `cd apps/mac && make generate-project` succeeds without adding implicit dependency warnings.
- `cd apps/mac && make test` passes with the new target graph and test-bundle split.
- `cd apps/mac && make warm-cache` warms internal Supaterm frameworks rather than only externals.
- `cd apps/mac && make generate-settings-schema` updates `apps/supaterm.com/public/data/supaterm-settings.schema.json` when the schema changes.
- Building the mac app no longer rewrites `apps/supaterm.com/public/data/supaterm-settings.schema.json`.
- The `supaterm` app target’s source list is limited to shell code under `apps/mac/supaterm/App/**` and resources; reducers and feature views are compiled by their own framework targets.

For a concrete manual proof that the shell is thin, touch a shell file such as `apps/mac/supaterm/App/AppDelegate.swift`, rebuild, and confirm only the shell target recompiles. Then touch a terminal core file such as `apps/mac/supaterm/TerminalCore/TerminalTabManager.swift`, rebuild, and confirm the rebuild flows through terminal core and its dependents but not through unrelated settings-only or socket-only sources.

## Idempotence and Recovery

All generation and validation commands in this plan are safe to rerun. `make generate-project`, `make warm-cache`, `make test`, and `make generate-settings-schema` are intended to be repeatable.

The risky step is source movement because duplicate membership can create duplicate symbols or missing imports. Recover by checking these invariants in order:

- Each moved file belongs to exactly one non-test target.
- The app target no longer compiles `supaterm/Features/**`.
- Shared interface types live in the framework that multiple downstream targets import.
- Live adapters that depend on the shell stay in the shell.

If schema drift is detected, rerun `make generate-settings-schema` and commit the resulting web file alongside the mac-side schema change. If cache entries do not appear after the split, inspect the target product types first, then confirm the targets carry the `cacheable` tag, then confirm `apps/mac/Tuist.swift` still uses the custom cache profile as the default.

## Artifacts and Notes

The repo evidence that shaped this plan is summarized here for the future implementer:

    Current internal targets from `apps/mac/Project.swift`:
    - SupatermCLIShared (staticLibrary)
    - SPCLI (staticLibrary)
    - sp (commandLineTool)
    - GhosttyKit (foreign-built staticFramework)
    - supaterm (app with buildableFolders App + Features)
    - supatermTests

    Current cache evidence from `tuist hash cache --configuration Debug`:
    - GhosttyKit is hashed
    - SupatermCLIShared is not hashed
    - SPCLI is not hashed

    Current churn evidence since 2026-01-01:
    - Features/Terminal: 506 touches
    - supaterm/App: 199 touches
    - Features/Settings: 124 touches
    - sp: 96 touches
    - SupatermCLIShared: 72 touches
    - Features/Update: 31 touches
    - Features/Socket: 30 touches

    Terminal sub-area churn since 2026-01-01:
    - Terminal/Views/Sidebar: 174 touches
    - Terminal/root: 147 touches
    - Terminal/Views: 88 touches
    - Terminal/Ghostty: 64 touches
    - Terminal/Models: 33 touches

These numbers are why this plan extracts `TerminalCore` but keeps the rest of terminal code in one deeper feature module.

## Interfaces and Dependencies

The target graph at the end of this plan must look like this:

- `SupatermCLIShared`
  Exports the app/CLI shared protocol, settings schema, hook payloads, and shared value types. It hides socket protocol encoding, settings schema JSON generation, and hook-file formats from the rest of the graph.

- `SupatermSupport`
  Exports `AnalyticsClient`, `DesktopNotificationClient`, and the shared settings storage key. It hides PostHog, Sentry, `UNUserNotificationCenter`, and the concrete `~/.config/supaterm/settings.json` persistence path.

- `SupatermTerminalCore`
  Exports terminal identity types, session and space catalogs, request and error types shared with socket control, and `TerminalWindowsClient`. It hides how session files are shaped and where those files live.

- `SupatermUpdateFeature`
  Exports `UpdateFeature`, `UpdateClient`, `UpdatePhase`, and any update-specific settings types. It hides Sparkle sequencing and update lifecycle policy.

- `SupatermSettingsFeature`
  Exports `SettingsFeature` and `SettingsView`. It hides settings editing flow, hook installation flow, and Ghostty config editing flow.

- `SupatermSocketFeature`
  Exports `SocketControlFeature`, `SocketControlClient`, and `SocketControlRuntime`. It hides socket lifecycle, request buffering, and JSON-RPC dispatch.

- `SupatermTerminalFeature`
  Exports `TerminalWindowFeature`, `TerminalHostState`, `TerminalClient`, `TerminalView`, Ghostty runtime wrappers, and terminal presentation views. It hides pane-tree orchestration, Ghostty surface lifecycle, and tab/space/pane reducer sequencing.

- `SPCLI`
  Exports the CLI command surface as a framework consumed by `sp`. It hides command parsing, tmux compatibility rendering, and schema-printing command plumbing.

- `sp`
  Remains a thin command-line executable that depends on `SPCLI`.

- `supaterm`
  Remains an app target that depends on the frameworks above and owns only app lifecycle, windows, menus, dependency wiring, bootstrap, resources, and embedding of `sp`.

Do not add separate interface frameworks for every feature unless a second consumer appears. The only explicit interface-style split required in this plan is the support/core layer because those types are already shared by multiple features and by the shell.

Change note: 2026-04-07 / Codex created the initial plan after reading the current Tuist manifests, current feature layout, current tests, and current cache behavior. The plan is concrete because the repo evidence is already strong enough to choose boundaries now.

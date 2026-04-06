# Support custom command palette entries and workspace launches

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

The repository-local plan template is [`.agents/plans/06-04-26-custom-command-palette-PLANS.md`](.agents/plans/06-04-26-custom-command-palette-PLANS.md). This document must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, a Supaterm user can define reusable commands in JSON and invoke them from the command palette. A simple command will run in the focused pane. A workspace command will create or focus a named space and materialize a repeatable layout of tabs and panes, including per-pane working directory, startup command, title, and environment variables. The user will be able to prove this works by placing a `supaterm.json` file in a project directory, opening the command palette with `cmd-p`, selecting the new command, and then verifying the resulting terminal tree with `sp tree --json`.

Today the command palette is a visual shell with hard-coded sample rows, while the real creation logic lives elsewhere in `TerminalHostState`. Anyone adding user-defined commands would currently have to spread policy across palette state, window feature state, file discovery, path resolution, confirmation flow, and terminal creation APIs. This plan removes that burden by introducing one owned custom-command boundary that hides configuration discovery, merge precedence, path normalization, and workspace sequencing behind stable interfaces.

## Progress

- [x] (2026-04-06 08:20Z) Inspected the existing command palette, terminal creation flow, surface environment injection, socket protocol, and test coverage to anchor the design in current code.
- [x] (2026-04-06 08:35Z) Authored the initial ExecPlan and checked it into `.agents/plans/06-04-26-custom-command-palette-PLANS-pending.md`.
- [x] (2026-04-06 08:55Z) Audited the plan against the actual palette, host, schema, menu, and CLI code paths and rewrote the plan to remove unnecessary socket spread and to ground workspace creation in the existing split-tree builder path.
- [x] (2026-04-06 09:20Z) Ran a second audit pass against config-path, space-matching, focused-`pwd`, and schema-command helpers so the implementation path matches the existing host and CLI seams more closely.
- [ ] Implement the shared custom-command model, schema, loader, and merge rules in `apps/mac/SupatermCLIShared/` and `apps/mac/supaterm/Features/Terminal/CustomCommands/`.
- [ ] Replace the static command palette rows with resolved custom-command entries, load/error presentation, and command activation.
- [ ] Implement workspace execution, restart policies, per-surface environment support, and the full regression suite.

## Surprises & Discoveries

- Observation: the palette currently owns no executable intent at all; activation only closes the overlay.
  Evidence: `apps/mac/supaterm/Features/Terminal/TerminalWindowFeature.swift` handles `commandPaletteActivateSelection` by setting `state.commandPalette = nil` and returning `.none`, and `apps/mac/supatermTests/TerminalWindowFeatureTests.swift` asserts only that the palette closes.

- Observation: the existing runtime already knows how to create tabs, split panes, send shell text, rename tabs, rename spaces, resize panes, and set absolute pane size.
  Evidence: `apps/mac/supaterm/Features/Terminal/TerminalHostState.swift` exposes `createTab`, `createPane`, `sendText`, `renameTab`, `renameSpace`, `setPaneSize`, `equalizePanes`, and `tilePanes`.

- Observation: `GhosttySurfaceView` injects Supaterm pane metadata and a rewritten `PATH`, but there is no facility to append user-provided `KEY=value` pairs per surface.
  Evidence: `apps/mac/supaterm/Features/Terminal/Ghostty/GhosttySurfaceView.swift` builds `environmentVariables` exclusively from `SupatermCLIContext`, socket path, CLI path, and `PATH`; `apps/mac/supatermTests/GhosttySurfaceViewEnvironmentTests.swift` verifies only those variables.

- Observation: pane titles already have a direct post-creation setter, and tab titles already have a host-owned locked-title path.
  Evidence: `GhosttySurfaceView.setTitleOverride(_:)` updates the pane title in place, and `TerminalHostState.setLockedTabTitle(_:for:)` already owns tab title changes.

- Observation: `TerminalClient.live(host:)` talks to `TerminalHostState` directly, so palette-only behavior does not have to cross the socket/CLI boundary unless we deliberately choose to expose it there.
  Evidence: `apps/mac/supaterm/Features/Terminal/TerminalClient.swift` wires `createPane`, `events`, `send`, and `treeSnapshot` straight to the host, while the socket stack is a separate `TerminalWindowsClient` path.

- Observation: `TerminalHostState` already has a recursive split-tree restore path that creates panes with exact ratios, working directories, and title overrides.
  Evidence: `restoreNode` and `restorationNode` in `apps/mac/supaterm/Features/Terminal/TerminalHostState.swift` already translate between recursive session trees and live `SplitTree<GhosttySurfaceView>` nodes.

- Observation: `closeSpace(_:)` creates a replacement space when closing the last remaining one, which would introduce a dummy space during naive workspace recreation.
  Evidence: `TerminalHostState.closeSpace(_:)` calls `createSpace(...)` before deleting when `spaces.count == 1`.

- Observation: space names are already treated case-insensitively by the current naming rules, so workspace restart matching should follow the same rule rather than inventing a second comparison policy.
  Evidence: `TerminalSpaceManager.isNameAvailable` in `apps/mac/supaterm/Features/Terminal/Models/TerminalSpaceManager.swift` uses `localizedCaseInsensitiveCompare` when checking existing names.

- Observation: the repo already has a stable internal-schema command pattern for shared JSON files, including parser tests and help examples.
  Evidence: `apps/mac/sp/SPInternalCommands.swift`, `apps/mac/sp/SPHelp.swift`, `apps/mac/supatermTests/SPCommandTests.swift`, `apps/mac/supatermTests/SPHelpTests.swift`, and `apps/mac/supatermTests/SupatermSettingsSchemaTests.swift` all cover `generate-settings-schema` today.

## Decision Log

- Decision: keep v1 terminal-only and do not attempt browser panes or mixed media layouts.
  Rationale: Supaterm’s topology is currently spaces -> tabs -> pane split trees of `GhosttySurfaceView`. Adding a second surface type would create a shallow abstraction instead of simplifying the current system.
  Date/Author: 2026-04-06 / Codex

- Decision: discover project-local commands by walking upward from the focused pane’s working directory to the nearest ancestor containing `supaterm.json`, then merge that file over the global `~/.config/supaterm/supaterm.json`.
  Rationale: this avoids coupling command discovery to Git, supports nested projects, and gives the focused pane a simple mental model: “nearest local config wins.”
  Date/Author: 2026-04-06 / Codex

- Decision: keep built-in palette actions and custom commands in one visible list, but make custom command loading and execution a host-owned boundary.
  Rationale: `TerminalWindowFeature` should continue to own UI-only actions such as toggling the sidebar or opening settings, while a deeper terminal-owned module should hide file lookup, merge rules, workspace restart policy, and execution sequencing.
  Date/Author: 2026-04-06 / Codex

- Decision: refresh custom commands whenever the palette opens and do not add file watching in the first implementation.
  Rationale: file watching would add background state and failure modes before the feature proves useful. Palette-open refresh is deterministic, cheap for the small JSON files involved, and keeps the mental model simple.
  Date/Author: 2026-04-06 / Codex

- Decision: match existing workspaces by case-insensitive space name, mirroring the existing rename and uniqueness rules.
  Rationale: `TerminalSpaceManager` already defines space-name equality semantics for the app. Reusing that rule prevents two competing ideas of whether `Dev Workspace` and `dev workspace` are “the same” space.
  Date/Author: 2026-04-06 / Codex

- Decision: keep richer workspace-launch data inside the per-window host path and do not extend `SupatermNewTabRequest`, `SupatermNewPaneRequest`, `SocketControlFeature`, or `TerminalWindowsClient` in v1.
  Rationale: the command palette talks to `TerminalClient`, which already targets `TerminalHostState` directly. Pushing workspace-only metadata into shared socket types would amplify changes into the CLI, IPC tests, and help surfaces without reducing any caller complexity inside the app.
  Date/Author: 2026-04-06 / Codex

- Decision: build workspace tabs by generalizing the existing recursive tree-construction path near `restoreNode`, not by chaining public `createPane` calls and then repairing layout afterward.
  Rationale: the host already knows how to construct a `SplitTree<GhosttySurfaceView>` with exact ratios. Reusing that shape keeps layout policy in one place, avoids repeated focus/session churn, and removes the need for a public-API orchestration layer inside the executor.
  Date/Author: 2026-04-06 / Codex

- Decision: v1 should not depend on turning the current placeholder palette rows into a full built-in command system.
  Rationale: the sample rows in `TerminalCommandPalette.swift` are not backed by a command boundary today, and wiring settings/rename-space behavior would add feature scope unrelated to user-defined commands. The palette state may stay generic enough for built-ins later, but custom commands must land independently.
  Date/Author: 2026-04-06 / Codex

## Outcomes & Retrospective

This initial planning pass identified that the main complexity is not terminal creation itself; Supaterm already has that machinery. The real complexity lives in the missing boundary between “a user-defined command” and the many existing primitives needed to carry it out. The plan therefore centers on a deep custom-command catalog and executor rather than more palette-specific conditionals. Implementation work remains.

The follow-up audit tightened that boundary further. The first draft was still too loose around config discovery, workspace matching, and recreate sequencing. The revised plan now keeps those policies aligned with the existing host rules and CLI schema surfaces, which removes more guesswork for the eventual implementer.

## Context and Orientation

Supaterm’s macOS app lives under `apps/mac/supaterm/`. The command palette overlay is rendered by `apps/mac/supaterm/Features/Terminal/Views/TerminalCommandPaletteView.swift`, but its state currently comes from `apps/mac/supaterm/Features/Terminal/TerminalCommandPalette.swift`, which returns hard-coded sample rows. The state is attached to `TerminalWindowFeature.State` in `apps/mac/supaterm/Features/Terminal/TerminalWindowFeature.swift`, and the current reducer only toggles visibility, updates the search text, moves the selection index, and closes the palette on activation.

The real terminal topology lives in `apps/mac/supaterm/Features/Terminal/TerminalHostState.swift`. A “space” is the top-level container in a window. A space contains tabs. A tab contains one split tree, where each leaf is a `GhosttySurfaceView`, the actual terminal pane. `TerminalHostState` already owns the operations that matter to this feature: creating spaces, creating tabs, creating panes, naming tabs, focusing panes, sending text, restoring recursive split trees, and changing split sizes. The key simplification this plan pursues is that callers should ask for “load the current custom commands” or “execute custom command X” and should not need to know how many space-catalog mutations, focus changes, split nodes, or environment variables that implies.

There is already a shared place for user-editable JSON contracts: `apps/mac/SupatermCLIShared/`. `apps/mac/SupatermCLIShared/AppPrefs.swift` defines the existing `settings.json` location, and `apps/mac/SupatermCLIShared/SupatermSettingsSchema.swift` plus `apps/mac/sp/SPInternalCommands.swift` define the current schema-generation pattern. That is the correct place to define the custom-command file format and its schema. The app-specific logic that discovers the focused project, merges global and local commands, and turns a chosen command into terminal mutations should live in a new `apps/mac/supaterm/Features/Terminal/CustomCommands/` folder.

The app-facing path for this feature is `TerminalClient`, not the socket boundary. `TerminalWindowFeature` depends on `TerminalClient`, and `TerminalClient.live(host:)` already calls into `TerminalHostState` directly. That matters because workspace-only metadata such as pane environment variables and tree-building instructions can remain internal to the host. The socket IPC described in `docs/how-socket-works.md` is still relevant for terminology and topology, but this plan should not add new socket request fields unless the implementation discovers a real need for CLI exposure.

The focused-pane context already exists inside `TerminalHostState`. `selectedSurfaceView`, `selectedSurfaceState`, and `workingDirectoryPath(for:)` are the seams that expose the current pane and its known working directory. The catalog loader should use those seams indirectly through `TerminalClient`, and when there is no selected pane or no known `pwd` yet, the loader should quietly fall back to the global file instead of surfacing a false project-local error.

Space naming also already has one rule in the app: names are compared case-insensitively through `TerminalSpaceManager`. Restart behavior must use the same rule when deciding whether a named workspace already exists. Otherwise the feature would create a second, conflicting definition of workspace identity.

The current tests already mark the seams this feature must preserve. `apps/mac/supatermTests/TerminalWindowFeatureTests.swift` covers palette state transitions. `apps/mac/supatermTests/TerminalWindowRegistryTests.swift` and `apps/mac/supatermTests/SupatermMenuControllerTests.swift` cover app-level palette toggling. `apps/mac/supatermTests/GhosttySurfaceViewEnvironmentTests.swift` covers environment injection. `apps/mac/supatermTests/TerminalHostStatePaneCreationTests.swift` and `apps/mac/supatermTests/TerminalHostStateSessionRestoreTests.swift` cover split-tree creation and restoration. `apps/mac/supatermTests/SPCommandTests.swift`, `apps/mac/supatermTests/SPHelpTests.swift`, and `apps/mac/supatermTests/SupatermSettingsSchemaTests.swift` show the existing pattern for internal schema commands and schema assertions. The implementation should extend those suites instead of creating ad hoc test harnesses.

## Plan of Work

Create a shared model for custom commands in `apps/mac/SupatermCLIShared/`. Add `SupatermCustomCommandsFile.swift` to define the top-level document, `SupatermCustomCommand.swift` to define the command union, and `SupatermCustomCommandsSchema.swift` to emit a JSON schema just as `SupatermSettingsSchema.swift` already does for `settings.json`. Add a matching internal CLI surface by extending `apps/mac/sp/SPInternalCommands.swift` with a `generate-custom-commands-schema` subcommand, and update `apps/mac/sp/SPHelp.swift`, `apps/mac/supatermTests/SPCommandTests.swift`, and `apps/mac/supatermTests/SPHelpTests.swift` to match the existing settings-schema pattern.

Keep the workspace model aligned with Supaterm’s real topology rather than inventing a generic layout language. A workspace definition should own `spaceName`, `restartBehavior`, and `tabs`. Each tab definition should own the final locked tab title, optional working directory, and one recursive pane tree. That pane tree should mirror the current `TerminalPaneNodeSession` shape: split nodes already have a direction and ratio, and leaf nodes already map naturally to working directory and pane title override. Add only the missing leaf metadata the session model does not carry today: initial shell command and custom environment variables. If the user-facing JSON supports `focus: true` markers, resolve them during decoding into one concrete selected tab plus one focused pane per tab, because the live host only supports one focused pane index per tab.

Resolve path handling and config locations inside the shared model or one small companion helper so callers never assemble paths by hand. Use `AppPrefs.defaultURL().deletingLastPathComponent()` as the existing source of truth for the global `~/.config/supaterm/` directory instead of introducing a second config-root helper. Discover the nearest project-local `supaterm.json` by walking upward from the focused pane’s normalized working directory using the same path normalization rules `TerminalHostState` already applies to pane `pwd`. If no pane is focused or the focused pane has no known working directory yet, load only the global file and surface no project-local error.

Create a deep app-owned boundary under `apps/mac/supaterm/Features/Terminal/CustomCommands/`. Add `TerminalCustomCommandCatalog.swift` as the public entry point and a dedicated `TerminalCustomCommandCatalogTests.swift` test file. The catalog should decode the global file, decode the nearest local file when one exists, resolve relative paths against the file that declared them, reject reserved environment keys (`PATH` and every `SUPATERM_*` key), merge local-over-global by `id`, and return both resolved command snapshots and user-visible load problems. Duplicate ids inside the same file should be a load problem; the later merge between files should be deterministic and intentional.

Do not make `TerminalWindowFeature` discover files or parse JSON. Extend `TerminalClient` with two new capabilities that hide the focused-pane lookup: one method that loads the current custom-command catalog and one method that executes a resolved command. Update `TerminalClient.live(host:)`, `TerminalClient.liveValue`, and `TerminalClient.testValue` together so the dependency surface stays coherent. This moves project-root discovery, merge precedence, restart behavior, and workspace sequencing out of the reducer and into one owned terminal boundary.

Replace the static palette state in `apps/mac/supaterm/Features/Terminal/TerminalCommandPalette.swift` with a model driven by resolved custom-command entries. The first implementation does not need to turn the placeholder sample rows into built-in commands. Instead, the state should hold `entries`, `visibleEntries`, selection, and an optional status or load-problem presentation. The view in `apps/mac/supaterm/Features/Terminal/Views/TerminalCommandPaletteView.swift` should render the filtered rows, a clear empty state when no commands match, and a concise error/footer area for load problems. Update the preview in that same file because it currently depends on the hard-coded sample rows.

Extend `TerminalWindowFeature` so opening the palette starts an asynchronous catalog refresh and closing the palette cancels or discards stale results. Activation should stop being “close only.” When the selected entry is a custom command, either execute it immediately or, if the command or restart behavior requires confirmation, present the existing `ConfirmationOverlay` by extending `ConfirmationTarget` and `confirmationRequest(for:)` rather than adding a second modal system. Update `TerminalWindowFeatureTests.swift`, `TerminalWindowRegistryTests.swift`, and `SupatermMenuControllerTests.swift` because all three assert palette behavior today.

Implement execution in `TerminalHostState` by concentrating orchestration in one place. Add a single host entry point, such as `executeCustomCommand(_:)`, plus private helpers that resolve the focused pane, find an existing space by case-insensitive name, and rebuild a named space without using the public `closeSpace(_:)` path. Rebuild must not call `closeSpace(_:)` directly for `recreate`, because that path auto-creates a replacement space when the last space is closed. Instead, mutate the space catalog and trees in one host-owned path, reusing helpers such as `deleteSpace(_:)` and `removeTrees(for:)` under `withSessionChangesSuppressed`, and then call `finalizeSpaceSelectionChange()` and `sessionDidChange()` once at the end.

Build workspace tabs by generalizing the existing split-tree creation path near `restoreNode`, not by chaining public `createPane` requests. Add a private helper that takes a resolved workspace tab definition and returns a `SplitTree<GhosttySurfaceView>.Node` plus the leaf surface IDs it created. That helper should create surfaces recursively with the final split ratios already in place, set `titleOverride` on leaves with `setTitleOverride(_:)`, set locked tab titles with `setLockedTabTitle(_:for:)`, and record the focused leaf without intermediate focus churn. This is the main complexity reduction: the caller describes one workspace tree, and the host owns every sequencing detail required to turn that tree into live panes.

Extend `GhosttySurfaceView` only where the runtime genuinely lacks an internal knob. Add `additionalEnvironmentVariables: [SupatermCLIEnvironmentVariable] = []` to the initializer and append those variables after the built-in Supaterm environment once validation has already rejected reserved keys. Do not add a new `title` field to public tab or pane creation requests; pane titles can already be set after creation through `setTitleOverride(_:)`, and tab titles already have a host-owned locked-title path. Keep richer leaf launch data internal to the workspace executor unless a later CLI use case proves it must cross the socket boundary.

Add schema and execution coverage in the files the repo already uses for similar seams. Create `apps/mac/supatermTests/SupatermCustomCommandsSchemaTests.swift` and `apps/mac/supatermTests/TerminalCustomCommandCatalogTests.swift`. Extend `GhosttySurfaceViewEnvironmentTests.swift` to prove custom variables are appended and reserved keys are rejected before surface creation. Replace the palette tests in `TerminalWindowFeatureTests.swift` that currently refer to `TerminalCommandPaletteRow.samples`. Add `apps/mac/supatermTests/TerminalCustomCommandExecutionTests.swift` for simple command execution, workspace creation, focused-pane resolution, restart behavior, and the “recreate last space” edge case. Use `withDependencies { $0.defaultFileStorage = .inMemory }` in host and reducer tests because these code paths touch shared file-backed state.

The complexity dividend after this work should be visible in the interfaces. `TerminalWindowFeature` will no longer know where command files live, how to walk parent directories, how to merge local and global commands, how to interpret focus markers, how to rebuild a named space safely, or how to recursively construct a pane tree. `TerminalHostState` and the custom command catalog will hide those details behind stable operations, so future command kinds or new layout options will extend one module instead of amplifying changes across palette UI, menu plumbing, and test fixtures.

## Concrete Steps

Work from the repository root:

    cd /Users/Developer/code/github.com/supabitapp/supaterm

Create the shared command model and schema files under `apps/mac/SupatermCLIShared/`. Update `apps/mac/sp/SPInternalCommands.swift` and `apps/mac/sp/SPHelp.swift` so the new schema can be inspected with an internal CLI command, matching the existing settings-schema pattern. Then create the app-side catalog and execution files under `apps/mac/supaterm/Features/Terminal/CustomCommands/`. Update `apps/mac/supaterm/Features/Terminal/TerminalClient.swift`, `apps/mac/supaterm/Features/Terminal/TerminalCommandPalette.swift`, `apps/mac/supaterm/Features/Terminal/TerminalWindowFeature.swift`, `apps/mac/supaterm/Features/Terminal/Views/TerminalCommandPaletteView.swift`, `apps/mac/supaterm/Features/Terminal/TerminalView.swift`, `apps/mac/supaterm/Features/Terminal/TerminalHostState.swift`, and `apps/mac/supaterm/Features/Terminal/Ghostty/GhosttySurfaceView.swift`. Update `apps/mac/supaterm/Features/Socket/SocketControlFeature.swift` only if the implementation ends up exposing any of this over the socket; that is not part of the intended first slice.

After the code compiles, verify that the schema command is wired correctly:

    swift run --package-path apps/mac/sp SPCLI internal generate-custom-commands-schema

Expected signal: the output is valid JSON, has an `$id`, and includes the top-level `commands` array.

Then create a temporary project-level command file in the repository root for manual validation. The exact shape may change during implementation, but the example should exercise one simple command and one workspace command with two panes and one focused leaf:

    {
      "$schema": "https://supaterm.com/data/supaterm-custom-commands.schema.json",
      "commands": [
        {
          "id": "pwd-here",
          "kind": "command",
          "name": "PWD Here",
          "description": "Print the current directory in the focused pane",
          "command": "pwd"
        },
        {
          "id": "dev-workspace",
          "kind": "workspace",
          "name": "Dev Workspace",
          "restartBehavior": "recreate",
          "workspace": {
            "spaceName": "Dev Workspace",
            "tabs": [
              {
                "title": "App",
                "selected": true,
                "rootPane": {
                  "type": "split",
                  "ratio": 0.5,
                  "direction": "right",
                  "first": {
                    "type": "leaf",
                    "title": "Server",
                    "cwd": ".",
                    "command": "pwd && echo server",
                    "env": {
                      "APP_ENV": "dev"
                    },
                    "focus": true
                  },
                  "second": {
                    "type": "leaf",
                    "title": "Logs",
                    "cwd": ".",
                    "command": "pwd && echo logs"
                  }
                }
              }
            ]
          }
        }
      ]
    }

Run the focused tests while iterating:

    xcodebuild test -workspace apps/mac/supaterm.xcworkspace -scheme supaterm -destination "platform=macOS" \
      -only-testing:supatermTests/SPCommandTests \
      -only-testing:supatermTests/SPHelpTests \
      -only-testing:supatermTests/SupatermCustomCommandsSchemaTests \
      -only-testing:supatermTests/TerminalCustomCommandCatalogTests \
      -only-testing:supatermTests/TerminalWindowFeatureTests \
      -only-testing:supatermTests/TerminalWindowRegistryTests \
      -only-testing:supatermTests/SupatermMenuControllerTests \
      -only-testing:supatermTests/GhosttySurfaceViewEnvironmentTests \
      -only-testing:supatermTests/TerminalCustomCommandExecutionTests \
      CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" -skipMacroValidation

Expected signal: the schema/help/parser tests prove the new CLI surface, the palette tests stop depending on `TerminalCommandPaletteRow.samples`, and the execution tests prove simple commands plus workspace recreation.

Run the broader project checks before considering the work complete:

    make mac-check
    make mac-test

For manual verification, launch the app:

    make mac-run

Inside the running app, focus a pane and first run:

    cd /Users/Developer/code/github.com/supabitapp/supaterm

Then press `cmd-p`, type `PWD Here`, press return, and observe that the focused pane prints the repository path. Reopen the palette, run `Dev Workspace`, and then in one of the created panes run:

    sp tree --json

Expected signal: the JSON tree contains a space named `Dev Workspace`, one selected tab titled `App`, and two panes with the expected titles. Run the workspace command a second time and confirm that `restartBehavior: "recreate"` replaces the same named space instead of leaving behind a dummy default space.

## Validation and Acceptance

Acceptance is behavioral and should be proven in both tests and a live run.

The shared model is correct when invalid files fail softly, relative paths are resolved against the defining file, local `supaterm.json` overrides global commands by `id`, multiple focus markers are rejected or normalized deterministically, and reserved environment keys are rejected. Prove this with `TerminalCustomCommandCatalogTests.swift` and `SupatermCustomCommandsSchemaTests.swift`.

The palette integration is correct when opening the palette shows the resolved custom commands from the focused project and the global file, falls back to global-only commands when the focused pane has no known `pwd`, search filters by name/description/keywords, the empty state is intelligible when nothing matches, and load problems are visible without breaking the rest of the palette. Prove this with `TerminalWindowFeatureTests.swift`, `TerminalWindowRegistryTests.swift`, `SupatermMenuControllerTests.swift`, and by a manual `cmd-p` run in the app.

Simple command execution is correct when selecting a custom command injects the configured shell text into the focused pane without changing the selected tab or space. Prove this with a host-state test that exercises `sendText`, and manually by running `PWD Here` and observing the printed directory.

Workspace execution is correct when selecting a workspace command creates or focuses the named space, creates the configured tabs in order, materializes the configured split tree with the requested ratios in one host-owned path, sets titles, injects allowed environment variables, and focuses the requested pane. Prove this with `TerminalCustomCommandExecutionTests.swift` and manually by running `sp tree --json` after the workspace command completes.

Restart behavior is correct when `focus_existing` only selects the matching space, `recreate` replaces it immediately without creating an extra default space, `confirm_recreate` routes through the existing `ConfirmationOverlay` before replacement, and existing-space lookup follows the same case-insensitive semantics as manual space naming. Prove this with reducer tests and host-state tests that execute the same workspace twice, including the single-space window case and a name-case mismatch scenario.

The schema CLI surface is correct when `SPCommandTests.swift` parses `sp internal generate-custom-commands-schema`, `SPHelpTests.swift` shows the new help example, and the command prints valid JSON. The feature is complete only after `make mac-check` and `make mac-test` pass.

## Idempotence and Recovery

The implementation steps are additive and safe to repeat. Re-running the loader should always yield the same merged catalog for the same files. Reopening the palette should refresh from disk and replace stale results without accumulating duplicates. Re-executing a simple command is naturally repeatable. Re-executing a workspace command depends on its declared restart behavior and must be deterministic.

If the temporary `supaterm.json` used for manual validation causes confusing results, delete or rename that file and reopen the palette. Because project-local command discovery walks upward from the focused pane, changing the pane’s working directory to another project is also a safe way to validate isolation. If a schema change breaks decoding, the recovery path is to fix the JSON file or remove it; the palette must remain usable even while custom commands fail to load. If the focused pane has no known working directory during a test run, treat that as a catalog fallback scenario, not as a loader failure.

If workspace recreation destabilizes space selection, temporarily keep `focus_existing` working while narrowing the recreate path to one space at a time, but do not fall back to the public `closeSpace(_:)` path for the last-space case because it bakes in the dummy-space behavior the feature is supposed to avoid. If custom environment support causes launch regressions, keep the catalog and palette work compiling while gating workspace env application behind validation that rejects reserved keys. The tests named above should make the failing seam obvious.

## Artifacts and Notes

Expected example transcript for the schema CLI:

    $ swift run --package-path apps/mac/sp SPCLI internal generate-custom-commands-schema | jq '.properties.commands.type'
    "array"

Expected example transcript for a successful manual run:

    $ sp tree --json | jq '.windows[0].spaces[] | {name, tabs: [.tabs[] | {title, panes: [.panes[] | .title]}]}'
    {
      "name": "Dev Workspace",
      "tabs": [
        {
          "title": "App",
          "panes": [
            "Server",
            "Logs"
          ]
        }
      ]
    }

Expected example transcript for a focused simple command:

    $ pwd
    /Users/Developer/code/github.com/supabitapp/supaterm

The most important implementation constraint is that callers should not learn sequencing. The palette reducer must not know how to walk parent directories, merge files, validate environment keys, recreate a space safely, or recursively build a pane tree. If the implementation pushes that knowledge upward into UI state or out into socket request types, it has failed the design goal even if the feature appears to work.

## Interfaces and Dependencies

In `apps/mac/SupatermCLIShared/SupatermCustomCommandsFile.swift`, define stable Codable models that represent the JSON contract. The end state should include a top-level `SupatermCustomCommandsFile`, a `SupatermCustomCommand` tagged union for `command` and `workspace`, a `SupatermWorkspaceDefinition`, a `SupatermWorkspaceTabDefinition`, a recursive `SupatermWorkspacePaneDefinition`, and a small `SupatermWorkspaceEnvironment` or equivalent value type that decodes from a JSON object of string pairs. These types hide the on-disk format from the app and give tests one shared vocabulary.

In `apps/mac/SupatermCLIShared/SupatermCustomCommandsSchema.swift`, expose:

    public enum SupatermCustomCommandsSchema {
      public static let url: String
      public static func jsonString() throws -> String
    }

This hides JSON Schema construction from callers and keeps editor-completion support alongside the model. Mirror the existing settings-schema flow by also adding `SP.GenerateCustomCommandsSchema` in `apps/mac/sp/SPInternalCommands.swift` and help coverage in `apps/mac/sp/SPHelp.swift`.

In `apps/mac/supaterm/Features/Terminal/CustomCommands/TerminalCustomCommandCatalog.swift`, define a deep catalog boundary similar to:

    struct TerminalCustomCommandCatalogResult: Equatable, Sendable {
      let commands: [TerminalCustomCommandSnapshot]
      let problems: [TerminalCustomCommandProblem]
    }

    struct TerminalCustomCommandCatalogClient: Sendable {
      var load: @MainActor @Sendable (_ focusedWorkingDirectory: String?) async -> TerminalCustomCommandCatalogResult
    }

`TerminalCustomCommandSnapshot` should contain only resolved absolute paths, merged metadata, resolved restart behavior, already-validated environment variables, and enough focus information to map cleanly onto one selected tab plus one focused pane per tab, so no caller needs to know which file a `cwd` came from or whether the source was local or global.

In `apps/mac/supaterm/Features/Terminal/TerminalClient.swift`, add:

    var loadCustomCommands: @MainActor @Sendable () async -> TerminalCustomCommandCatalogResult
    var executeCustomCommand: @MainActor @Sendable (TerminalExecuteCustomCommandRequest) async throws -> TerminalExecuteCustomCommandResult

and define `TerminalExecuteCustomCommandRequest` / `TerminalExecuteCustomCommandResult` in the same file. Update `live(host:)`, `liveValue`, and `testValue` in the same edit. These methods hide focused-pane lookup and workspace sequencing from `TerminalWindowFeature`.

In `apps/mac/supaterm/Features/Terminal/TerminalCommandPalette.swift`, replace the sample-only row model with a palette entry model driven by custom commands and palette status:

    struct TerminalCommandPaletteEntry: Equatable, Identifiable {
      let id: String
      let symbol: String
      let title: String
      let subtitle: String
      let command: TerminalCustomCommandSnapshot
    }

    struct TerminalCommandPaletteState: Equatable {
      var allEntries: [TerminalCommandPaletteEntry]
      var query: String
      var selectedIndex: Int
      var problems: [TerminalCustomCommandProblem]
    }

The state should expose `visibleEntries` and should clamp `selectedIndex` against `visibleEntries.count`. If the implementation chooses to keep the type generic enough for future built-ins, that is fine, but the first slice must not depend on wiring every placeholder sample row into a real action.

In `apps/mac/supaterm/Features/Terminal/Ghostty/GhosttySurfaceView.swift`, extend the initializer to accept:

    additionalEnvironmentVariables: [SupatermCLIEnvironmentVariable] = []

and append those variables after the built-in Supaterm environment. Validate and reject reserved keys before the initializer is called. This hides all environment-merging policy inside the surface, where the actual process launch configuration is already owned.

In `apps/mac/supaterm/Features/Terminal/TerminalHostState.swift`, add a single execution entry point, such as:

    func executeCustomCommand(_ request: TerminalExecuteCustomCommandRequest) throws -> TerminalExecuteCustomCommandResult

plus private helpers for loading the focused working directory, resolving an existing named space with the same case-insensitive semantics as `TerminalSpaceManager`, rebuilding a space without the public `closeSpace(_:)` dummy-space behavior, and materializing a workspace tab by recursively creating a `SplitTree<GhosttySurfaceView>.Node` in one pass. This is the deep module at the center of the feature; it should hide every orchestration detail from the reducer and view layers.

Revision note: created the initial ExecPlan on 2026-04-06 to replace the earlier issue-level summary with a repository-local, self-contained implementation specification that a new contributor can execute without prior context.

Revision note: improved the ExecPlan on 2026-04-06 after auditing the referenced code. The revised plan removes unnecessary socket/CLI request changes from the first slice, grounds workspace materialization in the existing recursive split-tree restore path, adds the missing schema/help/test surfaces, and calls out the last-space recreation and reserved-environment safety edges that the initial draft missed.

Revision note: improved the ExecPlan again on 2026-04-06 after a second code audit. This pass aligned config discovery with `AppPrefs.defaultURL()`, made the no-focused-`pwd` fallback explicit, required case-insensitive workspace matching to mirror existing space-name rules, and pointed the recreate path at the host’s existing batching and tree-removal helpers so the implementation surface is narrower and less ambiguous.

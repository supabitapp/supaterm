# Support custom command palette entries and workspace launches

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

The repository-local plan template is [`.agents/plans/06-04-26-custom-command-palette-PLANS.md`](.agents/plans/06-04-26-custom-command-palette-PLANS.md). This document must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, a Supaterm user can define reusable commands in JSON and invoke them from the command palette. A simple command will run in the focused pane. A workspace command will create or focus a named space and materialize a repeatable layout of tabs and panes, including per-pane working directory, startup command, title, and environment variables. The user will be able to prove this works by placing a `supaterm.json` file in a project directory, opening the command palette with `cmd-p`, selecting the new command, and then verifying the resulting terminal tree with `sp tree --json`.

Today the command palette is a visual shell with hard-coded sample rows, while the real creation logic lives elsewhere in `TerminalHostState`. Anyone adding user-defined commands would currently have to spread policy across palette state, window feature state, file discovery, path resolution, confirmation flow, and terminal creation APIs. This plan removes that burden by introducing one owned custom-command boundary that hides configuration discovery, merge precedence, path normalization, and workspace sequencing behind stable interfaces.

## Progress

- [x] (2026-04-06 08:20Z) Inspected the existing command palette, terminal creation flow, surface environment injection, socket protocol, and test coverage to anchor the design in current code.
- [x] (2026-04-06 08:35Z) Authored the initial ExecPlan and checked it into `.agents/plans/06-04-26-custom-command-palette-PLANS-pending.md`.
- [ ] Implement the shared custom-command model, schema, loader, and merge rules in `apps/mac/SupatermCLIShared/` and `apps/mac/supaterm/Features/Terminal/CustomCommands/`.
- [ ] Replace the static command palette rows with built-in plus custom entries, including load failure presentation and custom command activation.
- [ ] Implement workspace execution, restart policies, per-surface title/environment support, and the full regression suite.

## Surprises & Discoveries

- Observation: the palette currently owns no executable intent at all; activation only closes the overlay.
  Evidence: `apps/mac/supaterm/Features/Terminal/TerminalWindowFeature.swift` handles `commandPaletteActivateSelection` by setting `state.commandPalette = nil` and returning `.none`, and `apps/mac/supatermTests/TerminalWindowFeatureTests.swift` asserts only that the palette closes.

- Observation: the existing runtime already knows how to create tabs, split panes, send shell text, rename tabs, rename spaces, resize panes, and set absolute pane size.
  Evidence: `apps/mac/supaterm/Features/Terminal/TerminalHostState.swift` exposes `createTab`, `createPane`, `sendText`, `renameTab`, `renameSpace`, `setPaneSize`, `equalizePanes`, and `tilePanes`.

- Observation: the shared tab and pane creation requests already carry `command` and `cwd`, but not tab title or custom environment variables.
  Evidence: `apps/mac/SupatermCLIShared/SupatermSocketProtocol.swift` defines `SupatermNewTabRequest` with `command`, `cwd`, and focus/target fields, and `SupatermNewPaneRequest` with `command` plus target fields only.

- Observation: `GhosttySurfaceView` injects Supaterm pane metadata and a rewritten `PATH`, but there is no facility to append user-provided `KEY=value` pairs per surface.
  Evidence: `apps/mac/supaterm/Features/Terminal/Ghostty/GhosttySurfaceView.swift` builds `environmentVariables` exclusively from `SupatermCLIContext`, socket path, CLI path, and `PATH`; `apps/mac/supatermTests/GhosttySurfaceViewEnvironmentTests.swift` verifies only those variables.

- Observation: the cleanest way to support explicit split sizing already exists in the host and does not require new layout math.
  Evidence: `TerminalHostState.setPaneSize` delegates to `SplitTree.sizing`, which means workspace materialization can create equalized panes first and then apply any explicit size directives after the tree exists.

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

- Decision: support optional explicit pane sizing in v1 by applying `setPaneSize` after the workspace tree has been created.
  Rationale: this preserves a user-visible capability similar to the reference behavior without inventing new tree-building primitives. The host already owns the needed size operation.
  Date/Author: 2026-04-06 / Codex

## Outcomes & Retrospective

This initial planning pass identified that the main complexity is not terminal creation itself; Supaterm already has that machinery. The real complexity lives in the missing boundary between “a user-defined command” and the many existing primitives needed to carry it out. The plan therefore centers on a deep custom-command catalog and executor rather than more palette-specific conditionals. Implementation work remains.

## Context and Orientation

Supaterm’s macOS app lives under `apps/mac/supaterm/`. The command palette overlay is rendered by `apps/mac/supaterm/Features/Terminal/Views/TerminalCommandPaletteView.swift`, but its state currently comes from `apps/mac/supaterm/Features/Terminal/TerminalCommandPalette.swift`, which returns hard-coded sample rows. The state is attached to `TerminalWindowFeature.State` in `apps/mac/supaterm/Features/Terminal/TerminalWindowFeature.swift`, and the current reducer only toggles visibility, updates the search text, moves the selection index, and closes the palette on activation.

The real terminal topology lives in `apps/mac/supaterm/Features/Terminal/TerminalHostState.swift`. A “space” is the top-level container in a window. A space contains tabs. A tab contains one split tree, where each leaf is a `GhosttySurfaceView`, the actual terminal pane. `TerminalHostState` already owns the difficult operations that matter to this feature: creating tabs, creating panes, naming tabs, naming spaces, focusing panes, sending text, and changing split sizes. The key simplification this plan pursues is that callers should ask for “execute custom command X” and should not need to know how many tabs, panes, focus changes, or size operations that implies.

There is already a shared place for user-editable JSON contracts: `apps/mac/SupatermCLIShared/`. `apps/mac/SupatermCLIShared/AppPrefs.swift` and `apps/mac/SupatermCLIShared/SupatermSettingsSchema.swift` define the existing `settings.json` file and its schema. That is the correct place to define the custom-command file format as a stable contract. The app-specific logic that discovers the focused project, merges global and local commands, and turns a chosen command into terminal mutations should live in a new `apps/mac/supaterm/Features/Terminal/CustomCommands/` folder.

The socket IPC boundary described in `docs/how-socket-works.md` and implemented by `apps/mac/SupatermCLIShared/SupatermSocketProtocol.swift` plus `apps/mac/supaterm/Features/Socket/SocketControlFeature.swift` is relevant because tab and pane creation requests are already shared between the app and `sp`. This plan preserves a single creation vocabulary. If tab title and per-surface environment become first-class in the internal terminal creation requests, the shared request types should be extended in parallel so the app and CLI do not drift into separate concepts for creating a tab or pane.

The current tests already mark the seams this feature must preserve. `apps/mac/supatermTests/TerminalWindowFeatureTests.swift` covers palette state transitions. `apps/mac/supatermTests/SupatermSocketProtocolTests.swift` and `apps/mac/supatermTests/SocketControlFeatureTests.swift` cover request serialization. `apps/mac/supatermTests/GhosttySurfaceViewEnvironmentTests.swift` covers environment injection. `apps/mac/supatermTests/TerminalHostStatePaneCreationTests.swift` and neighboring host-state tests cover pane and tab creation behavior. The implementation should extend those suites instead of creating ad hoc test harnesses.

## Plan of Work

Create a shared model for custom commands in `apps/mac/SupatermCLIShared/`. Add `SupatermCustomCommandsFile.swift` to define the top-level document, `SupatermCustomCommand.swift` to define the command union, and `SupatermCustomCommandsSchema.swift` to emit a JSON schema just as `SupatermSettingsSchema.swift` already does for `settings.json`. The top-level file format should be a single object with a `commands` array. Each command must have a stable `id`, `name`, optional `description`, optional `keywords`, and a `kind` discriminator. `kind == "command"` represents a simple command. `kind == "workspace"` represents a named workspace launch.

Keep the workspace model aligned with Supaterm’s topology rather than inventing a generic graph. A workspace definition should own `spaceName`, `restartBehavior`, and `tabs`. Each tab definition should own `title`, optional `cwd`, optional `focus`, and `rootPane`. `rootPane` should be a recursive union of either a leaf pane or a split node. A leaf pane should own `title`, `cwd`, `command`, optional `env`, and optional `focus`. A split node should own `direction`, `first`, `second`, and optional size instructions to be applied after creation. Define size instructions in plain terms: axis (`horizontal` or `vertical`), unit (`percent` or `cells`), and numeric amount. This keeps the JSON model close to the existing `TerminalSetPaneSizeRequest`.

Resolve path handling inside the model layer so callers never concatenate paths themselves. Add helpers that take the file URL that defined a command and return a normalized runtime snapshot where every relative `cwd` has already been expanded against that file’s parent directory. This is the first place the complexity dividend appears: the palette, the window feature, and the terminal host will deal only in resolved command snapshots, not raw JSON plus “where did this come from?” bookkeeping.

Create a deep app-owned boundary under `apps/mac/supaterm/Features/Terminal/CustomCommands/`. Add `TerminalCustomCommandCatalog.swift` as the public entry point. Its job is to discover the nearest project-local `supaterm.json` by walking upward from the focused pane’s effective working directory, load the global `~/.config/supaterm/supaterm.json`, decode both documents with the shared model, resolve all relative paths, merge them with local-over-global precedence by `id`, and return a stable `[TerminalCustomCommandSnapshot]`. The catalog should also collect user-visible problems such as invalid JSON, duplicate local ids, or an unreadable file into `[TerminalCustomCommandProblem]` so the palette can show errors without collapsing.

Do not make `TerminalWindowFeature` discover files or parse JSON. Instead, extend `TerminalClient` with two new capabilities that hide the focused-pane lookup: one method that asks the host for the current custom-command catalog and one method that executes a resolved custom command. The exact names should be stable and explicit, such as `loadCustomCommands() async -> TerminalCustomCommandCatalogResult` and `executeCustomCommand(_ request: TerminalExecuteCustomCommandRequest) async throws -> TerminalExecuteCustomCommandResult`. `TerminalHostState` will satisfy both methods because it already knows the selected space, selected tab, focused surface, and current pane working directories. This moves project-root discovery, restart behavior, and workspace sequencing out of the palette reducer and into one owned terminal boundary.

Replace the static palette state in `apps/mac/supaterm/Features/Terminal/TerminalCommandPalette.swift` with a model that can hold built-ins plus loaded custom commands. Introduce a single entry type, for example `TerminalCommandPaletteEntry`, with two cases: built-in action and custom command snapshot. The state should store all entries, compute visible entries from `query`, and clamp selection against the filtered list instead of `samples`. Search should match `name`, `description`, and `keywords` case-insensitively. The row subtitle should tell the user whether an entry is built-in, project-local, or global. Load problems from the catalog should be rendered as a muted non-selectable message in the palette overlay so configuration errors are visible in context and do not need a second notification system.

Extend `TerminalWindowFeature` so opening the palette first seeds the built-in entries, then asynchronously asks `terminalClient.loadCustomCommands()` for the focused context and merges the result into palette state. Activation should stop being “close only.” When the selected entry is built-in, preserve the existing UI action behavior. When the selected entry is custom, close the palette and call `terminalClient.executeCustomCommand`. Confirmation must reuse the existing confirmation overlay instead of adding another modal code path. Add a second confirmation target for custom command execution, such as “run command” and “recreate workspace,” so the existing `ConfirmationOverlay` remains the only confirmation UI.

Implement execution in `TerminalHostState` by concentrating orchestration in one place. A simple command should resolve the focused pane, send shell text to that pane, and optionally surface a confirmation request first. A workspace command should resolve whether a space with the same logical name already exists, apply the command’s restart behavior, and then build the space topology. `focus_existing` should select the existing space and its remembered tab. `recreate` should close the existing space and rebuild it immediately. `confirm_recreate` should ask for confirmation first, then rebuild only when the user accepts.

Materialize workspaces in the order space -> tabs -> pane tree -> post-creation adjustments. First create or select the target space. Then create every tab in order. For each tab, create the root surface by using the tab creation path and then recursively split from the focused or newly created anchor surface to add sibling panes. Keep the split creation algorithm deterministic: for a split node, fully materialize `first`, then split that leaf in the requested direction to create `second`, then recurse into child split nodes. After the full tab tree exists, apply any explicit size instructions using `setPaneSize`, then rename tabs and focus the selected pane. The executor should return a concise `TerminalExecuteCustomCommandResult` containing the final targeted space, tab, and pane so tests can assert behavior.

Extend the terminal creation vocabulary to cover the fields the executor needs. Add optional `title` and `environment` fields to both `TerminalCreateTabRequest` / `TerminalCreatePaneRequest` in `apps/mac/supaterm/Features/Terminal/TerminalClient.swift` and their shared counterparts `SupatermNewTabRequest` / `SupatermNewPaneRequest` in `apps/mac/SupatermCLIShared/SupatermSocketProtocol.swift`. Thread those fields through `SocketControlFeature`, `TerminalWindowRegistry`, and `TerminalHostState.createTab` / `createPane`. Update `GhosttySurfaceView` so its initializer accepts additional environment variables and appends them after the built-in Supaterm environment. Use the existing `titleOverride` and tab rename mechanisms so titles remain owned by the host instead of by palette code.

Add schema and serialization coverage first. Create `apps/mac/supatermTests/SupatermCustomCommandsSchemaTests.swift` for schema generation and decoder behavior. Extend `SupatermSocketProtocolTests` and `SocketControlFeatureTests` to prove the new optional `title` and `environment` fields round-trip. Extend `GhosttySurfaceViewEnvironmentTests` to prove custom environment variables are appended without losing Supaterm’s injected keys or PATH rewriting. Replace the palette tests in `TerminalWindowFeatureTests` that currently refer to `TerminalCommandPaletteRow.samples` with tests against loaded entries and activation behavior. Add new host-state tests, ideally `TerminalCustomCommandExecutionTests.swift`, that cover local-over-global precedence, simple command execution, workspace creation order, explicit focus behavior, and restart policy handling.

The complexity dividend after this work should be visible in the interfaces. `TerminalWindowFeature` will no longer know where command files live, how to walk parent directories, how to merge local and global commands, how to expand relative paths, how to recreate a named space, or how to turn a recursive layout into a sequence of tab and pane mutations. `TerminalHostState` and the custom command catalog will hide those details behind stable operations, so future command kinds or new layout options will extend one module instead of amplifying changes across palette UI, reducer state, and ad hoc helpers.

## Concrete Steps

Work from the repository root:

    cd /Users/Developer/code/github.com/supabitapp/supaterm

Create the shared command model and schema files under `apps/mac/SupatermCLIShared/`, then the app-side catalog and execution files under `apps/mac/supaterm/Features/Terminal/CustomCommands/`. Update `apps/mac/supaterm/Features/Terminal/TerminalClient.swift`, `apps/mac/supaterm/Features/Terminal/TerminalCommandPalette.swift`, `apps/mac/supaterm/Features/Terminal/TerminalWindowFeature.swift`, `apps/mac/supaterm/Features/Terminal/Views/TerminalCommandPaletteView.swift`, `apps/mac/supaterm/Features/Terminal/TerminalHostState.swift`, `apps/mac/supaterm/App/TerminalWindowRegistry.swift`, `apps/mac/supaterm/Features/Socket/SocketControlFeature.swift`, and `apps/mac/supaterm/Features/Terminal/Ghostty/GhosttySurfaceView.swift`.

After the code compiles, create a temporary project-level command file in a throwaway directory or in this repository root for manual validation:

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
                "rootPane": {
                  "type": "split",
                  "direction": "right",
                  "first": {
                    "type": "leaf",
                    "title": "Server",
                    "cwd": ".",
                    "command": "pwd && echo server",
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
      -only-testing:supatermTests/TerminalWindowFeatureTests \
      -only-testing:supatermTests/SupatermSocketProtocolTests \
      -only-testing:supatermTests/SocketControlFeatureTests \
      -only-testing:supatermTests/GhosttySurfaceViewEnvironmentTests \
      CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" -skipMacroValidation

Expected signal: the existing palette tests must be updated to the new state model, and the new serialization and environment tests must pass.

Run the broader project checks before considering the work complete:

    make mac-check
    make mac-test

For manual verification, launch the app:

    make mac-run

Inside the running app, focus a pane whose working directory can see the test `supaterm.json`, press `cmd-p`, type `PWD Here`, press return, and observe that the focused pane prints its directory. Reopen the palette, run `Dev Workspace`, and then in one of the created panes run:

    sp tree --json

Expected signal: the JSON tree contains a space named `Dev Workspace`, one tab titled `App`, and two panes with the expected titles.

## Validation and Acceptance

Acceptance is behavioral and should be proven in both tests and a live run.

The shared model is correct when invalid files fail softly, relative paths are resolved against the defining file, and local `supaterm.json` overrides global commands by `id`. Prove this with unit tests that decode both files and assert the merged snapshots.

The palette integration is correct when opening the palette shows the built-in commands plus custom commands from the focused project and the global file, search filters the combined list by name/description/keywords, and selecting a built-in still triggers the same behavior it did before. Prove this with `TerminalWindowFeatureTests` and by a manual `cmd-p` run in the app.

Simple command execution is correct when selecting a custom command injects the configured shell text into the focused pane without changing the selected tab or space. Prove this with a host-state test that exercises `sendText`, and manually by running `PWD Here` and observing the printed directory.

Workspace execution is correct when selecting a workspace command creates or focuses the named space, creates the configured tabs in order, materializes the configured split tree, applies explicit pane size instructions, sets titles, injects environment variables, and focuses the requested pane. Prove this with host-state tests and manually by running `sp tree --json` after the workspace command completes.

Restart behavior is correct when `focus_existing` only selects the matching space, `recreate` replaces it immediately, and `confirm_recreate` routes through the existing `ConfirmationOverlay` before replacement. Prove this with reducer tests and host-state tests that execute the same workspace twice.

The feature is complete only after `make mac-check` and `make mac-test` pass.

## Idempotence and Recovery

The implementation steps are additive and safe to repeat. Re-running the loader should always yield the same merged catalog for the same files. Reopening the palette should refresh from disk and replace stale results without accumulating duplicates. Re-executing a simple command is naturally repeatable. Re-executing a workspace command depends on its declared restart behavior and must be deterministic.

If the temporary `supaterm.json` used for manual validation causes confusing results, delete or rename that file and reopen the palette. Because project-local command discovery walks upward from the focused pane, changing the pane’s working directory to another project is also a safe way to validate isolation. If a schema change breaks decoding, the recovery path is to fix the JSON file or remove it; the palette must remain usable for built-in commands even while custom commands fail to load.

If the new optional `title` and `environment` fields destabilize the shared request types, revert only those field additions and keep the catalog, palette, and simple command execution work compiling while reintroducing the creation fields in a smaller slice. The tests named above should make the failing seam obvious.

## Artifacts and Notes

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

The most important implementation constraint is that callers should not learn sequencing. The palette reducer must not know how to walk parent directories, merge files, recreate a space, or recursively build a pane tree. If the implementation pushes that knowledge upward into UI state, it has failed the design goal even if the feature appears to work.

## Interfaces and Dependencies

In `apps/mac/SupatermCLIShared/SupatermCustomCommandsFile.swift`, define stable Codable models that represent the JSON contract. The end state should include a top-level `SupatermCustomCommandsFile`, a `SupatermCustomCommand` tagged union for `command` and `workspace`, a `SupatermWorkspaceDefinition`, a `SupatermWorkspaceTabDefinition`, a recursive `SupatermWorkspacePaneDefinition`, and a small `SupatermWorkspacePaneSize` value type. These types hide the on-disk format from the app and give tests one shared vocabulary.

In `apps/mac/SupatermCLIShared/SupatermCustomCommandsSchema.swift`, expose:

    public enum SupatermCustomCommandsSchema {
      public static let url: String
      public static func jsonString() throws -> String
    }

This hides JSON Schema construction from callers and keeps editor-completion support alongside the model.

In `apps/mac/supaterm/Features/Terminal/CustomCommands/TerminalCustomCommandCatalog.swift`, define a deep catalog boundary similar to:

    struct TerminalCustomCommandCatalogResult: Equatable, Sendable {
      let commands: [TerminalCustomCommandSnapshot]
      let problems: [TerminalCustomCommandProblem]
    }

    struct TerminalCustomCommandCatalogClient: Sendable {
      var load: @MainActor @Sendable (_ focusedWorkingDirectory: String?) async -> TerminalCustomCommandCatalogResult
    }

`TerminalCustomCommandSnapshot` should contain only resolved absolute paths and merged metadata, so no caller needs to know which file a `cwd` came from or whether the source was local or global.

In `apps/mac/supaterm/Features/Terminal/TerminalClient.swift`, add:

    var loadCustomCommands: @MainActor @Sendable () async -> TerminalCustomCommandCatalogResult
    var executeCustomCommand: @MainActor @Sendable (TerminalExecuteCustomCommandRequest) async throws -> TerminalExecuteCustomCommandResult

and define `TerminalExecuteCustomCommandRequest` / `TerminalExecuteCustomCommandResult` in the same file. These methods hide focused-pane lookup and workspace sequencing from `TerminalWindowFeature`.

In `apps/mac/supaterm/Features/Terminal/TerminalCommandPalette.swift`, replace the sample-only row model with a palette entry model that can express both built-ins and custom commands:

    enum TerminalCommandPaletteEntry: Equatable, Identifiable {
      case builtIn(BuiltInPaletteAction)
      case custom(TerminalCustomCommandSnapshot)
    }

The state should expose `visibleEntries` and should clamp `selectedIndex` against `visibleEntries.count`.

In `apps/mac/supaterm/Features/Terminal/Ghostty/GhosttySurfaceView.swift`, extend the initializer to accept:

    additionalEnvironmentVariables: [SupatermCLIEnvironmentVariable] = []

and append those variables after the built-in Supaterm environment. This hides all environment-merging policy inside the surface, where the actual process launch configuration is already owned.

In `apps/mac/supaterm/Features/Terminal/TerminalHostState.swift`, add a single execution entry point, such as:

    func executeCustomCommand(_ request: TerminalExecuteCustomCommandRequest) throws -> TerminalExecuteCustomCommandResult

plus private helpers for loading the focused working directory, resolving an existing named space, materializing workspace tabs/panes, and applying post-creation size instructions. This is the deep module at the center of the feature; it should hide every orchestration detail from the reducer and view layers.

Revision note: created the initial ExecPlan on 2026-04-06 to replace the earlier issue-level summary with a repository-local, self-contained implementation specification that a new contributor can execute without prior context.

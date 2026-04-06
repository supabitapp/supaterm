# Add a Terminal Settings Tab With Live Ghostty Preview

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

After this change, a Supaterm user can open Settings, choose a Ghostty font family and font size from a dedicated `Terminal` tab, and immediately see the result in a small embedded terminal preview. The selection writes back to the user’s primary Ghostty config file, reloads active Supaterm terminal runtimes, and keeps the preview aligned with the same config source. The user no longer needs to know the config path, remember Ghostty config syntax, or manually trigger a reload just to change typography.

The current complexity is paid in three places. Users must hand-edit `~/.config/ghostty/config`, understand `font-family` and `font-size`, and guess whether reload happened. `SettingsFeature` currently has no owned place for external file-backed terminal settings, so the implementation could easily leak file edits and reload sequencing into the reducer. `GhosttyRuntime` already owns live config reload, but it does not preserve all of the information needed to reload an explicitly supplied config path safely. The target design simplifies this by introducing one terminal-settings boundary that owns config-file mutation and validation, while the runtime layer owns reload fanout and callers only express user intent.

## Progress

- [x] (2026-04-06 06:41Z) Read `.agent/PLANS.md`, inspected the current Settings feature, Settings window routing, Supaterm’s Ghostty runtime/view layer, and the vendored Ghostty macOS config/reload code.
- [ ] Add a file-backed Ghostty terminal-settings boundary that loads, validates, edits, and writes font settings from the primary Ghostty config file.
- [ ] Fix `GhosttyRuntime` so reload preserves both the original config path and whether CLI args were part of the initial load.
- [ ] Extend `SettingsFeature` and `SettingsView` with a `Terminal` tab, a non-interactive preview, and explicit handling for the default or unset font-family case.
- [ ] Add regression tests for config mutation, config diagnostics, runtime reload fanout, tab routing, and reducer behavior, including a new test helper that keeps a temporary config file alive across reload.

## Surprises & Discoveries

- Observation: Supaterm does not embed Ghostty’s full `Ghostty.App` object for the app UI; it uses its own `GhosttyRuntime` and `GhosttySurfaceView` layer in `apps/mac/supaterm/Features/Terminal/Ghostty/`.
  Evidence: `GhosttyBootstrap.initialize()` only calls `ghostty_init`, while `TerminalHostState.createSurface` creates `GhosttySurfaceView` from Supaterm’s `GhosttyRuntime`.

- Observation: Supaterm already has the pieces needed for a preview surface.
  Evidence: `apps/mac/supaterm/Features/Terminal/Ghostty/GhosttyTerminalView.swift` renders a `GhosttySurfaceView` through `GhosttySurfaceScrollView`, and `GhosttySurfaceView.init` already accepts optional per-surface setup such as `fontSize`, `initialInput`, and `context`.

- Observation: the current Settings UI has no terminal-specific state; the General tab only tells the user to edit Ghostty config by hand.
  Evidence: `apps/mac/supaterm/Features/Settings/SettingsFeature.swift` stores app prefs and agent-hook state only, while `apps/mac/supaterm/Features/Settings/SettingsView.swift` shows a static `theme = ...` example under General.

- Observation: Ghostty’s embedded runtime supports reload and config-change callbacks, and Supaterm already propagates runtime config changes through `NotificationCenter`.
  Evidence: `GhosttyRuntime.handleAction` reacts to `GHOSTTY_ACTION_RELOAD_CONFIG` and posts `.ghosttyRuntimeConfigDidChange` after `GHOSTTY_ACTION_CONFIG_CHANGE`.

- Observation: `GhosttyRuntime(configPath:)` is incomplete for this feature because the runtime does not retain the path it was loaded from, and it also silently changes loading policy on reload.
  Evidence: `GhosttyRuntime.convenience init(configPath:)` calls `loadConfig(at: configPath, includeCLIArgs: false)`, but `reloadConfig` later calls `Self.loadConfig()` with no path and the default `includeCLIArgs: true`.

- Observation: Supaterm does not bundle Ghostty’s helper CLI, so the Settings UI cannot rely on `ghostty +list-fonts` without adding new packaging work.
  Evidence: `apps/mac/Project.swift` embeds Ghostty resources and the `sp` CLI only, and the bundled CLI path helper points at `Resources/bin/sp`.

- Observation: Ghostty’s embedded C header exposes config diagnostics and scalar getters, but it does not expose a C shape for `RepeatableString`, which is how `font-family` is represented.
  Evidence: `apps/mac/ThirdParty/ghostty/include/ghostty.h` exposes `ghostty_config_path_s`, `ghostty_config_color_s`, `ghostty_config_color_list_s`, `ghostty_config_command_list_s`, and `ghostty_config_palette_s`, but no repeatable string list type for `font-family`.

- Observation: Supaterm’s seeded default Ghostty config contains `font-size = 15` but no `font-family`, so the UI cannot require a non-empty concrete font family at load time.
  Evidence: `apps/mac/supaterm/App/GhosttyBootstrap.swift` seeds `font-size = 15` and omits `font-family`.

- Observation: Ghostty config files support clearing a repeatable font list with an empty string, but the default seeded Supaterm file simply omits `font-family`.
  Evidence: `apps/mac/ThirdParty/ghostty/src/config/Config.zig` documents `font-family = ""` as the reset form, and `apps/mac/ThirdParty/ghostty/src/config/config-template` documents that empty values reset keys to default.

- Observation: Ghostty loads recursive config files after the primary file, so editing only the preferred config file does not guarantee that no later include overrides it.
  Evidence: `GhosttyRuntime.loadConfig` calls `ghostty_config_load_recursive_files(config)`, and Ghostty config supports `config-file` directives in the primary config.

- Observation: the existing test helper for explicit runtime config paths cannot support reload testing as written because it deletes the temp file before the caller can trigger a reload.
  Evidence: `apps/mac/supatermTests/GhosttyTestSupport.swift` writes the config file and uses `defer { try? FileManager.default.removeItem(at: url) }` inside `makeGhosttyRuntime(_:)`.

- Observation: the preview does not need custom config-notification plumbing to stay visually in sync.
  Evidence: `GhosttySurfaceView` calls `syncRuntimeConfigState()` during initialization, and `GhosttySurfaceScrollView` already refreshes itself on `.ghosttyRuntimeConfigDidChange`.

## Decision Log

- Decision: keep Ghostty font loading, config-file mutation, and reload fanout out of `SettingsFeature` and behind a terminal-settings boundary plus runtime-owned reload notifications.
  Rationale: this keeps the reducer a state machine rather than a file editor and hides the fragile sequencing of “load file, canonicalize keys, validate, write atomically, then reload runtimes”.
  Date/Author: 2026-04-06 / Codex

- Decision: build the preview on Supaterm’s `GhosttyRuntime`, `GhosttySurfaceView`, and `GhosttyTerminalView`, not on vendored Ghostty’s `Ghostty.App`.
  Rationale: Supaterm already owns config-change notifications, runtime wrappers, keyboard shortcut refresh, and surface rendering on this path. Reusing it avoids two terminal stacks inside one app.
  Date/Author: 2026-04-06 / Codex

- Decision: route Ghostty’s `open_config` action to the new `Terminal` tab instead of the current `General` tab.
  Rationale: after this feature lands, font and terminal-config editing knowledge should live in one place, not remain split between General copy and a new Terminal panel.
  Date/Author: 2026-04-06 / Codex

- Decision: use immediate apply for discrete controls such as a font picker and stepper, not an explicit Save button.
  Rationale: the user request is “select the font size and font, and it will update their Ghostty config and reload.” Discrete controls keep write frequency low enough to avoid extra draft state or save orchestration.
  Date/Author: 2026-04-06 / Codex

- Decision: source the picker list from macOS font discovery instead of shelling out to Ghostty.
  Rationale: the current embedded API does not expose Ghostty font discovery, and Supaterm does not package the Ghostty helper binary. A local macOS font catalog is the simplest forward-only source, while Ghostty’s config validation remains the authority on whether the selected family is accepted.
  Date/Author: 2026-04-06 / Codex

- Decision: model the selected font family as optional in the Settings domain, with `nil` meaning Ghostty’s default family.
  Rationale: the seeded config file omits `font-family`, and the embedded API cannot ask Ghostty for the effective default family list. The UI must represent “Default” explicitly instead of inventing a concrete family name.
  Date/Author: 2026-04-06 / Codex

- Decision: when the user chooses a concrete family, canonicalize the primary config file down to one quoted `font-family` entry; when the user chooses `Default`, remove all managed `font-family` entries from that file instead of guessing a built-in family.
  Rationale: this matches Supaterm’s seeded config shape, avoids serializing unnecessary reset directives, and keeps the managed file as simple as possible.
  Date/Author: 2026-04-06 / Codex

- Decision: preserve both `configPath` and `includeCLIArgs` as runtime load policy and use both values on every hard reload.
  Rationale: storing only the path would still change runtime behavior for explicit-path runtimes because those currently suppress CLI args at init time.
  Date/Author: 2026-04-06 / Codex

- Decision: version one manages the preferred Ghostty config file only and must surface a warning when that file contains `config-file` directives.
  Rationale: Ghostty loads recursive files after the primary file. The Settings UI should not pretend to own effective font settings across an arbitrary include graph without actually parsing and rewriting that graph.
  Date/Author: 2026-04-06 / Codex

## Outcomes & Retrospective

This revised plan still aims to make terminal typography a first-class Settings concern, but it now names the real boundary more accurately: file-backed Ghostty terminal settings are their own small subsystem, and runtime reload is its own responsibility. The complexity dividend is that future terminal settings such as theme, cursor shape, scrollbar behavior, or padding can reuse the same file edit and runtime reload path instead of re-solving path resolution, config validation, and reload fanout per control.

## Context and Orientation

The Settings window lives in `apps/mac/supaterm/App/SettingsWindowController.swift`. It creates a TCA store for `SettingsFeature` from `apps/mac/supaterm/Features/Settings/SettingsFeature.swift` and renders `apps/mac/supaterm/Features/Settings/SettingsView.swift`. Today the sidebar tabs are `General`, `Notifications`, `Coding Agents`, `Updates`, `Advanced`, and `About`. There is no `Terminal` tab yet.

The only existing terminal-related Settings copy is in `SettingsGeneralView`, which tells the user to configure Ghostty directly. The Settings reducer does not know how to read or write Ghostty config. It only persists `AppPrefs` and agent-hook toggles through dependency clients such as `ClaudeSettingsClient`, `CodexSettingsClient`, `DesktopNotificationClient`, and `UpdateClient`. New terminal settings should follow this same dependency pattern by defining a new `GhosttyTerminalSettingsClient` with `liveValue`, `testValue`, and a `DependencyValues` entry rather than teaching the window controller or reducer to touch the filesystem directly.

Supaterm seeds a default Ghostty config file in `apps/mac/supaterm/App/GhosttyBootstrap.swift`. The preferred file path is `GhosttyBootstrap.configFileLocations().preferred`, which resolves to `XDG_CONFIG_HOME/ghostty/config` when `XDG_CONFIG_HOME` is set, otherwise `~/.config/ghostty/config`. The seeded default config already contains `font-size = 15`, theme settings, and cursor settings, but it does not contain `font-family`.

The embedded terminal stack used by Supaterm is in `apps/mac/supaterm/Features/Terminal/Ghostty/`. `GhosttyRuntime.swift` owns a `ghostty_app_t`, loads a Ghostty config pointer, dispatches Ghostty actions, and posts `.ghosttyRuntimeConfigDidChange` when Ghostty reports a config change. `GhosttySurfaceView.swift` creates an actual terminal surface. `GhosttyTerminalView.swift` is the SwiftUI bridge that displays a `GhosttySurfaceView` through `GhosttySurfaceScrollView`. These files are already compiled automatically because `apps/mac/Project.swift` uses buildable folders for `supaterm/Features`, so adding new feature files does not require manual project-file edits.

Ghostty’s vendored source inside `apps/mac/ThirdParty/ghostty/` matters here for two reasons. First, the config system represents `font-family` as a repeatable value, not a scalar, and the embedded C API does not expose a repeatable string getter. That means the Settings feature must parse the primary config file text to know whether the user has explicitly set a family. Second, Ghostty can report configuration diagnostics through `ghostty_config_diagnostics_count` and `ghostty_config_get_diagnostic`, so the Settings path can validate the candidate file before broadcasting reload.

One subtle bug matters to this feature: `GhosttyRuntime(configPath:)` currently loads from an explicit path with `includeCLIArgs: false`, but later hard reloads forget both the path and that policy. This is not only a preview bug; it also means any future explicit-path runtime would drift on reload.

Another limitation matters up front: Ghostty loads recursive config files after the primary file. Version one of this Settings feature should own the preferred config file only. If that file contains `config-file` directives, the UI should show a warning that later include files may still override the effective font settings.

## Plan of Work

### Milestone 1: Build a real file-backed Ghostty terminal-settings boundary

Create `apps/mac/supaterm/Features/Settings/GhosttyTerminalSettingsClient.swift` as the TCA dependency surface and add a concrete file-backed helper in `apps/mac/supaterm/Features/Settings/GhosttyTerminalConfigFile.swift`. Keep the client small and declarative. It should expose `load()` and `apply(fontFamily:fontSize:)`, where `fontFamily` is optional and `nil` means Ghostty’s default family. Define `liveValue`, `testValue`, and `DependencyValues.ghosttyTerminalSettingsClient` exactly like the existing settings clients so reducer and window tests can continue to initialize without ad hoc dependency overrides.

The concrete helper should own primary config path resolution through `GhosttyBootstrap.configFileLocations()`, call `GhosttyBootstrap.seedDefaultConfigIfNeeded()` if the preferred file is missing, parse the primary config text, and preserve every unrelated line exactly. This helper must treat `font-family` and `font-size` as the only managed keys. For `font-size`, load the effective value by validating and finalizing the config through Ghostty’s config API so the fallback to 15 or future default changes remain grounded in Ghostty rather than duplicated constants. For `font-family`, parse the primary config file text because the embedded C API does not expose repeatable string values. Use the first non-empty managed family in the primary file as the selected concrete family. If none exists, return `nil` and let the UI display `Default`.

When applying a concrete family, write a single canonical `font-family = "Family Name"` line, quoting and escaping the value because many family names contain spaces. When applying `nil`, remove all managed `font-family` lines from the primary file so the file falls back to Ghostty’s default behavior. Always write exactly one canonical `font-size = ...` line. Keep targeted key canonicalization local to this helper so Settings never has to know how Ghostty’s repeatable syntax works.

Before broadcasting reload, validate the candidate file with `ghostty_config_new`, `ghostty_config_load_file`, `ghostty_config_load_recursive_files`, `ghostty_config_finalize`, and Ghostty diagnostics. If diagnostics are present, return an error message to Settings and skip runtime reload. This hides Ghostty config validation policy behind one boundary and gives the UI a concrete error instead of silently writing a broken config.

This milestone deepens a single module instead of sprinkling path resolution, text parsing, validation, and atomic writes across the reducer and view. After it exists, future Settings controls can reuse the same boundary and need only name which Ghostty keys they manage.

### Milestone 2: Fix `GhosttyRuntime` reload semantics and hide reload fanout there

Update `apps/mac/supaterm/Features/Terminal/Ghostty/GhosttyRuntime.swift` so the runtime stores the complete loading policy it was initialized with. That means preserving both the optional explicit config path and whether CLI args were included. Hard reload must use the same policy it started with. Do not fix only the path and leave `includeCLIArgs` implicit.

Add a high-level reload entry point such as `reloadAppConfig()` and a notification name such as `.ghosttyRuntimeReloadRequested` next to the existing `.ghosttyRuntimeConfigDidChange`. Register each runtime to observe reload requests and perform an app-level hard reload on receipt. After the settings client writes a valid file, it should only post one reload request. Each runtime should then reload itself and continue emitting `.ghosttyRuntimeConfigDidChange` as it already does. Callers should never construct Ghostty action targets or know whether reload is soft or hard.

Keep `GhosttyRuntime` responsible for live configuration state, and keep the settings client responsible for file edits and validation. That split is simpler than a settings-owned fanout registry because it keeps the sequencing of “how do live terminals ingest a config change?” inside the runtime layer that already owns Ghostty’s action callback path.

Extend `apps/mac/supatermTests/GhosttyRuntimeTests.swift` and `apps/mac/supatermTests/GhosttyTestSupport.swift` at the same time. Add a new helper that returns a runtime plus a live temp config URL and cleanup closure, because the existing `makeGhosttyRuntime(_:)` helper deletes the file too early for reload testing. Add at least one runtime test that proves a runtime created from an explicit config path reloads from that same path and does not re-enable CLI args accidentally.

### Milestone 3: Add a `Terminal` tab to Settings without leaking file or runtime policy into the reducer

Extend `SettingsFeature.Tab` in `apps/mac/supaterm/Features/Settings/SettingsFeature.swift` with a new `.terminal` case, placed immediately after `.general`. Update the sidebar symbol and the tab order assertions in `apps/mac/supatermTests/SettingsFeatureTests.swift`. Also extend `apps/mac/supatermTests/SettingsWindowControllerTests.swift` so `show(tab:)` covers `.terminal`.

Add a nested `SettingsTerminalState` inside `SettingsFeature.State`, for example `var terminal = SettingsTerminalState()`, rather than flattening more terminal-specific fields into the root state. That state should include `configPath`, `fontFamily: String?`, `fontSize`, `availableFontFamilies`, `isLoading`, `isApplying`, `errorMessage`, and `warningMessage`. The warning is specifically for primary-config-only management when `config-file` directives are present. The reducer should request terminal settings on `.task`, disable controls while loading or applying, and never persist these values into `AppPrefs`.

Keep the action flow reducer-friendly. The reducer should receive loaded terminal settings from the dependency client and update local state. On font-family or font-size change, it should call the client immediately and replace state with the returned snapshot. It should not know how the client canonicalizes keys, validates config, or broadcasts reload requests.

Add `GhosttyTerminalSettingsClient.testValue` with a benign snapshot such as the seeded config path, `fontFamily = nil`, `fontSize = 15`, no warning, and an empty font list or short fixed list. This keeps `SettingsWindowController` and simple reducer tests from needing new dependency overrides unless they are specifically exercising terminal behavior.

### Milestone 4: Build the Terminal tab UI and preview on existing surface infrastructure

Update `apps/mac/supaterm/Features/Settings/SettingsView.swift` with a `SettingsTerminalView` detail pane and route `SettingsTabContentView` to it. Remove the existing “configure Ghostty directly” copy from General and move terminal-config explanation into the Terminal tab. The Terminal tab should show the resolved config path, the inline warning when `config-file` directives are present, the inline error if validation or apply fails, the preview surface, a font-family picker whose first option is `Default`, and a font-size control.

Do not create a second terminal renderer. Reuse `GhosttyTerminalView` and a single `GhosttySurfaceView` inside a `@StateObject` controller such as `apps/mac/supaterm/Features/Settings/GhosttyTerminalPreviewController.swift`. That controller should own one dedicated preview runtime created with `GhosttyRuntime(configPath:)` and one preview surface created with `fontSize: nil` so the preview follows the runtime config file rather than pinning an override at surface creation. The controller does not need its own extra config observer if it renders through the existing surface wrapper, because the existing Ghostty surface stack already reacts to runtime config changes.

Keep the preview intentionally passive. Use SwiftUI’s existing pattern of `.allowsHitTesting(false)` on the preview container so clicks do not turn the Settings window into an interactive shell. Avoid overlay-specific controller logic unless `allowsHitTesting(false)` proves insufficient during manual verification. The preview only needs to render typography accurately; it does not need a command palette, shell interaction, or separate key handling.

This milestone removes a second potential source of complexity: the preview should be a thin owner of an existing surface, not a new surface implementation and not a new notification system.

### Milestone 5: Route Ghostty config actions here and lock in the new behavior with tests

Update `apps/mac/supaterm/App/GhosttyOpenConfigPerforming.swift` so `performOpenConfig()` opens `.terminal` instead of `.general`. Then update the settings-related menu tests in `apps/mac/supatermTests/SupatermMenuControllerTests.swift` so the rebound `open_config` shortcut opens the Terminal tab, while the normal Settings menu item still opens `.general`.

Add `apps/mac/supatermTests/GhosttyTerminalConfigFileTests.swift` using the same temporary-directory and exact-content style already used in `CodexSettingsInstallerTests.swift` and `GhosttyBootstrapTests.swift`. Cover at least these cases:

- missing preferred config file is seeded before load or apply;
- absent `font-family` loads as `nil`;
- applying a concrete family writes one canonical quoted `font-family` entry;
- applying `nil` removes managed `font-family` entries;
- duplicate `font-family` and `font-size` entries collapse to one canonical representation;
- unrelated lines and comments are preserved;
- `config-file` directives surface a warning;
- invalid candidate config returns a human-readable error and does not broadcast reload.

Extend `apps/mac/supatermTests/SettingsFeatureTests.swift` so every `.task`-driven test that currently expects `settingsLoaded` plus agent-hook refreshes also stubs the new terminal settings client and accounts for the new load action. Add tests for loading terminal settings, applying a concrete family, applying `Default`, and surfacing client errors without mutating unrelated state.

If preview-controller tests are added, use `initializeGhosttyForTests()` and the new persistent temp-config helper from `GhosttyTestSupport.swift`. Keep them behavior-focused: the preview controller should own one runtime and one surface, and reload should continue to use the same temp config path.

## Concrete Steps

Work from `/Users/Developer/code/github.com/supabitapp/supaterm`.

1. Add `apps/mac/supaterm/Features/Settings/GhosttyTerminalSettingsClient.swift`.
2. Add `apps/mac/supaterm/Features/Settings/GhosttyTerminalConfigFile.swift`.
3. Update `apps/mac/supaterm/Features/Terminal/Ghostty/GhosttyRuntime.swift` to preserve load policy, expose an app-level reload entry point, and observe a reload-request notification.
4. Update `apps/mac/supaterm/Features/Settings/SettingsFeature.swift` with nested terminal state and terminal load/apply actions.
5. Update `apps/mac/supaterm/Features/Settings/SettingsView.swift` with the new sidebar tab and the Terminal detail view.
6. Add `apps/mac/supaterm/Features/Settings/GhosttyTerminalPreviewController.swift`.
7. Update `apps/mac/supaterm/App/GhosttyOpenConfigPerforming.swift` so Ghostty config actions open the Terminal tab.
8. Add or update the test files listed above. No `Project.swift` edits are required because `supaterm` and `supatermTests` use buildable folders.
9. Run `make mac-check`.
10. Run focused macOS tests:

    xcodebuild test -workspace apps/mac/supaterm.xcworkspace -scheme supaterm -destination "platform=macOS" \
      -only-testing:supatermTests/GhosttyRuntimeTests \
      -only-testing:supatermTests/GhosttyTerminalConfigFileTests \
      -only-testing:supatermTests/SettingsFeatureTests \
      -only-testing:supatermTests/SettingsWindowControllerTests \
      -only-testing:supatermTests/SupatermMenuControllerTests \
      CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" -skipMacroValidation

11. Run the app for manual verification:

    make mac-run

## Validation and Acceptance

Acceptance is user-visible behavior, not just code structure.

Open the app, make sure there is at least one normal terminal window visible, then choose `Settings...`. Verify the sidebar now contains `Terminal`. Select it and confirm:

- a small embedded terminal preview is visible inside the Settings window;
- the resolved primary Ghostty config path is shown;
- if the primary config file has no explicit `font-family`, the picker shows `Default` rather than inventing a concrete family;
- if the primary config file contains `config-file` directives, the Terminal tab shows a warning that Settings manages the primary file only.

Choose a concrete font family and a new font size. Expect all of the following:

- the preview updates after the config reload completes;
- the already-open live terminal window updates without restarting the app;
- the primary Ghostty config file now contains one canonical `font-size = ...` line and one canonical quoted `font-family = "..."` line;
- unrelated Ghostty settings and comments in that file remain unchanged.

Choose `Default` in the font-family picker. Expect:

- the preview and the live terminal window fall back to Ghostty’s default family;
- the managed `font-family` entries are removed from the primary config file instead of being replaced with a guessed family name.

Force an invalid config-write path in tests or by injecting a failing client. Expect the Terminal tab to show an inline error and no runtime reload request to be broadcast.

Trigger Ghostty’s `open_config` binding path, which currently routes through Supaterm’s menu machinery, and verify it opens the Settings window on the Terminal tab instead of General.

The regression suite is acceptable when `make mac-check` succeeds and the focused `xcodebuild test` command above passes. The new config-file tests and runtime reload tests must fail before the implementation and pass after it.

## Idempotence and Recovery

The config-file edits must be repeatable. Reapplying the same concrete family and font size should leave the primary config file stable and should not introduce duplicate managed keys. Reopening Settings should load the same snapshot from disk without drift.

Config writes must be atomic so a failed write does not corrupt the user’s Ghostty config. If validation fails before the write completes, leave the original file untouched and surface the diagnostic text in the Terminal tab. If reload fails after a successful write, the file should remain valid and the error should still be visible in Settings so the user is not left guessing.

The preview runtime must be disposable. Closing the Settings window should release the preview surface and runtime cleanly without affecting terminal session restore, the terminal window registry, or menu routing.

The new runtime reload tests must use a helper that keeps the temporary config file on disk until the test finishes. Do not repurpose `makeGhosttyRuntime(_:)` without changing its cleanup semantics, or the reload-path assertions will silently test a deleted file.

## Artifacts and Notes

The most important code-grounded facts behind this plan are:

    apps/mac/supaterm/Features/Settings/SettingsView.swift
    Today General contains only static Ghostty guidance; there is no terminal state or terminal tab.

    apps/mac/supaterm/App/GhosttyBootstrap.swift
    Supaterm already knows the preferred Ghostty config path and already seeds a default config file whose explicit font setting is `font-size = 15`.

    apps/mac/supaterm/Features/Terminal/Ghostty/GhosttyRuntime.swift
    Supaterm already owns runtime config reload and config-change notifications, but it does not retain explicit-path load policy across hard reloads.

    apps/mac/supaterm/Features/Terminal/Ghostty/GhosttySurfaceView.swift
    Supaterm already owns the real terminal view class, initializes surfaces without forcing a font override when `fontSize` is nil, and syncs runtime config state during setup.

    apps/mac/supaterm/Features/Terminal/Ghostty/GhosttyTerminalView.swift
    A SwiftUI bridge for rendering `GhosttySurfaceView` already exists.

    apps/mac/ThirdParty/ghostty/include/ghostty.h
    The embedded Ghostty API exposes diagnostics and scalar config getters, but not a repeatable string getter for `font-family`.

    apps/mac/supatermTests/GhosttyTestSupport.swift
    The existing explicit-path runtime helper deletes its file too early for reload tests and must not be reused unchanged for this feature.

## Interfaces and Dependencies

Define the new settings boundary in `apps/mac/supaterm/Features/Settings/GhosttyTerminalSettingsClient.swift`:

    struct GhosttyTerminalSettingsSnapshot: Equatable, Sendable {
      var availableFontFamilies: [String]
      var configPath: String
      var fontFamily: String?
      var fontSize: Double
      var warningMessage: String?
    }

    struct GhosttyTerminalSettingsClient: Sendable {
      var load: @Sendable () async throws -> GhosttyTerminalSettingsSnapshot
      var apply: @Sendable (_ fontFamily: String?, _ fontSize: Double) async throws -> GhosttyTerminalSettingsSnapshot
    }

This client hides config-path resolution, text parsing, config validation, font discovery, and reload fanout from the reducer. Follow the repo’s existing dependency pattern by defining `liveValue`, `testValue`, and `DependencyValues.ghosttyTerminalSettingsClient`.

Define the concrete file-backed helper in `apps/mac/supaterm/Features/Settings/GhosttyTerminalConfigFile.swift` with a shape equivalent to:

    @MainActor
    struct GhosttyTerminalConfigFile {
      func load() throws -> GhosttyTerminalSettingsSnapshot
      func apply(fontFamily: String?, fontSize: Double) throws -> GhosttyTerminalSettingsSnapshot
    }

This helper hides the line-editing policy: parse `font-family` text because Ghostty’s C API cannot return it, preserve unrelated lines, validate with Ghostty diagnostics before write, seed the preferred file if missing, and post one runtime reload request after a successful write.

Extend `apps/mac/supaterm/Features/Terminal/Ghostty/GhosttyRuntime.swift` with:

    func reloadAppConfig()
    static let ghosttyRuntimeReloadRequested = Notification.Name(...)

and stored load-policy state equivalent to:

    private let configPath: String?
    private let includeCLIArgs: Bool

This interface hides Ghostty action structs and keeps runtime reload sequencing out of Settings.

Add nested Settings reducer state in `apps/mac/supaterm/Features/Settings/SettingsFeature.swift`:

    struct SettingsTerminalState: Equatable {
      var availableFontFamilies: [String] = []
      var configPath = ""
      var errorMessage: String?
      var fontFamily: String?
      var fontSize = 15.0
      var isApplying = false
      var isLoading = false
      var warningMessage: String?
    }

Keep preview ownership out of reducer state. Put it in `apps/mac/supaterm/Features/Settings/GhosttyTerminalPreviewController.swift`, where it can own:

    @MainActor
    final class GhosttyTerminalPreviewController: ObservableObject {
      let runtime: GhosttyRuntime
      let surfaceView: GhosttySurfaceView
    }

This controller hides the lifecycle of the preview runtime and surface from both the reducer and the rest of the Settings view tree. It should render through the existing `GhosttyTerminalView` and keep the preview non-interactive with `.allowsHitTesting(false)`.

## Plan Revision Note

Initial plan created on 2026-04-06 after inspecting Supaterm’s Settings feature, Ghostty config seeding, Supaterm’s `GhosttyRuntime` and `GhosttySurfaceView`, and vendored Ghostty macOS reload behavior. The original plan correctly chose a deep terminal-settings boundary but did not yet account for Ghostty’s missing `font-family` getter, the seeded config’s unset-family case, recursive `config-file` overrides, the `includeCLIArgs` reload bug, or the existing temp-config test helper deleting files too early.

Revised on 2026-04-06 to make the plan executable against the actual code. The revision changes the Settings snapshot to use `fontFamily: String?`, adds explicit validation through Ghostty diagnostics, requires runtime reload to preserve full load policy, warns when the primary config file delegates to recursive config files, points the preview at existing surface refresh behavior instead of inventing extra observers, and fixes the testing plan so explicit-path reload tests are actually possible.

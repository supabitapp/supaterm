# Add a Terminal Settings Tab With Live Ghostty Preview

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

After this change, a Supaterm user can open Settings, choose a new Ghostty font family and font size from a dedicated `Terminal` tab, and immediately see the result in a small embedded terminal preview. The selection writes back to the user’s Ghostty config file, reloads the active terminal runtimes, and keeps the preview in sync with the same config source. The user no longer needs to know the config path, remember Ghostty config syntax, or manually trigger a reload just to change typography.

The current complexity is paid by both users and maintainers. Users must edit `~/.config/ghostty/config` by hand, understand keys such as `font-family` and `font-size`, and trust that reload will happen elsewhere. Maintainers would be tempted to spread file edits, font discovery, preview ownership, and reload fanout across the Settings reducer, the view, and the Ghostty runtime. This plan keeps that sequencing behind a single terminal-settings module so the rest of Settings only deals with plain values and user intent.

## Progress

- [x] (2026-04-06 06:41Z) Read `.agent/PLANS.md`, inspected the current Settings feature, Settings window routing, Supaterm’s Ghostty runtime/view layer, and the vendored Ghostty macOS config/reload code.
- [ ] Add a dedicated terminal-settings module that loads, edits, and writes Ghostty font settings and triggers runtime reload.
- [ ] Extend `SettingsFeature` and `SettingsView` with a `Terminal` tab backed by the new client.
- [ ] Add a non-interactive preview surface that uses Supaterm’s existing `GhosttyRuntime` and `GhosttySurfaceView`.
- [ ] Add regression tests for config mutation, runtime reload fanout, tab routing, and Settings reducer behavior.

## Surprises & Discoveries

- Observation: Supaterm does not embed Ghostty’s full `Ghostty.App` object for the app UI; it uses its own `GhosttyRuntime` and `GhosttySurfaceView` layer in `apps/mac/supaterm/Features/Terminal/Ghostty/`.
  Evidence: `GhosttyBootstrap.initialize()` only calls `ghostty_init`, while `TerminalHostState.createSurface` creates `GhosttySurfaceView` from Supaterm’s `GhosttyRuntime`.

- Observation: Supaterm already has the pieces needed for a preview surface.
  Evidence: `apps/mac/supaterm/Features/Terminal/Ghostty/GhosttyTerminalView.swift` renders a `GhosttySurfaceView` through `GhosttySurfaceScrollView`, and `GhosttySurfaceView.init` already accepts an explicit `fontSize`.

- Observation: the current Settings UI has no terminal-specific state; the General tab only tells the user to edit Ghostty config by hand.
  Evidence: `apps/mac/supaterm/Features/Settings/SettingsFeature.swift` stores app prefs and agent-hook state only, while `apps/mac/supaterm/Features/Settings/SettingsView.swift` shows a static `theme = ...` example under General.

- Observation: Ghostty’s embedded runtime supports reload and config-change callbacks, and Supaterm already propagates runtime config changes through `NotificationCenter`.
  Evidence: `GhosttyRuntime.handleAction` reacts to `GHOSTTY_ACTION_RELOAD_CONFIG` and posts `.ghosttyRuntimeConfigDidChange` after `GHOSTTY_ACTION_CONFIG_CHANGE`.

- Observation: `GhosttyRuntime(configPath:)` is incomplete for this feature because the runtime does not retain the path it was loaded from; later hard reloads fall back to the default config search path.
  Evidence: `GhosttyRuntime.convenience init(configPath:)` calls `loadConfig(at:includeCLIArgs:)`, but `reloadConfig` later calls `Self.loadConfig()` with no stored path.

- Observation: Supaterm does not bundle Ghostty’s helper CLI, so the Settings UI cannot rely on `ghostty +list-fonts` without adding new packaging work.
  Evidence: `apps/mac/Project.swift` embeds Ghostty resources and the `sp` CLI only, and the bundled CLI path helper points at `Resources/bin/sp`.

## Decision Log

- Decision: keep Ghostty font loading, config-file mutation, and reload fanout in a dedicated Settings-side module instead of teaching `SettingsFeature` how to edit files and talk to runtimes.
  Rationale: this makes the reducer a plain state machine again and hides the fragile sequencing of “load file, normalize keys, write atomically, then reload every runtime” behind one interface.
  Date/Author: 2026-04-06 / Codex

- Decision: build the preview on Supaterm’s `GhosttyRuntime` and `GhosttySurfaceView`, not on vendored Ghostty’s `Ghostty.App`.
  Rationale: Supaterm already owns config-change notifications, runtime wrappers, keyboard shortcut refresh, and surface rendering on this path. Reusing it avoids two terminal stacks inside one app.
  Date/Author: 2026-04-06 / Codex

- Decision: route Ghostty’s `open_config` action to the new `Terminal` tab instead of the current `General` tab.
  Rationale: after this feature lands, font and terminal-config editing knowledge should live in one place, not remain split between General copy and a new Terminal panel.
  Date/Author: 2026-04-06 / Codex

- Decision: use immediate apply for discrete controls such as a font picker and stepper, not an explicit Save button.
  Rationale: the user request is “select the font size and font, and it will update their Ghostty config and reload.” Discrete controls keep write frequency low enough to avoid extra draft state or save orchestration.
  Date/Author: 2026-04-06 / Codex

- Decision: source the picker list from macOS font discovery instead of shelling out to Ghostty.
  Rationale: the current embedded API does not expose Ghostty font discovery, and Supaterm does not package the Ghostty helper binary. A local macOS font catalog is the simplest forward-only source, while Ghostty’s reload path remains the final authority on whether the chosen family is usable.
  Date/Author: 2026-04-06 / Codex

## Outcomes & Retrospective

This plan turns terminal typography into a first-class Settings concern without importing Ghostty’s entire settings app model. The intended complexity dividend is that future terminal settings such as theme, cursor shape, padding, or scrollbar behavior can reuse the same file-backed Ghostty settings client and the same runtime reload signal instead of re-solving file edits and runtime fanout per control.

## Context and Orientation

The Settings window lives in `apps/mac/supaterm/App/SettingsWindowController.swift`. It creates a TCA store for `SettingsFeature` from `apps/mac/supaterm/Features/Settings/SettingsFeature.swift` and renders `apps/mac/supaterm/Features/Settings/SettingsView.swift`. Today the sidebar tabs are `General`, `Notifications`, `Coding Agents`, `Updates`, `Advanced`, and `About`. There is no `Terminal` tab yet.

The only existing terminal-related Settings copy is in `SettingsGeneralView`, which tells the user to configure Ghostty directly. The Settings reducer does not know how to read or write Ghostty config. It only persists `AppPrefs` and agent-hook toggles through dependency clients.

Supaterm seeds a default Ghostty config file in `apps/mac/supaterm/App/GhosttyBootstrap.swift`. The preferred file path is `GhosttyBootstrap.configFileLocations().preferred`, which resolves to `XDG_CONFIG_HOME/ghostty/config` when `XDG_CONFIG_HOME` is set, otherwise `~/.config/ghostty/config`. The seeded default config already contains `font-size = 15`, so the app has a concrete file to edit unless the user has replaced it.

The embedded terminal stack used by Supaterm is in `apps/mac/supaterm/Features/Terminal/Ghostty/`. `GhosttyRuntime.swift` owns a `ghostty_app_t` plus a loaded config pointer and posts `.ghosttyRuntimeConfigDidChange` when Ghostty notifies the app that config has changed. `GhosttySurfaceView.swift` creates an actual terminal surface and already accepts an explicit `fontSize` for inherited or per-surface overrides. `GhosttyTerminalView.swift` is the SwiftUI bridge that displays a `GhosttySurfaceView` through `GhosttySurfaceScrollView`.

Ghostty’s vendored macOS source inside `apps/mac/ThirdParty/ghostty/macos/Sources/Ghostty/` confirms that Ghostty supports app-level and surface-level reload through `ghostty_app_update_config` and `ghostty_surface_update_config`, and that config-change callbacks are how the new config becomes authoritative. That matters because the new Settings UI should write the user-owned config file and then ask the Supaterm runtimes to reload from that same source, not try to maintain a second source of truth in memory.

One subtle bug matters to this feature: `GhosttyRuntime(configPath:)` loads a config from a supplied path during initialization, but `reloadConfig` does not remember that path and later reloads from the default search path. Any preview runtime or test runtime that depends on a custom config path will drift after the first hard reload unless this is fixed.

## Plan of Work

### Milestone 1: Make Ghostty terminal settings a single owned boundary

Introduce a new Settings-side module that owns terminal typography settings. Create `apps/mac/supaterm/Features/Settings/GhosttyTerminalSettingsClient.swift` as the TCA dependency surface and `apps/mac/supaterm/Features/Settings/GhosttyTerminalConfigStore.swift` as the concrete file-backed implementation. This store should expose plain value operations such as `load()` and `apply(fontFamily:fontSize:)`, plus a way to enumerate available font families. Keep file resolution inside this module by using `GhosttyBootstrap.configFileLocations()`; callers should never concatenate config paths themselves.

The store should mutate only the `font-family` and `font-size` keys inside the user’s Ghostty config file. Preserve every unrelated line exactly as-is, normalize duplicate targeted keys down to one canonical `font-family = ...` and one canonical `font-size = ...`, and write atomically so a failed write never leaves a half-written config behind. If the config file does not exist, call the existing seeding path first so the store always edits a concrete file instead of inventing a second config location.

Keep font discovery in the same owned boundary. Because Supaterm does not bundle the Ghostty helper CLI and the embedded C API does not expose `+list-fonts`, use macOS font discovery from AppKit/CoreText and filter to families that are reasonable terminal choices. The first version does not need Ghostty-perfect ranking; it needs a stable local list that avoids shelling out and keeps the Settings flow self-contained.

Deepen `apps/mac/supaterm/Features/Terminal/Ghostty/GhosttyRuntime.swift` so runtimes can be reloaded externally without callers knowing Ghostty action structs. Store the runtime’s config source path as a property, fix hard reload to use that stored path, and add a high-level app reload path such as `reloadAppConfig()` or an equivalent internal handler. Add a new notification, for example `.ghosttyRuntimeReloadRequested`, and register every runtime to respond by reloading its app-level config. This moves reload fanout out of Settings and into the runtime layer where it belongs. After file writes, the settings client only broadcasts one reload request; each runtime then reloads itself and continues posting `.ghosttyRuntimeConfigDidChange` exactly as it already does.

This milestone removes the biggest future complexity trap. Without it, every terminal-related control would need to rediscover the config path, hand-edit the file, and know how to touch live runtimes. With it, future Settings controls become “read a value, write a value” operations against one deep module.

### Milestone 2: Add a dedicated Terminal tab and move terminal-config routing there

Extend `SettingsFeature.Tab` in `apps/mac/supaterm/Features/Settings/SettingsFeature.swift` with a new `.terminal` case. Place it immediately after `.general` so the sidebar reads as application-level settings first, then terminal-specific behavior. Update the tab title, symbol, default routing tests, and the tab order assertions in `apps/mac/supatermTests/SettingsFeatureTests.swift`.

Add a plain `SettingsTerminalState` to `SettingsFeature.State` that contains the currently loaded config path, selected font family, selected font size, available font families, an apply-in-flight flag, and an optional error message. Add actions to load terminal settings on `.task`, react to font changes, and handle apply success or failure. Keep the reducer ignorant of file paths beyond displaying the resolved config location returned by the client. The reducer should ask the new client to load once when Settings opens and to apply immediately when the user changes either control.

Update `apps/mac/supaterm/Features/Settings/SettingsView.swift` to render a new `SettingsTerminalView` or similarly named subview. Move the current “Terminal Theme” explanatory copy out of General and into Terminal so all Ghostty-config knowledge lives in one place. The Terminal tab should show a short explanation, the resolved config path, the preview surface, a font family picker, and a font size control such as a stepper plus numeric label. Keep the rest of Settings unchanged.

Change `apps/mac/supaterm/App/GhosttyOpenConfigPerforming.swift` so `performOpenConfig()` routes to `.terminal` instead of `.general`. This ensures Ghostty keybindings or menu actions that conceptually mean “open terminal configuration” land on the actual terminal configuration screen. Update the existing menu tests in `apps/mac/supatermTests/SupatermMenuControllerTests.swift` and any Settings window tests that assert tab routing.

### Milestone 3: Add a real preview surface that reflects the same config file

Create `apps/mac/supaterm/Features/Settings/GhosttyTerminalPreviewController.swift` or an equivalently named Settings-local controller that owns a dedicated preview runtime and one preview surface. This controller should be `@MainActor`, created by the Terminal settings view, and kept out of `SettingsFeature.State` so TCA state remains equatable and serializable. The controller should resolve the Ghostty config path through the terminal-settings client or `GhosttyBootstrap`, build `GhosttyRuntime(configPath:)`, and create a single `GhosttySurfaceView` rendered through the existing `GhosttyTerminalView`.

Make the preview intentionally narrow in scope. It should exist only to render the typography and spacing accurately, not to become a second full terminal window. Keep it non-interactive so the user cannot accidentally start using Settings as a shell. A simple overlay or focus suppression is enough. The preview should subscribe to runtime config change notifications for its own runtime so the displayed font refreshes after each apply. Because Milestone 1 fixes `GhosttyRuntime(configPath:)`, the preview runtime will continue to reload from the same config file the settings client is editing.

Reuse existing Ghostty view code rather than introducing a parallel preview renderer. That keeps the preview honest: if a font change works in the preview, it works through the same surface class the app uses for real terminals. The only new policy should be preview ownership and presentation, not a second terminal implementation.

### Milestone 4: Add regression coverage for the owned boundary and user-visible flow

Add `apps/mac/supatermTests/GhosttyTerminalConfigStoreTests.swift` to prove that loading and applying terminal settings preserves unrelated config lines, rewrites duplicate `font-family` and `font-size` entries into one canonical value each, creates missing keys when necessary, and uses the preferred Ghostty config path rules already covered by `GhosttyBootstrapTests`.

Extend `apps/mac/supatermTests/GhosttyRuntimeTests.swift` and `apps/mac/supatermTests/GhosttyTestSupport.swift` to cover config-path-aware reload. The important behavior is that a runtime created with a temporary config path reloads from that same path after a reload request, not from the default filesystem search path.

Extend `apps/mac/supatermTests/SettingsFeatureTests.swift` to verify the new tab order, initial load of terminal settings, immediate apply after a font family or size change, and error handling when the terminal-settings client throws. Extend `apps/mac/supatermTests/SupatermMenuControllerTests.swift` and `apps/mac/supatermTests/SettingsWindowControllerTests.swift` so Ghostty’s open-config action selects the Terminal tab and the Settings window can reopen directly on it.

If the preview controller owns enough logic to merit isolated tests, add a small focused test file that proves it constructs one preview surface and reacts to its runtime’s config-change notification. Do not add shallow tests that only assert view labels; keep the new tests centered on behavior that would regress the feature.

## Concrete Steps

Work from `/Users/Developer/code/github.com/supabitapp/supaterm`.

1. Add the terminal-settings client and config-store files under `apps/mac/supaterm/Features/Settings/`.
2. Update `apps/mac/supaterm/Features/Terminal/Ghostty/GhosttyRuntime.swift` so it stores `configPath`, reloads from that path, and observes a new reload-request notification.
3. Extend `apps/mac/supaterm/Features/Settings/SettingsFeature.swift` with `SettingsTerminalState`, load/apply actions, and dependency wiring for the new client.
4. Update `apps/mac/supaterm/Features/Settings/SettingsView.swift` with the new sidebar tab and the Terminal detail view.
5. Add the preview controller and preview view bridge in `apps/mac/supaterm/Features/Settings/`.
6. Update `apps/mac/supaterm/App/GhosttyOpenConfigPerforming.swift` so Ghostty config actions open the Terminal tab.
7. Add or update the test files listed in the milestone sections.
8. Run `make mac-check`.
9. Run focused macOS tests:

    xcodebuild test -workspace apps/mac/supaterm.xcworkspace -scheme supaterm -destination "platform=macOS" \
      -only-testing:supatermTests/GhosttyRuntimeTests \
      -only-testing:supatermTests/GhosttyTerminalConfigStoreTests \
      -only-testing:supatermTests/SettingsFeatureTests \
      -only-testing:supatermTests/SettingsWindowControllerTests \
      -only-testing:supatermTests/SupatermMenuControllerTests \
      CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" -skipMacroValidation

10. Run the app for manual verification:

    make mac-run

## Validation and Acceptance

Acceptance is user-visible behavior, not just code structure.

Open the app, choose `Settings...`, and verify the sidebar now contains `Terminal`. Select it and confirm:

- a small embedded terminal preview is visible inside the Settings window;
- the current font family and font size are populated from the user’s Ghostty config file;
- the resolved config path is shown so the user knows which file is being edited.

Change the font family to another monospaced family and change the font size. Expect all of the following:

- the preview updates after the config reload completes;
- existing live terminal windows update without restarting the app;
- the Ghostty config file now contains one canonical `font-family = ...` line and one canonical `font-size = ...` line with the selected values;
- unrelated Ghostty settings already present in the file remain unchanged.

Trigger Ghostty’s open-config binding path, which currently routes through Supaterm’s menu machinery, and verify it opens the Settings window on the Terminal tab instead of General.

The regression suite is acceptable when `make mac-check` succeeds and the focused `xcodebuild test` command above passes. The new config-store test must fail before the implementation and pass after it. The runtime reload-path test must demonstrate that a runtime created from a temporary config file continues to reload from that same temporary file.

## Idempotence and Recovery

The config-store edits must be repeatable. Reapplying the same font family and font size should leave the config file stable and should not introduce duplicate targeted keys. Reopening Settings should reload the same values from disk without drift.

Config writes must be atomic so a failed write does not corrupt the user’s Ghostty config. If apply fails before the write completes, leave the original file untouched and surface the error in the Terminal tab. If reload fails after a successful write, the file should remain valid and the error should be visible in Settings so the user is not left guessing.

The preview runtime must be disposable. Closing the Settings window should release the preview surface and runtime cleanly without affecting terminal session restore, tab state, or the terminal window registry.

## Artifacts and Notes

The most important code-grounded facts behind this plan are:

    apps/mac/supaterm/Features/Settings/SettingsView.swift
    Today General contains only static Ghostty guidance; there is no terminal state or terminal tab.

    apps/mac/supaterm/App/GhosttyBootstrap.swift
    Supaterm already knows the preferred Ghostty config path and already seeds a default config file.

    apps/mac/supaterm/Features/Terminal/Ghostty/GhosttyRuntime.swift
    Supaterm already owns runtime config reload and config-change notifications, but it does not retain `configPath` for later hard reloads.

    apps/mac/supaterm/Features/Terminal/Ghostty/GhosttySurfaceView.swift
    Supaterm already owns the real terminal view class and can create surfaces with an explicit `fontSize`.

    apps/mac/supaterm/Features/Terminal/Ghostty/GhosttyTerminalView.swift
    A SwiftUI bridge for rendering `GhosttySurfaceView` already exists.

## Interfaces and Dependencies

Define the new settings boundary in `apps/mac/supaterm/Features/Settings/GhosttyTerminalSettingsClient.swift`:

    struct GhosttyTerminalSettingsSnapshot: Equatable, Sendable {
      var configPath: String
      var fontFamily: String
      var fontSize: Double
      var availableFonts: [String]
    }

    struct GhosttyTerminalSettingsClient: Sendable {
      var load: @Sendable () async throws -> GhosttyTerminalSettingsSnapshot
      var apply: @Sendable (_ fontFamily: String, _ fontSize: Double) async throws -> GhosttyTerminalSettingsSnapshot
    }

This client hides config-path resolution, file mutation, font discovery, and reload fanout from the reducer.

Define the file-backed implementation in `apps/mac/supaterm/Features/Settings/GhosttyTerminalConfigStore.swift` with a shape equivalent to:

    @MainActor
    struct GhosttyTerminalConfigStore {
      func load() throws -> GhosttyTerminalSettingsSnapshot
      func apply(fontFamily: String, fontSize: Double) throws -> GhosttyTerminalSettingsSnapshot
    }

This store hides the line-editing policy: normalize the targeted keys, preserve unrelated lines, seed the file if missing, and post one runtime reload request after a successful write.

Extend `apps/mac/supaterm/Features/Terminal/Ghostty/GhosttyRuntime.swift` with:

    func reloadAppConfig()
    static let ghosttyRuntimeReloadRequested = Notification.Name(...)

and a stored `configPath: String?` used by every hard reload path. This interface hides Ghostty action structs and keeps runtime reload knowledge out of Settings.

Add plain Settings reducer state in `apps/mac/supaterm/Features/Settings/SettingsFeature.swift`:

    struct SettingsTerminalState: Equatable {
      var availableFonts: [String] = []
      var configPath = ""
      var errorMessage: String?
      var fontFamily = ""
      var fontSize = 15.0
      var isApplying = false
    }

Keep preview ownership out of reducer state. Put it in `apps/mac/supaterm/Features/Settings/GhosttyTerminalPreviewController.swift`, where it can own:

    @MainActor
    final class GhosttyTerminalPreviewController: ObservableObject {
      let runtime: GhosttyRuntime
      let surfaceView: GhosttySurfaceView
    }

This controller hides the lifecycle of the preview runtime and surface from both the reducer and the rest of the Settings view tree.

## Plan Revision Note

Initial plan created on 2026-04-06 after inspecting Supaterm’s Settings feature, Ghostty config seeding, Supaterm’s `GhosttyRuntime` and `GhosttySurfaceView`, and vendored Ghostty macOS reload behavior. The plan chooses a deep terminal-settings module because the main risk is spreading file-edit and reload sequencing across unrelated layers.

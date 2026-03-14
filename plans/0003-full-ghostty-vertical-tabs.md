# Full Ghostty Terminal Hosting In Vertical Tabs

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

There is no `PLANS.md` file in this repository as of 2026-03-14 21:40Z, so this document is the source of truth for the work described here. This plan replaces the current mock terminal-detail shell with real Ghostty-backed terminal sessions, but it explicitly does not adopt Ghostty's native horizontal tab or worktree systems.

## Purpose / Big Picture

After this change, every item in Supaterm's vertical sidebar will be a real Ghostty terminal session, not a placeholder detail card. Selecting a vertical tab will reveal the exact same live terminal state that was there before: one or more panes, their running processes, their scrollback, their search UI, and their focus state. Creating, closing, and switching tabs from keyboard shortcuts must continue to use Supaterm's vertical tab model, not Ghostty's native horizontal tab strip.

Inside each tab, a user will get pane behavior that feels like Ghostty because the panes are Ghostty surfaces. A user will be able to split the focused pane, move focus across panes, resize panes, equalize splits, zoom a pane, drag panes within the tab, search in the focused pane, copy and paste, open links, and see progress, bell, read-only, and secure-input state reflected in the UI. Closing a tab with a live process will show a confirmation prompt. Returning to a tab will restore focus to the pane that was focused last.

The visible result in the app should be straightforward. Launch Supaterm, see one real terminal tab in the vertical sidebar, create another with `Command-T`, split it, run a long task in one pane, switch away, return, and find the pane tree and focused pane preserved. Use `Command-W` to close the selected vertical tab, `Command-1` through `Command-0` to jump by visible tab order, `Command-F` to open a Ghostty-style search overlay on the focused pane, and Ghostty split shortcuts to manage panes inside the selected tab.

## Scope

Included in this plan:

- Full Ghostty terminal hosting for every vertical tab.
- Persistent tab-local pane trees with split, focus, resize, equalize, zoom, and in-tab drag-reorder.
- Host-owned vertical tab semantics, including remapping Ghostty `new_tab`, `close_tab`, and `goto_tab` actions to Supaterm's sidebar.
- Keyboard shortcuts for vertical tabs and panes, including close, new tab, next/previous tab, tab slots, pane actions, and search actions.
- Search overlay, clipboard parity, link opening, bell/progress/read-only/secure-input indicators, tab title derivation from the focused pane, live-process close confirmation, and per-tab focus restoration.

Explicitly excluded from this plan:

- Ghostty native horizontal tabs, tab overview, tab movement commands, or macOS tab-group window behavior.
- Worktree integration, setup/run-script flows, or any Supacode worktree-specific terminal logic.
- Command palette support.
- Pane tear-out into a new window.
- Quick terminal, global hotkeys, inspector, or session/workspace restoration across app launches.

## Progress

- [x] (2026-03-14 21:40Z) Audited the current Supaterm shell in `supaterm/App`, `supaterm/Features/Terminal`, and `supatermTests`.
- [x] (2026-03-14 21:40Z) Audited Supacode's Ghostty hosting model and identified the relevant integration files for action remapping, split trees, and per-surface metadata flow.
- [x] (2026-03-14 21:40Z) Audited the bundled Ghostty macOS source under `ThirdParty/ghostty` and isolated the parts to emulate versus the parts to exclude.
- [x] (2026-03-14 21:40Z) Resolved the three product choices that materially affect implementation: confirm on live process when closing a tab, keep pane drag/reorder in-tab only, and use a Ghostty-style search overlay instead of a custom palette-like surface.
- [ ] Replace the current mock tab/session model with reducer-owned Ghostty session state.
- [ ] Add a main-actor Ghostty runtime layer that owns live surfaces outside TCA and reconciles them from reducer state.
- [ ] Replace selected-tab-only detail rendering with a persistent mounted tab stack so Ghostty sessions survive tab switches.
- [ ] Implement pane trees, Ghostty action remapping, search, metadata indicators, and tab close confirmation.
- [ ] Add reducer tests, runtime smoke coverage where practical, and run `make check`, `make test`, and `make build-app`.

## Surprises & Discoveries

- Observation: the current app already owns the correct shell-level shortcut surface for vertical tabs, but not the terminal implementation behind it.
  Evidence: `supaterm/App/TerminalCommands.swift` already handles `Command-T`, `Command-W`, next/previous tab, and `Command-1` through `Command-0` by sending actions into `AppFeature`.

- Observation: the current terminal detail only mounts the selected child store. That is acceptable for placeholder content, but it would destroy Ghostty session continuity if reused as-is.
  Evidence: `supaterm/Features/Terminal/TerminalView.swift` scopes only `store.selectedTabID` into `TerminalDetailView`, so non-selected tab content is not mounted.

- Observation: Supaterm's current `TerminalTabFeature` is a demo child reducer, not a terminal session domain.
  Evidence: `supaterm/Features/Terminal/TerminalTabFeature.swift` contains only a counter and increment/decrement actions.

- Observation: Supacode already demonstrates the right host/embedded split of responsibilities for this project: the app owns tabs and splits while Ghostty surfaces provide terminal behavior.
  Evidence: `supacode/supacode/Features/Terminal/Models/WorktreeTerminalState.swift` owns tab and split state, while `supacode/supacode/Infrastructure/Ghostty/GhosttySurfaceBridge.swift` intercepts Ghostty actions and surface metadata.

- Observation: the native Ghostty macOS tab/window controller is the wrong architecture for Supaterm's goals.
  Evidence: `ThirdParty/ghostty/macos/Sources/Features/Terminal/TerminalController.swift` is built around Ghostty-owned macOS window/tab behavior, including native tab groups and tab movement, which this plan explicitly excludes.

- Observation: the current Tuist setup already allows new terminal hosting files under `supaterm/App` and `supaterm/Features` without project regeneration.
  Evidence: `Project.swift` uses `buildableFolders` for those directories and already links `Frameworks/GhosttyKit.xcframework`.

## Decision Log

- Decision: Supaterm will own tab and pane structure; Ghostty will own terminal surfaces and terminal semantics.
  Rationale: this keeps one authoritative shell model in the app while still giving each pane real Ghostty behavior. It matches Supacode and avoids coupling Supaterm to Ghostty's native macOS controller layer.
  Date: 2026-03-14 21:40Z

- Decision: live Ghostty objects will not be stored in TCA state.
  Rationale: Ghostty runtime objects are imperative, non-Equatable, and view-lifecycle-driven. Reducer state should hold only stable session and pane identity plus the metadata the host UI actually needs.
  Date: 2026-03-14 21:40Z

- Decision: the current `TerminalTabFeature` should be replaced, not stretched.
  Rationale: a tab is becoming a full terminal session. Keeping the current counter-based child reducer would preserve an invalid mental model and create needless transitional code.
  Date: 2026-03-14 21:40Z

- Decision: vertical tab actions remain app-owned and must intercept Ghostty `new_tab`, `close_tab`, and `goto_tab`.
  Rationale: the user wants Supaterm's vertical sidebar to be the only tab system. Native Ghostty horizontal tabs are explicitly out of scope.
  Date: 2026-03-14 21:40Z

- Decision: pane drag and drop is in-tab only for this implementation.
  Rationale: Ghostty supports tear-out and cross-window pane movement, but that is not needed for the requested product scope and would force extra window-management work.
  Date: 2026-03-14 21:40Z

- Decision: closing a tab with any live pane process will present a confirmation prompt.
  Rationale: this is the safest close policy and was explicitly chosen during planning. The confirmation should be derived from live pane process state, not a separate user-maintained flag.
  Date: 2026-03-14 21:40Z

- Decision: search uses a Ghostty-style overlay attached to the focused pane, not a command-palette-style interaction.
  Rationale: this matches the selected product direction and avoids reintroducing the command palette through another route.
  Date: 2026-03-14 21:40Z

- Decision: there is no backward-compatibility path for the current sample tabs or placeholder detail cards.
  Rationale: the user explicitly does not want backwards compatibility. The simplest correct implementation is to replace the mock shell outright.
  Date: 2026-03-14 21:40Z

## Outcomes & Retrospective

This section will be updated after implementation. The intended outcome is that Supaterm stops being a tab mock and becomes a real terminal host: one vertical sidebar, real Ghostty sessions per tab, host-owned tab behavior, full pane support inside each tab, and no native Ghostty horizontal tab UI.

## Context and Orientation

Supaterm is a macOS-only SwiftUI application built with The Composable Architecture. The root feature is `supaterm/Features/App/AppFeature.swift`, the app scene is `supaterm/App/SupatermApp.swift`, the command menu lives in `supaterm/App/TerminalCommands.swift`, and the current shell UI lives in `supaterm/Features/Terminal/TerminalView.swift`. `Project.swift` already links `Frameworks/GhosttyKit.xcframework`, but the current app does not yet host real Ghostty content.

The current terminal domain still reflects the earlier prototype phase. `TerminalTabsFeature` stores demo tabs with starter labels such as `Command Deck` and `Sessions`, and `TerminalTabFeature` is a counter. The UI is visually advanced but functionally shallow: only the selected tab detail is mounted, the detail content is not a terminal, and there is no pane tree or Ghostty runtime. That is the structural gap this plan closes.

Supacode is the primary reference for the embedding model, not for product-specific worktree behavior. In Supacode, the host app owns terminal tabs and split trees and intercepts Ghostty actions through a thin bridge. The relevant files are `supacode/supacode/Features/Terminal/Models/WorktreeTerminalState.swift`, `supacode/supacode/Infrastructure/Ghostty/GhosttySurfaceBridge.swift`, and `supacode/supacode/Features/Terminal/Views/TerminalSplitTreeView.swift`. Those files show the right responsibility boundary for Supaterm: the host owns structural state, Ghostty surfaces provide the terminal itself.

The bundled Ghostty macOS source is a behavior reference only. `ThirdParty/ghostty/macos/Sources/Features/Terminal/TerminalController.swift` and related files show how native Ghostty handles splits, focus, search, and surface metadata, but that controller code assumes Ghostty owns the macOS tab/window layer. Supaterm should not adopt that layer. For this implementation, Ghostty's native horizontal tabs, tab movement, macOS tab groups, and related window semantics are non-goals.

For this plan, a "tab" means a vertical-sidebar session entry in Supaterm. A "session" means the reducer-owned state for one tab, including its pane tree and focused pane identity. A "pane" means a leaf Ghostty surface inside a session. A "runtime" means the main-actor object that owns live Ghostty app/surface instances and reconciles them from reducer state without becoming a second source of truth for shell structure.

## Plan of Work

### Phase 0: Prove The GhosttyKit Embedding Surface

Before large refactors, add the thinnest possible compile-time integration layer under `supaterm/Features/Terminal/Ghostty/` to verify the actual `GhosttyKit.xcframework` APIs that Supaterm can call. The bundled source under `ThirdParty/ghostty` is the design reference, but the compiled xcframework is the build truth. Create a small wrapper that can instantiate the Ghostty runtime and one surface view in isolation, with callback hooks for title, pwd, progress, and action interception.

This phase is intentionally small and should not yet alter the visible tab system. Its purpose is to remove the largest implementation risk up front: source/API drift between the vendored Ghostty source tree and the linked xcframework. If the xcframework surface differs, update the plan's interface names before starting the reducer refactor.

### Phase 1: Replace The Mock Tab Model With Real Terminal Sessions

Replace the current `TerminalTabFeature` with a real session domain. The clearest forward-only move is to rename it to `TerminalSessionFeature` and make `TerminalTabsFeature` own `IdentifiedArrayOf<TerminalSessionFeature.State>`. Remove the current counter state and the hard-coded starter tabs like `Command Deck`; Supaterm should instead boot with one real terminal session selected.

`TerminalTabsFeature.State` should own the ordered tab collection, the selected tab identifier, and close-confirmation presentation state. Each `TerminalSessionFeature.State` should own the pane tree structure, the currently focused pane identifier, the last-focused pane identifier used for restoration, per-pane search UI state, and any tab-local transient UI state such as zoomed-pane selection or in-tab pane drag state. Do not store tab title, dirty/running state, or badges redundantly if they can be computed from the focused pane and pane metadata already in state.

Use one authoritative stored model for tabs and panes. The sidebar tab title should be derived from the focused pane title, with pwd fallback if the terminal title is empty. A tab's running/progress indicator should be derived from its panes' live process and progress metadata. This matches the project rule to compute what can be computed and avoids duplicating Ghostty state into multiple host caches.

### Phase 2: Add A Main-Actor Ghostty Runtime Layer

Introduce a new host runtime layer under `supaterm/Features/Terminal/Ghostty/`, for example:

    GhosttyHostRuntime.swift
    GhosttySurfaceBridge.swift
    GhosttySurfaceHostView.swift
    GhosttySearchController.swift

`GhosttyHostRuntime` should be a `@MainActor final class` owned by the terminal view layer, not by reducer state. It will hold the live Ghostty app/runtime objects, session records, and per-pane surface handles keyed by stable tab and pane identifiers from TCA state. The reducer remains the source of truth for which tabs and panes should exist; the runtime reconciles live surfaces to match that state and tears them down when the state removes them.

The bridge layer must intercept Ghostty actions and translate them into semantic app actions. Specifically, Ghostty `new_tab`, `close_tab`, and `goto_tab` must dispatch into `TerminalTabsFeature` so they affect Supaterm's vertical tab list. Split actions such as `new_split`, `goto_split`, `resize_split`, `equalize_splits`, and `toggle_split_zoom` must dispatch into the selected session so the host-owned pane tree changes first and the runtime follows. Metadata callbacks for title, prompt title, pwd, progress, bell, read-only, secure input, hover URL, and process exit state should update reducer state through semantic actions rather than mutating view models directly.

### Phase 3: Keep All Tabs Mounted So Terminal State Survives Switching

Replace the current selected-tab-only detail rendering in `TerminalView.swift` with a persistent tab host stack. Every session view should remain mounted while its tab exists, but only the selected one should be visible and interactive. A `ZStack`-based host, or a dedicated `TerminalSessionStackView`, is the simplest model. Hidden tabs should still exist in memory so their Ghostty surfaces, scrollback, and split arrangements are not destroyed on selection changes.

This phase must also handle focus and occlusion correctly. When a tab becomes inactive, the host runtime should mark its surfaces as occluded or unfocused so keyboard focus, cursor state, and activity indications are correct. When a tab becomes active again, the runtime should focus the session's `lastFocusedPaneID`. If the remembered pane no longer exists, focus the first live pane in visible order.

### Phase 4: Implement Host-Owned Pane Trees Inside Each Tab

Add a pane tree model to `TerminalSessionFeature`. The reducer should store one root split tree with branch nodes for split orientation and leaf nodes for pane identity. Each pane leaf corresponds to exactly one Ghostty surface in the runtime. The session reducer must support:

- creating a horizontal or vertical split from the focused pane,
- focusing a pane by identifier,
- moving focus by directional or ordinal commands,
- resizing the active split boundary,
- equalizing splits,
- toggling pane zoom,
- dragging panes to reorder within the same tab,
- removing a pane and collapsing the tree when a process exits or a close command targets that pane.

The view layer should render this tree with a dedicated split-tree view under `supaterm/Features/Terminal/`, following Supacode's structural approach rather than Ghostty's native controller implementation. Keep pane drag and drop constrained to the current tab. Do not implement tear-out or cross-window pane moves in this plan.

### Phase 5: Wire Shortcut Ownership And Command Routing

Keep Supaterm's app shell as the owner of vertical tab shortcuts. `supaterm/App/TerminalCommands.swift` should continue to send `new tab`, `close tab`, `next tab`, `previous tab`, and `Command-1` through `Command-0` into the app store, but the targets will now be real terminal sessions. Update the command titles if necessary so they reflect terminal sessions rather than placeholder content.

At the same time, make sure embedded Ghostty surfaces do not consume the tab-level shortcuts that belong to the host. The simplest implementation is to follow Supacode's shortcut strategy: either unbind those combinations from the Ghostty runtime configuration or intercept them before Ghostty acts on them. Vertical tab behavior must stay app-owned even when keyboard focus is inside a terminal surface.

Pane-local commands should remain terminal-oriented. Ghostty split shortcuts, pane focus shortcuts, resize shortcuts, equalize, zoom, search actions, copy, paste, and link opening should operate on the focused pane in the selected tab. Route pane-structure-changing actions through the reducer first, then let the runtime realize the new surface topology. Preserve Ghostty's own copy/paste and link handling where the embedded surface already supports it cleanly.

### Phase 6: Add Search And Surface Metadata Features

Implement the Ghostty-style search overlay for the focused pane. Add reducer state for search presentation and query, scoped to the selected pane or selected session. Support at least:

- show search,
- hide search,
- set query,
- find next,
- find previous,
- use selection for find when supported.

The search overlay should render as host chrome above the focused pane and call into the runtime to start/update/stop Ghostty search bindings. `Command-F`, `Command-G`, `Command-Shift-G`, and `Escape` should behave consistently when a terminal pane is focused.

At the same time, surface the likely-want metadata in the shell chrome. Tab rows and pane chrome should be able to reflect:

- progress state from Ghostty,
- bell activity,
- read-only state,
- secure-input state,
- hovered/openable links,
- current pwd/title-derived labels.

This metadata should flow one way: Ghostty surface callback -> semantic reducer action -> derived host UI. Do not create parallel imperative badge state in views.

### Phase 7: Close Confirmation And Focus Restoration

Implement tab close confirmation based on live process state. When the user invokes close on a tab and any pane in that session reports an active process that still needs confirmation, show a confirmation sheet or overlay at the app-shell level. Confirming should tear down the session and its surfaces. Canceling should leave the session untouched.

Also finalize per-tab focus restoration. Whenever focus changes inside a session, update `lastFocusedPaneID`. Whenever a tab becomes selected, ask the runtime to focus that pane after the view is active. This restoration should work across direct tab clicks, `Command-1` through `Command-0`, next/previous tab shortcuts, and Ghostty `goto_tab` actions remapped into the host.

### Phase 8: Clean Up The Old Prototype And Expand Tests

Delete the obsolete prototype pieces once the real terminal path is wired:

- remove counter-based tab actions,
- remove sample starter tabs and placeholder detail content,
- remove any now-dead tab-catalog helpers or placeholder styling logic that only existed for the mock UI.

Add reducer coverage for the new structural behavior and keep runtime-specific logic behind seams that are smoke-testable. The stateful rules that must be regression-tested include:

- bootstrapping a default terminal tab,
- creating a new tab from the selected tab and inheriting cwd/config from the focused pane,
- remapping `goto_tab` into vertical tab selection,
- close-tab fallback and live-process confirmation,
- split creation and tree collapse,
- pane focus restoration when switching tabs,
- in-tab pane drag/reorder,
- search action state transitions,
- tab slot shortcuts in visible order.

## Concrete Steps

All commands below should be run from the repository root at `/Users/khoi/Developer/code/github.com/supabitapp/supaterm`.

1. Verify the current shell seams before refactoring.

    `rg -n "TerminalTabFeature|TerminalTabsFeature|TerminalCommands|selectedTabID|count|Command Deck|Sessions" supaterm supatermTests`

    Expect to see the current mock tab/session model, the counter-based child reducer, and the already-wired tab commands that need to target real terminal sessions.

2. Add the first Ghostty hosting wrappers and confirm the xcframework surface compiles.

    `make build-app`

    Expect the app to still build after introducing the initial wrapper files under `supaterm/Features/Terminal/Ghostty/`. If this step fails because the xcframework surface differs from the bundled Ghostty source, stop and correct the wrapper layer before the reducer refactor proceeds.

3. Replace the mock tab model with reducer-owned terminal sessions and pane trees.

    `make check`

    Expect formatting and linting to pass after the new session/pane state is in place and the old counter/sample-tab code has been removed.

4. Run focused reducer tests while implementing tab, pane, and search behavior.

    `xcodebuild test -workspace supaterm.xcworkspace -scheme supaterm -destination "platform=macOS" -only-testing:supatermTests/TerminalTabsFeatureTests CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=\"\" -skipMacroValidation`

    If the tests move into a new suite such as `TerminalSessionFeatureTests`, update the focused target accordingly.

5. Run the full project verification after the Ghostty runtime, session stack, and shell commands are integrated.

    `make test`

    `make build-app`

6. Manually verify the integrated behavior in the running app.

    Launch the built app, create a second vertical tab, split the selected pane, switch focus between panes, resize a split, equalize and zoom a pane, search in the focused pane, switch tabs with `Command-1` and `Command-T`, return to the first tab, and verify that the pane tree and focused pane are preserved. Then try to close a tab with a running process and verify the confirmation prompt appears.

## Validation and Acceptance

Acceptance is behavioral first.

When the implementation is complete, Supaterm must open into a real terminal tab, not a placeholder detail card. Clicking a vertical tab, using `Command-T`, `Command-W`, next/previous tab shortcuts, or `Command-1` through `Command-0` must operate on the app-owned vertical tab list. If Ghostty issues `new_tab`, `close_tab`, or `goto_tab`, those actions must be remapped into the same vertical tab system. No native Ghostty horizontal tab UI should appear.

Each tab must preserve full terminal continuity across selection changes. A user must be able to split panes inside a tab, switch away, return, and find the exact same pane topology and focused pane still present. Pane actions must include split creation, focus changes, resize, equalize, zoom, and in-tab drag-reorder. Pane tear-out into a new window must not exist.

Search must work from the focused pane using a Ghostty-style overlay. Copy and paste must continue to work when a Ghostty pane is focused. Links should be openable. Bell, progress, read-only, and secure-input indicators must appear when Ghostty reports those states. Tab title and running state must reflect the focused pane's live metadata rather than static app-owned labels.

Closing a tab with a live process must ask for confirmation. Returning to a tab must restore focus to the previously focused pane. New tabs and new panes must inherit cwd and relevant terminal configuration from the focused source surface when there is one.

`make check`, focused reducer tests, `make test`, and `make build-app` must pass at the end.

## Idempotence and Recovery

This work can be staged safely because the project uses buildable folders. New files under `supaterm/App`, `supaterm/Features`, and `supatermTests` do not require project regeneration. `make check` and focused `xcodebuild test` runs can be repeated after each phase.

If the GhosttyKit wrapper surface differs from the bundled Ghostty source reference, correct the wrapper layer first and keep the reducer/model refactor paused. Do not build the reducer against guessed APIs. The xcframework, not the vendored source, is the integration truth.

If persistent tab mounting causes focus glitches during implementation, keep all sessions mounted but temporarily simplify visibility to a plain `ZStack` with one interactive view. Do not fall back to selected-tab-only mounting, because that would invalidate the entire persistence model.

If pane tree logic becomes unstable, keep the reducer as the source of truth and temporarily disable pane drag/drop before disabling split/focus/resize. Drag/drop is optional polish relative to the structural pane model, but native Ghostty horizontal tabs remain permanently out of scope.

Do not leave both the sample-tab path and the real Ghostty session path in the app. That would create dual terminal models and violate the single-source-of-truth requirement.

## Artifacts and Notes

Current Supaterm files that define the refactor starting point:

    supaterm/App/SupatermApp.swift
    supaterm/App/TerminalCommands.swift
    supaterm/Features/App/AppFeature.swift
    supaterm/Features/Terminal/TerminalView.swift
    supaterm/Features/Terminal/TerminalTabsFeature.swift
    supaterm/Features/Terminal/TerminalTabFeature.swift
    supatermTests/TerminalTabsFeatureTests.swift
    Project.swift

Supacode reference files for the intended hosting boundary:

    /Users/khoi/Developer/code/github.com/supabitapp/supacode/supacode/Features/Terminal/Models/WorktreeTerminalState.swift
    /Users/khoi/Developer/code/github.com/supabitapp/supacode/supacode/Infrastructure/Ghostty/GhosttySurfaceBridge.swift
    /Users/khoi/Developer/code/github.com/supabitapp/supacode/supacode/Features/Terminal/Views/WorktreeTerminalTabsView.swift
    /Users/khoi/Developer/code/github.com/supabitapp/supacode/supacode/Features/Terminal/Views/TerminalSplitTreeView.swift
    /Users/khoi/Developer/code/github.com/supabitapp/supacode/supacode/App/AppShortcuts.swift
    /Users/khoi/Developer/code/github.com/supabitapp/supacode/supacode/Commands/TerminalCommands.swift

Ghostty reference files for split/search/metadata behavior, but not for tab ownership:

    /Users/khoi/Developer/code/github.com/supabitapp/supaterm/ThirdParty/ghostty/macos/Sources/Features/Terminal/TerminalController.swift
    /Users/khoi/Developer/code/github.com/supabitapp/supaterm/ThirdParty/ghostty/macos/Sources/Features/Terminal/BaseTerminalController.swift
    /Users/khoi/Developer/code/github.com/supabitapp/supaterm/ThirdParty/ghostty/macos/Sources/Ghostty/Ghostty.App.swift
    /Users/khoi/Developer/code/github.com/supabitapp/supaterm/ThirdParty/ghostty/macos/Sources/Ghostty/Surface View/SurfaceView.swift
    /Users/khoi/Developer/code/github.com/supabitapp/supaterm/ThirdParty/ghostty/macos/Sources/Ghostty/Surface View/SurfaceView_AppKit.swift
    /Users/khoi/Developer/code/github.com/supabitapp/supaterm/ThirdParty/ghostty/macos/Sources/Features/Splits/TerminalSplitTreeView.swift

Useful facts captured from the current repo state:

    `NSWindow.allowsAutomaticWindowTabbing = false` is already set in `AppDelegate`, which aligns with the "no native horizontal tab system" goal.
    `Project.swift` already links `Frameworks/GhosttyKit.xcframework`, so the integration work is a host/runtime problem, not a dependency-management problem.
    `TerminalCommands.swift` already owns the app-shell tab shortcut surface and should remain the owner of vertical tab semantics.

## Interfaces and Dependencies

The exact type names may change once the GhosttyKit wrapper surface is proven, but the implementation should land near the following shape.

Replace the current child reducer with a session reducer:

    @Reducer
    struct TerminalSessionFeature {
      @ObservableState
      struct State: Equatable, Identifiable {
        var id: UUID
        var rootPane: TerminalPaneTree.Node
        var focusedPaneID: TerminalPaneState.ID
        var lastFocusedPaneID: TerminalPaneState.ID
        var search: TerminalSearchState?

        var focusedPane: TerminalPaneState { ... }
        var title: String { focusedPane.displayTitle }
        var runningState: TerminalRunningState { ... }
      }

      enum Action: Equatable {
        case ghosttyEvent(TerminalPaneEvent)
        case splitRequested(TerminalSplitDirection)
        case paneFocused(TerminalPaneState.ID)
        case paneClosed(TerminalPaneState.ID)
        case paneDragged(TerminalPaneDragAction)
        case resizeRequested(TerminalResizeAction)
        case equalizeRequested
        case toggleZoomRequested
        case search(TerminalSearchAction)
      }
    }

Model pane identity and metadata separately from live Ghostty surfaces:

    struct TerminalPaneState: Equatable, Identifiable {
      var id: UUID
      var title: String?
      var pwd: String?
      var hoverURL: URL?
      var progress: TerminalProgress?
      var hasBell: Bool
      var isReadOnly: Bool
      var hasSecureInput: Bool
      var processState: TerminalProcessState

      var displayTitle: String { ... }
      var needsCloseConfirmation: Bool { ... }
    }

    enum TerminalPaneTree: Equatable {
      case leaf(TerminalPaneState.ID)
      case branch(
        id: UUID,
        axis: Axis,
        children: IdentifiedArrayOf<Node>,
        zoomedPaneID: TerminalPaneState.ID?
      )
    }

Keep tab ownership in the parent reducer:

    @Reducer
    struct TerminalTabsFeature {
      @ObservableState
      struct State: Equatable {
        var tabs: IdentifiedArrayOf<TerminalSessionFeature.State>
        var selectedTabID: TerminalSessionFeature.State.ID
        var pendingCloseConfirmation: PendingTabCloseConfirmation?

        var selectedTab: TerminalSessionFeature.State { ... }
        var visibleTabs: [TerminalSessionFeature.State] { ... }
      }

      enum Action: Equatable {
        case newTabRequested(sourceTabID: UUID?)
        case closeTabRequested(UUID)
        case closeTabConfirmed(UUID)
        case closeTabCancelled
        case nextTabRequested
        case previousTabRequested
        case tabSelected(UUID)
        case tabShortcutPressed(Int)
        case ghosttyTabAction(TerminalGhosttyTabAction)
        case session(IdentifiedActionOf<TerminalSessionFeature>)
      }
    }

The runtime layer should remain imperative and main-actor-bound:

    @MainActor
    final class GhosttyHostRuntime {
      func reconcile(
        tabs: IdentifiedArrayOf<TerminalSessionFeature.State>,
        selectedTabID: TerminalSessionFeature.State.ID
      )

      func hostView(
        tabID: TerminalSessionFeature.State.ID,
        paneID: TerminalPaneState.ID
      ) -> GhosttySurfaceHostView

      func focusPane(
        tabID: TerminalSessionFeature.State.ID,
        paneID: TerminalPaneState.ID
      )

      func updateSearch(
        tabID: TerminalSessionFeature.State.ID,
        paneID: TerminalPaneState.ID,
        state: TerminalSearchState?
      )
    }

Keep command routing simple:

    `TerminalCommands.swift` should continue to send tab actions through `StoreOf<AppFeature>`.
    Pane-local commands that need the selected tab and focused pane should still go through reducer actions, not direct NotificationCenter mutations.
    The runtime should receive imperative work only after reducer state changes have established the new tab/pane model.

Change note: created this plan on 2026-03-14 21:40Z after auditing Supaterm, Supacode, and the bundled Ghostty macOS source, and after resolving the close-policy, pane-drag-scope, and search-overlay product choices.

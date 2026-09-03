import AppKit
import ComposableArchitecture
import Sharing
import SupaTheme
import SupatermSettingsFeature
import SupatermUI
import SwiftUI

private enum TerminalDialogDestination {
  case close(TerminalWindowFeature.PendingCloseRequest)
  case spaceDelete(TerminalSpaceDeleteRequest)
}

struct TerminalView: View {
  let commandPaletteClient: TerminalCommandPaletteClient
  let store: StoreOf<TerminalWindowFeature>
  @Bindable var terminal: TerminalHostState
  let updateWindowShell: (TerminalWindowShellPresentation) -> Void
  @Shared(.supatermSettings) private var supatermSettings = .default
  @Environment(CommandHoldObserver.self) private var commandHoldObserver
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  @State private var window: NSWindow?

  private var chromeColorScheme: ColorScheme {
    terminal.chromeColorScheme(appearanceMode: supatermSettings.appearanceMode)
  }

  private var windowAppearance: NSAppearance? {
    supatermSettings.appearanceMode.appearance
  }

  private var palette: Palette {
    terminal.chromePalette(appearanceMode: supatermSettings.appearanceMode)
  }

  private var dialogDestination: TerminalDialogDestination? {
    switch store.destination {
    case .closeConfirmation(let request):
      .close(request)
    case .spaceDeleteConfirmation(let request):
      .spaceDelete(request)
    case nil, .commandPalette, .spaceEditor, .windowCloseConfirmation:
      nil
    }
  }

  private var dialogDestinationBinding: Binding<TerminalDialogDestination?> {
    let presentedDestination = dialogDestination
    return Binding(
      get: { dialogDestination },
      set: { destination in
        guard case nil = destination, let presentedDestination else { return }
        switch presentedDestination {
        case .close:
          _ = store.send(.closeConfirmationCancelButtonTapped)
        case .spaceDelete:
          _ = store.send(.spaceDeleteCancelButtonTapped)
        }
      }
    )
  }

  private var spaceEditorTextBinding: Binding<String> {
    Binding(
      get: { store.spaceEditor?.draftName ?? "" },
      set: { _ = store.send(.spaceEditorTextChanged($0)) }
    )
  }

  private var spaceEditorColorBinding: Binding<ThemeTint> {
    Binding(
      get: { store.spaceEditor?.draftColor ?? .neutral },
      set: { _ = store.send(.spaceEditorColorSelected($0)) }
    )
  }

  private var spaceEditorIsValid: Bool {
    guard let spaceEditor = store.spaceEditor else { return false }
    return terminal.isSpaceNameAvailable(
      spaceEditor.draftName,
      excluding: spaceEditor.excludedSpaceID
    )
  }

  var body: some View {
    terminalLayout
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background {
        WindowAppearanceApplier(appliedAppearance: windowAppearance)
      }
      .background(WindowTitleApplier(title: terminal.displayedSpace.name))
      .overlay {
        WindowChromeConfigurator()
          .frame(width: 0, height: 0)
      }
      .background(WindowReader(window: $window))
      .background {
        if let commandPalette = store.commandPalette {
          TerminalCommandPalettePanelPresenter(
            configuration: commandPalettePanelConfiguration(commandPalette)
          )
          .frame(width: 0, height: 0)
        }
      }
      .background(
        WindowFocusObserverView { activity in
          terminal.updateWindowActivity(activity)
        }
      )
      .task(id: resolvedWindowActivity) {
        terminal.updateWindowActivity(resolvedWindowActivity)
      }
      .onChange(of: shellPresentation, initial: true) { _, presentation in
        updateWindowShell(presentation)
      }
      .onChange(of: store.commandPalette != nil) { wasPresented, isPresented in
        guard wasPresented, !isPresented else { return }
        restoreTerminalFocusIfNeeded()
      }
      .overlay {
        if let spaceEditor = store.spaceEditor {
          SpaceEditorOverlay(
            palette: palette,
            title: spaceEditor.title,
            confirmTitle: spaceEditor.confirmTitle,
            name: spaceEditorTextBinding,
            color: spaceEditorColorBinding,
            isSaveEnabled: spaceEditorIsValid,
            onSave: {
              guard spaceEditorIsValid else { return }
              _ = store.send(.spaceEditorSaveButtonTapped)
            },
            onCancel: {
              _ = store.send(.spaceEditorCancelButtonTapped)
            }
          )
        }
      }
      .dialogSurface(item: dialogDestinationBinding) { destination in
        switch destination {
        case .close(let pendingCloseRequest):
          ConfirmationOverlay(
            palette: palette,
            title: pendingCloseRequest.title,
            message: pendingCloseRequest.message,
            confirmTitle: "Close",
            onConfirm: {
              _ = store.send(.closeConfirmationConfirmButtonTapped)
            },
            onCancel: {
              _ = store.send(.closeConfirmationCancelButtonTapped)
            }
          )
        case .spaceDelete(let pendingSpaceDeleteRequest):
          TerminalSpaceDeleteDialog(
            palette: palette,
            spaceName: pendingSpaceDeleteRequest.space.name,
            paneCount: terminal.paneCountAcrossWindows(pendingSpaceDeleteRequest.space.id),
            onConfirm: {
              _ = store.send(.spaceDeleteConfirmButtonTapped)
            },
            onCancel: {
              _ = store.send(.spaceDeleteCancelButtonTapped)
            }
          )
        }
      }
      .terminalAnimation(
        .easeOut(duration: 0.12),
        value: store.commandPalette != nil,
        reduceMotion: reduceMotion
      )
      .terminalAnimation(
        .spring(response: 0.28, dampingFraction: 0.82),
        value: terminal.visibleTabs.map(\.id),
        reduceMotion: reduceMotion
      )
      .terminalAnimation(
        .spring(response: 0.28, dampingFraction: 0.82),
        value: terminal.spaces.map(\.id),
        reduceMotion: reduceMotion
      )
      .environment(\.colorScheme, chromeColorScheme)
  }

  private func commandPalettePanelConfiguration(
    _ commandPalette: TerminalCommandPaletteState
  ) -> TerminalCommandPalettePanelConfiguration {
    let snapshot = commandPaletteClient.snapshot(store.windowID)
    return TerminalCommandPalettePanelConfiguration(
      commandHoldObserver: commandHoldObserver,
      matches: TerminalCommandPalettePresentation.matches(
        from: snapshot,
        query: commandPalette.query
      ),
      palette: palette,
      state: commandPalette,
      activate: { _ = store.send(.commandPaletteActivateSelection) },
      activateSlot: { _ = store.send(.commandPaletteSlotActivated($0)) },
      close: { _ = store.send(.commandPaletteCloseRequested) },
      moveSelection: { _ = store.send(.commandPaletteSelectionMoved($0)) },
      queryChanged: { _ = store.send(.commandPaletteQueryChanged($0)) },
      selectionChanged: { _ = store.send(.commandPaletteSelectionChanged($0)) }
    )
  }

  private func restoreTerminalFocusIfNeeded() {
    Task { @MainActor in
      await Task.yield()
      guard let window else { return }
      guard window.isKeyWindow else { return }
      guard let surface = terminal.selectedSurfaceView else { return }
      guard surface.window === window else { return }
      window.makeFirstResponder(surface)
    }
  }

  private var resolvedWindowActivity: WindowActivityState {
    if let window {
      return WindowActivityState(
        isKeyWindow: window.isKeyWindow,
        isVisible: window.occlusionState.contains(.visible)
      )
    }
    return .inactive
  }

  @ViewBuilder
  private var terminalLayout: some View {
    if let selectedTabID = terminal.selectedTabID {
      TerminalDetailView(
        store: store,
        palette: palette,
        terminal: terminal,
        selectedTabID: selectedTabID
      )
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    } else {
      Color.clear
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }

  private var shellPresentation: TerminalWindowShellPresentation {
    TerminalWindowShellPresentation(
      isSidebarCollapsed: store.isSidebarCollapsed,
      sidebarResizeState: store.sidebarResizeState,
      sidebarWidth: store.sidebarWidth
    )
  }
}

struct TerminalWindowChromeBackground: View {
  @Shared(.supatermSettings) private var supatermSettings = .default
  let terminal: TerminalHostState

  private var palette: Palette {
    terminal.chromePalette(appearanceMode: supatermSettings.appearanceMode)
  }

  var body: some View {
    ChromeBackgroundView(palette: palette)
  }
}

extension TerminalHostState {
  fileprivate func chromeColorScheme(appearanceMode: AppearanceMode) -> ColorScheme {
    appearanceMode.colorScheme ?? terminalChromeColorScheme
  }

  func chromePalette(appearanceMode: AppearanceMode) -> Palette {
    Palette(
      colorScheme: chromeColorScheme(appearanceMode: appearanceMode),
      tint: displayedSpace.color
    )
  }
}

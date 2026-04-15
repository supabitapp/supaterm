import AppKit
import ComposableArchitecture
import SupatermUpdateFeature
import SwiftUI

struct TerminalView: View {
  let commandPaletteClient: TerminalCommandPaletteClient
  let store: StoreOf<TerminalWindowFeature>
  let updateStore: StoreOf<UpdateFeature>
  @Bindable var terminal: TerminalHostState
  @Environment(\.colorScheme) private var colorScheme

  @State private var window: NSWindow?

  private let minSidebarFraction: CGFloat = 0.10
  private let maxSidebarFraction: CGFloat = 0.30

  private var palette: TerminalPalette {
    TerminalPalette(colorScheme: colorScheme)
  }

  private var pendingCloseBinding: Binding<Bool> {
    Binding(
      get: { store.pendingCloseRequest != nil },
      set: {
        if !$0 {
          _ = store.send(.closeConfirmationCancelButtonTapped)
        }
      }
    )
  }

  private var pendingSpaceDeleteBinding: Binding<Bool> {
    Binding(
      get: { store.pendingSpaceDeleteRequest != nil },
      set: {
        if !$0 {
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

  private var spaceEditorIsValid: Bool {
    guard let spaceEditor = store.spaceEditor else { return false }
    return terminal.isSpaceNameAvailable(
      spaceEditor.draftName,
      excluding: spaceEditor.excludedSpaceID
    )
  }

  private var sidebarFractionBinding: Binding<CGFloat> {
    Binding(
      get: { store.sidebarFraction },
      set: { _ = store.send(.sidebarFractionChanged($0)) }
    )
  }

  private var floatingSidebarVisibilityBinding: Binding<Bool> {
    Binding(
      get: { store.isFloatingSidebarVisible },
      set: { _ = store.send(.floatingSidebarVisibilityChanged($0)) }
    )
  }

  var body: some View {
    GeometryReader(content: terminalLayout)
      .frame(minWidth: 1_080, minHeight: 720)
      .background(palette.windowBackgroundTint)
      .background {
        BlurEffectView(material: .underWindowBackground, blendingMode: .behindWindow)
          .ignoresSafeArea()
      }
      .overlay {
        WindowChromeConfigurator()
          .frame(width: 0, height: 0)
      }
      .background(WindowReader(window: $window))
      .background(
        WindowFocusObserverView { activity in
          _ = store.send(.windowActivityChanged(activity))
        }
      )
      .ignoresSafeArea()
      .task(id: resolvedWindowActivity) {
        let activity = resolvedWindowActivity
        _ = store.send(.windowActivityChanged(activity))
      }
      .onChange(of: store.commandPalette != nil) { wasPresented, isPresented in
        guard wasPresented, !isPresented else { return }
        restoreTerminalFocusIfNeeded()
      }
      .overlay {
        if let commandPalette = store.commandPalette {
          let snapshot = commandPaletteClient.snapshot(store.windowID)
          let rows = TerminalCommandPalettePresentation.visibleRows(from: snapshot, query: commandPalette.query)
          TerminalCommandPaletteOverlay(
            palette: palette,
            state: commandPalette,
            rows: rows,
            onActivate: {
              _ = store.send(.commandPaletteActivateSelection)
            },
            onClose: {
              _ = store.send(.commandPaletteCloseRequested)
            },
            onQueryChange: {
              _ = store.send(.commandPaletteQueryChanged($0))
            },
            onMoveSelection: {
              _ = store.send(.commandPaletteSelectionMoved($0))
            },
            onSelectionChange: {
              _ = store.send(.commandPaletteSelectionChanged($0))
            }
          )
        }
      }
      .overlay {
        if let confirmationRequest = store.confirmationRequest {
          ConfirmationOverlay(
            palette: palette,
            title: confirmationRequest.title,
            message: confirmationRequest.message,
            confirmTitle: confirmationRequest.confirmTitle,
            onConfirm: {
              _ = store.send(.confirmationConfirmButtonTapped)
            },
            onCancel: {
              _ = store.send(.confirmationCancelButtonTapped)
            }
          )
        }
      }
      .overlay {
        if let spaceEditor = store.spaceEditor {
          SpaceNameOverlay(
            palette: palette,
            title: spaceEditor.title,
            confirmTitle: spaceEditor.confirmTitle,
            name: spaceEditorTextBinding,
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
      .alert(
        store.pendingCloseRequest?.title ?? "Close?",
        isPresented: pendingCloseBinding
      ) {
        Button("Cancel", role: .cancel) {
          _ = store.send(.closeConfirmationCancelButtonTapped)
        }
        Button("Close", role: .destructive) {
          _ = store.send(.closeConfirmationConfirmButtonTapped)
        }
        .keyboardShortcut(.defaultAction)
      } message: {
        Text(store.pendingCloseRequest?.message ?? "")
      }
      .alert(
        spaceDeleteTitle,
        isPresented: pendingSpaceDeleteBinding
      ) {
        Button("Cancel", role: .cancel) {
          _ = store.send(.spaceDeleteCancelButtonTapped)
        }
        Button("Delete", role: .destructive) {
          _ = store.send(.spaceDeleteConfirmButtonTapped)
        }
      } message: {
        Text(spaceDeleteMessage)
      }
      .animation(.easeOut(duration: 0.1), value: store.isFloatingSidebarVisible)
      .animation(.easeOut(duration: 0.12), value: store.commandPalette != nil)
      .animation(.spring(response: 0.3, dampingFraction: 0.82), value: store.confirmationRequest)
      .animation(
        .spring(response: 0.28, dampingFraction: 0.82), value: terminal.visibleTabs.map(\.id)
      )
      .animation(.spring(response: 0.28, dampingFraction: 0.82), value: terminal.spaces.map(\.id))
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

  private var spaceDeleteTitle: String {
    guard let request = store.pendingSpaceDeleteRequest else {
      return "Delete Space?"
    }
    return "Delete Space \"\(request.space.name)\"?"
  }

  private var spaceDeleteMessage: String {
    "All tabs in this space will be closed."
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
  private func terminalLayout(geometry: GeometryProxy) -> some View {
    ZStack(alignment: .leading) {
      TerminalSplitView(
        store: store,
        updateStore: updateStore,
        palette: palette,
        terminal: terminal,
        totalWidth: geometry.size.width,
        isSidebarCollapsed: store.isSidebarCollapsed,
        sidebarFraction: sidebarFractionBinding,
        minFraction: minSidebarFraction,
        maxFraction: maxSidebarFraction,
        onHide: collapseSidebar
      )
      .frame(maxWidth: .infinity, maxHeight: .infinity)

      if store.isSidebarCollapsed {
        FloatingSidebarOverlay(
          store: store,
          updateStore: updateStore,
          palette: palette,
          terminal: terminal,
          totalWidth: geometry.size.width,
          sidebarFraction: sidebarFractionBinding,
          isVisible: floatingSidebarVisibilityBinding,
          minFraction: minSidebarFraction,
          maxFraction: maxSidebarFraction
        )
      }
    }
  }

  private func collapseSidebar() {
    _ = store.send(.collapseSidebarButtonTapped)
  }
}

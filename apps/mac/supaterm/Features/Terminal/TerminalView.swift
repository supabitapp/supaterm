import AppKit
import ComposableArchitecture
import SwiftUI

struct TerminalView: View {
  let store: StoreOf<TerminalSceneFeature>
  @Bindable var terminal: TerminalHostState
  let onWindowChanged: (NSWindow?) -> Void
  let updateStore: StoreOf<UpdateFeature>
  @Environment(\.colorScheme) private var colorScheme

  @State private var window: NSWindow?

  private let minSidebarFraction: CGFloat = 0.16
  private let maxSidebarFraction: CGFloat = 0.30

  private var palette: TerminalPalette {
    TerminalPalette(colorScheme: colorScheme)
  }

  private var updatePresentationContext: UpdatePresentationContext {
    UpdatePresentationContext(
      isFloatingSidebarVisible: store.isFloatingSidebarVisible,
      isSidebarCollapsed: store.isSidebarCollapsed
    )
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

  private var pendingWorkspaceDeleteBinding: Binding<Bool> {
    Binding(
      get: { store.pendingWorkspaceDeleteRequest != nil },
      set: {
        if !$0 {
          _ = store.send(.workspaceDeleteCancelButtonTapped)
        }
      }
    )
  }

  private var workspaceRenameTextBinding: Binding<String> {
    Binding(
      get: { store.workspaceRename?.draftName ?? "" },
      set: { _ = store.send(.workspaceRenameTextChanged($0)) }
    )
  }

  private var workspaceRenameIsValid: Bool {
    guard let workspaceRename = store.workspaceRename else { return false }
    return terminal.isWorkspaceNameAvailable(
      workspaceRename.draftName,
      excluding: workspaceRename.workspace.id
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
      .onChange(of: window) { _, window in
        _ = store.send(.windowChanged(window.map(ObjectIdentifier.init)))
        onWindowChanged(window)
      }
      .background(
        WindowFocusObserverView { activity in
          _ = store.send(.windowActivityChanged(activity))
        }
      )
      .ignoresSafeArea()
      .task(id: updatePresentationContext) {
        guard resolvedWindowActivity.isKeyWindow else { return }
        _ = updateStore.send(.presentationContextChanged(updatePresentationContext))
      }
      .task(id: resolvedWindowActivity) {
        let activity = resolvedWindowActivity
        _ = store.send(.windowActivityChanged(activity))
        guard activity.isKeyWindow else { return }
        _ = updateStore.send(.presentationContextChanged(updatePresentationContext))
      }
      .overlay {
        if store.isQuitConfirmationPresented {
          QuitConfirmationOverlay(
            palette: palette,
            onConfirm: {
              _ = store.send(.quitConfirmationConfirmButtonTapped)
            },
            onCancel: {
              _ = store.send(.quitConfirmationCancelButtonTapped)
            }
          )
        }
      }
      .overlay {
        if store.workspaceRename != nil {
          WorkspaceRenameOverlay(
            palette: palette,
            title: "Rename Workspace",
            name: workspaceRenameTextBinding,
            isSaveEnabled: workspaceRenameIsValid,
            onSave: {
              guard workspaceRenameIsValid else { return }
              _ = store.send(.workspaceRenameSaveButtonTapped)
            },
            onCancel: {
              _ = store.send(.workspaceRenameCancelButtonTapped)
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
      } message: {
        Text(store.pendingCloseRequest?.message ?? "")
      }
      .alert(
        workspaceDeleteTitle,
        isPresented: pendingWorkspaceDeleteBinding
      ) {
        Button("Cancel", role: .cancel) {
          _ = store.send(.workspaceDeleteCancelButtonTapped)
        }
        Button("Delete", role: .destructive) {
          _ = store.send(.workspaceDeleteConfirmButtonTapped)
        }
      } message: {
        Text(workspaceDeleteMessage)
      }
      .animation(.spring(response: 0.2, dampingFraction: 1.0), value: store.isSidebarCollapsed)
      .animation(.easeOut(duration: 0.1), value: store.isFloatingSidebarVisible)
      .animation(.spring(response: 0.3, dampingFraction: 0.82), value: store.isQuitConfirmationPresented)
      .animation(.spring(response: 0.28, dampingFraction: 0.82), value: terminal.visibleTabs.map(\.id))
      .animation(.spring(response: 0.28, dampingFraction: 0.82), value: terminal.workspaces.map(\.id))
  }

  private var workspaceDeleteTitle: String {
    guard let request = store.pendingWorkspaceDeleteRequest else {
      return "Delete Workspace?"
    }
    return "Delete Workspace \"\(request.workspace.name)\"?"
  }

  private var workspaceDeleteMessage: String {
    "All tabs in this workspace will be closed."
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
        palette: palette,
        terminal: terminal,
        totalWidth: geometry.size.width,
        isSidebarCollapsed: store.isSidebarCollapsed,
        sidebarFraction: sidebarFractionBinding,
        minFraction: minSidebarFraction,
        maxFraction: maxSidebarFraction,
        onHide: collapseSidebar,
        updateStore: updateStore
      )
      .frame(maxWidth: .infinity, maxHeight: .infinity)

      if store.isSidebarCollapsed {
        FloatingSidebarOverlay(
          store: store,
          palette: palette,
          terminal: terminal,
          totalWidth: geometry.size.width,
          sidebarFraction: sidebarFractionBinding,
          isVisible: floatingSidebarVisibilityBinding,
          minFraction: minSidebarFraction,
          maxFraction: maxSidebarFraction,
          updateStore: updateStore
        )
      }
    }
  }

  private func collapseSidebar() {
    withAnimation(.spring(response: 0.2, dampingFraction: 1.0)) {
      _ = store.send(.collapseSidebarButtonTapped)
    }
  }
}

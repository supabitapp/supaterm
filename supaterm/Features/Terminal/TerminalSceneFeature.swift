import AppKit
import ComposableArchitecture
import CoreGraphics

private enum TerminalSceneCancelID {
  static let events = "TerminalSceneFeature.events"
}

struct TerminalWorkspaceDeleteRequest: Equatable, Identifiable {
  let workspace: TerminalWorkspaceItem

  var id: TerminalWorkspaceID { workspace.id }
}

struct TerminalWorkspaceRenameState: Equatable, Identifiable {
  let workspace: TerminalWorkspaceItem
  var draftName: String

  var id: TerminalWorkspaceID { workspace.id }
}

@Reducer
struct TerminalSceneFeature {
  @ObservableState
  struct State: Equatable {
    var isFloatingSidebarVisible = false
    var isQuitConfirmationPresented = false
    var isSidebarCollapsed = false
    var pendingCloseRequest: PendingCloseRequest?
    var pendingWorkspaceDeleteRequest: TerminalWorkspaceDeleteRequest?
    var sidebarFraction: CGFloat = 0.2
    var windowID: ObjectIdentifier?
    var workspaceRename: TerminalWorkspaceRenameState?
  }

  struct PendingCloseRequest: Equatable, Identifiable {
    let target: PendingCloseTarget
    let title: String
    let message: String

    var id: String {
      switch target {
      case .pane(let surfaceID):
        return "pane:\(surfaceID.uuidString)"
      case .tab(let tabID):
        return "tab:\(tabID.rawValue.uuidString)"
      }
    }
  }

  enum PendingCloseTarget: Equatable {
    case pane(UUID)
    case tab(TerminalTabID)
  }

  enum Action {
    case clientEvent(TerminalClient.Event)
    case closeConfirmationCancelButtonTapped
    case closeConfirmationConfirmButtonTapped
    case closeSurfaceMenuItemSelected
    case closeTabRequested(TerminalTabID)
    case collapseSidebarButtonTapped
    case endSearchMenuItemSelected
    case equalizePanesMenuItemSelected
    case floatingSidebarVisibilityChanged(Bool)
    case navigateSearchNextMenuItemSelected
    case navigateSearchPreviousMenuItemSelected
    case newTabButtonTapped(inheritingFromSurfaceID: UUID?)
    case nextTabMenuItemSelected
    case pinnedTabOrderChanged([TerminalTabID])
    case previousTabMenuItemSelected
    case quitConfirmationCancelButtonTapped
    case quitConfirmationConfirmButtonTapped
    case quitRequested(windowID: ObjectIdentifier)
    case regularTabOrderChanged([TerminalTabID])
    case searchSelectionMenuItemSelected
    case selectLastTabMenuItemSelected
    case selectTabMenuItemSelected(Int)
    case selectWorkspaceButtonTapped(TerminalWorkspaceID)
    case selectWorkspaceMenuItemSelected(Int)
    case sidebarFractionChanged(CGFloat)
    case splitBelowMenuItemSelected
    case splitOperationRequested(tabID: TerminalTabID, operation: TerminalSplitTreeView.Operation)
    case splitRightMenuItemSelected
    case startSearchMenuItemSelected
    case tabSelected(TerminalTabID)
    case task
    case workspaceCreateButtonTapped
    case workspaceDeleteCancelButtonTapped
    case workspaceDeleteConfirmButtonTapped
    case workspaceDeleteRequested(TerminalWorkspaceItem)
    case workspaceRenameCancelButtonTapped
    case workspaceRenameRequested(TerminalWorkspaceItem)
    case workspaceRenameSaveButtonTapped
    case workspaceRenameTextChanged(String)
    case togglePaneZoomMenuItemSelected
    case togglePinned(TerminalTabID)
    case toggleSidebarButtonTapped
    case windowActivityChanged(WindowActivityState)
    case windowChanged(ObjectIdentifier?)
  }

  @Dependency(TerminalClient.self) var terminalClient

  var body: some Reducer<State, Action> {
    Reduce { state, action in
      switch action {
      case .clientEvent(let event):
        switch event {
        case .closeSurfaceRequested(let surfaceID, let processAlive):
          if processAlive {
            state.pendingCloseRequest = PendingCloseRequest(
              target: .pane(surfaceID),
              title: "Close Pane?",
              message: "A process is still running in this pane. Close it anyway?"
            )
            return .none
          }
          return sendCommand(.closeSurface(surfaceID))

        case .closeTabRequested(let tabID):
          return .send(.closeTabRequested(tabID))

        case .gotoTabRequested(let target):
          switch target {
          case .index(let slot):
            return .send(.selectTabMenuItemSelected(slot))
          case .last:
            return .send(.selectLastTabMenuItemSelected)
          case .next:
            return .send(.nextTabMenuItemSelected)
          case .previous:
            return .send(.previousTabMenuItemSelected)
          }

        case .newTabRequested(let inheritingFromSurfaceID):
          return .send(.newTabButtonTapped(inheritingFromSurfaceID: inheritingFromSurfaceID))
        }

      case .closeConfirmationCancelButtonTapped:
        state.pendingCloseRequest = nil
        return .none

      case .closeConfirmationConfirmButtonTapped:
        guard let pendingCloseRequest = state.pendingCloseRequest else { return .none }
        state.pendingCloseRequest = nil
        switch pendingCloseRequest.target {
        case .pane(let surfaceID):
          return sendCommand(.closeSurface(surfaceID))
        case .tab(let tabID):
          return sendCommand(.closeTab(tabID))
        }

      case .workspaceDeleteCancelButtonTapped:
        state.pendingWorkspaceDeleteRequest = nil
        return .none

      case .workspaceDeleteConfirmButtonTapped:
        guard let request = state.pendingWorkspaceDeleteRequest else { return .none }
        state.pendingWorkspaceDeleteRequest = nil
        return sendCommand(.deleteWorkspace(request.workspace.id))

      case .closeSurfaceMenuItemSelected:
        return sendCommand(.performBindingActionOnFocusedSurface("close_surface"))

      case .closeTabRequested(let tabID):
        if terminalClient.tabNeedsCloseConfirmation(tabID) {
          state.pendingCloseRequest = PendingCloseRequest(
            target: .tab(tabID),
            title: "Close Tab?",
            message: "A process is still running in this tab. Close it anyway?"
          )
          return .none
        }
        return sendCommand(.closeTab(tabID))

      case .collapseSidebarButtonTapped:
        state.isFloatingSidebarVisible = false
        state.isSidebarCollapsed = true
        return .none

      case .endSearchMenuItemSelected:
        return sendCommand(.performBindingActionOnFocusedSurface("end_search"))

      case .equalizePanesMenuItemSelected:
        return sendCommand(.performBindingActionOnFocusedSurface("equalize_splits"))

      case .floatingSidebarVisibilityChanged(let isVisible):
        state.isFloatingSidebarVisible = isVisible
        return .none

      case .navigateSearchNextMenuItemSelected:
        return sendCommand(.navigateSearch(.next))

      case .navigateSearchPreviousMenuItemSelected:
        return sendCommand(.navigateSearch(.previous))

      case .newTabButtonTapped(let inheritingFromSurfaceID):
        return sendCommand(.createTab(inheritingFromSurfaceID: inheritingFromSurfaceID))

      case .nextTabMenuItemSelected:
        return sendCommand(.nextTab)

      case .pinnedTabOrderChanged(let orderedIDs):
        return sendCommand(.setPinnedTabOrder(orderedIDs))

      case .previousTabMenuItemSelected:
        return sendCommand(.previousTab)

      case .quitConfirmationCancelButtonTapped:
        state.isQuitConfirmationPresented = false
        return .run { _ in
          await MainActor.run {
            NSApplication.shared.reply(toApplicationShouldTerminate: false)
          }
        }

      case .quitConfirmationConfirmButtonTapped:
        state.isQuitConfirmationPresented = false
        return .run { _ in
          await MainActor.run {
            NSApplication.shared.reply(toApplicationShouldTerminate: true)
          }
        }

      case .quitRequested(let windowID):
        if let currentWindowID = state.windowID, currentWindowID != windowID {
          return .none
        }
        state.isQuitConfirmationPresented = true
        return .none

      case .regularTabOrderChanged(let orderedIDs):
        return sendCommand(.setRegularTabOrder(orderedIDs))

      case .searchSelectionMenuItemSelected:
        return sendCommand(.performBindingActionOnFocusedSurface("search_selection"))

      case .selectLastTabMenuItemSelected:
        return sendCommand(.selectLastTab)

      case .selectTabMenuItemSelected(let slot):
        return sendCommand(.selectTabSlot(slot))

      case .selectWorkspaceButtonTapped(let workspaceID):
        return sendCommand(.selectWorkspace(workspaceID))

      case .selectWorkspaceMenuItemSelected(let slot):
        return sendCommand(.selectWorkspaceSlot(slot))

      case .sidebarFractionChanged(let fraction):
        state.sidebarFraction = fraction
        return .none

      case .splitBelowMenuItemSelected:
        return sendCommand(.performBindingActionOnFocusedSurface("new_split:down"))

      case .splitOperationRequested(let tabID, let operation):
        return sendCommand(.performSplitOperation(tabID: tabID, operation: operation))

      case .splitRightMenuItemSelected:
        return sendCommand(.performBindingActionOnFocusedSurface("new_split:right"))

      case .startSearchMenuItemSelected:
        return sendCommand(.performBindingActionOnFocusedSurface("start_search"))

      case .tabSelected(let tabID):
        return sendCommand(.selectTab(tabID))

      case .task:
        return .merge(
          sendCommand(.ensureInitialTab(focusing: false)),
          .run { [terminalClient] send in
            let events = await terminalClient.events()
            for await event in events {
              await send(.clientEvent(event))
            }
          }
          .cancellable(id: TerminalSceneCancelID.events, cancelInFlight: true)
        )

      case .workspaceCreateButtonTapped:
        return sendCommand(.createWorkspace)

      case .workspaceDeleteRequested(let workspace):
        state.pendingWorkspaceDeleteRequest = .init(workspace: workspace)
        return .none

      case .workspaceRenameCancelButtonTapped:
        state.workspaceRename = nil
        return .none

      case .workspaceRenameRequested(let workspace):
        state.workspaceRename = .init(workspace: workspace, draftName: workspace.name)
        return .none

      case .workspaceRenameSaveButtonTapped:
        guard let workspaceRename = state.workspaceRename else { return .none }
        state.workspaceRename = nil
        return sendCommand(.renameWorkspace(workspaceRename.workspace.id, workspaceRename.draftName))

      case .workspaceRenameTextChanged(let text):
        state.workspaceRename?.draftName = text
        return .none

      case .togglePaneZoomMenuItemSelected:
        return sendCommand(.performBindingActionOnFocusedSurface("toggle_split_zoom"))

      case .togglePinned(let tabID):
        return sendCommand(.togglePinned(tabID))

      case .toggleSidebarButtonTapped:
        state.isFloatingSidebarVisible = false
        state.isSidebarCollapsed.toggle()
        return .none

      case .windowActivityChanged(let activity):
        return sendCommand(.updateWindowActivity(activity))

      case .windowChanged(let windowID):
        state.windowID = windowID
        return .none
      }
    }
  }

  private func sendCommand(_ command: TerminalClient.Command) -> Effect<Action> {
    .run { [terminalClient] _ in
      await terminalClient.send(command)
    }
  }
}

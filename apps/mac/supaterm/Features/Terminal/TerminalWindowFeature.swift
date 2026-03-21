import ComposableArchitecture
import CoreGraphics
import Foundation

private enum TerminalWindowCancelID {
  static let events = "TerminalWindowFeature.events"
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
struct TerminalWindowFeature {
  @ObservableState
  struct State: Equatable {
    var confirmationRequest: ConfirmationRequest?
    var isFloatingSidebarVisible = false
    var isSidebarCollapsed = false
    var pendingCloseRequest: PendingCloseRequest?
    var pendingWorkspaceDeleteRequest: TerminalWorkspaceDeleteRequest?
    var sidebarFraction: CGFloat = 0.2
    var windowID: ObjectIdentifier?
    var workspaceRename: TerminalWorkspaceRenameState?
  }

  struct ConfirmationRequest: Equatable {
    let target: ConfirmationTarget
    let title: String
    let message: String
    let confirmTitle: String
  }

  enum ConfirmationTarget: Equatable {
    case closeAllWindows([ObjectIdentifier])
    case closeWindow(ObjectIdentifier)
    case quit
  }

  struct PendingCloseRequest: Equatable, Identifiable {
    let target: PendingCloseTarget
    let title: String
    let message: String

    var id: String {
      switch target {
      case .surface(let surfaceID):
        return "pane:\(surfaceID.uuidString)"
      case .tab(let tabID):
        return "tab:\(tabID.rawValue.uuidString)"
      }
    }
  }

  enum PendingCloseTarget: Equatable {
    case surface(UUID)
    case tab(TerminalTabID)
  }

  enum Action {
    case bindingMenuItemSelected(SupatermCommand)
    case clientEvent(TerminalClient.Event)
    case closeConfirmationCancelButtonTapped
    case closeConfirmationConfirmButtonTapped
    case closeAllWindowsRequested([ObjectIdentifier])
    case closeSurfaceRequested(UUID)
    case closeTabRequested(TerminalTabID)
    case collapseSidebarButtonTapped
    case floatingSidebarVisibilityChanged(Bool)
    case navigateSearchMenuItemSelected(GhosttySearchDirection)
    case newTabButtonTapped(inheritingFromSurfaceID: UUID?)
    case nextTabMenuItemSelected
    case pinnedTabOrderChanged([TerminalTabID])
    case previousTabMenuItemSelected
    case quitRequested(windowID: ObjectIdentifier)
    case regularTabOrderChanged([TerminalTabID])
    case selectLastTabMenuItemSelected
    case selectTabMenuItemSelected(Int)
    case selectWorkspaceButtonTapped(TerminalWorkspaceID)
    case selectWorkspaceMenuItemSelected(Int)
    case sidebarFractionChanged(CGFloat)
    case splitOperationRequested(tabID: TerminalTabID, operation: TerminalSplitTreeView.Operation)
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
    case togglePinned(TerminalTabID)
    case toggleSidebarButtonTapped
    case confirmationCancelButtonTapped
    case confirmationConfirmButtonTapped
    case windowActivityChanged(WindowActivityState)
    case windowIdentifierChanged(ObjectIdentifier)
    case windowCloseRequested(windowID: ObjectIdentifier)
  }

  @Dependency(TerminalClient.self) var terminalClient
  @Dependency(AppTerminationClient.self) var appTerminationClient
  @Dependency(TerminalWindowsClient.self) var terminalWindowsClient

  var body: some Reducer<State, Action> {
    Reduce { state, action in
      switch action {
      case .clientEvent(let event):
        switch event {
        case .closeRequested(let request):
          if request.needsConfirmation {
            state.pendingCloseRequest = pendingCloseRequest(for: request.target)
            return .none
          }
          return executeClose(for: request.target)

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

      case .bindingMenuItemSelected(let command):
        return sendCommand(.performBindingActionOnFocusedSurface(command))

      case .closeConfirmationCancelButtonTapped:
        state.pendingCloseRequest = nil
        return .none

      case .closeConfirmationConfirmButtonTapped:
        guard let pendingCloseRequest = state.pendingCloseRequest else { return .none }
        state.pendingCloseRequest = nil
        return executeClose(for: closeTarget(for: pendingCloseRequest.target))

      case .workspaceDeleteCancelButtonTapped:
        state.pendingWorkspaceDeleteRequest = nil
        return .none

      case .workspaceDeleteConfirmButtonTapped:
        guard let request = state.pendingWorkspaceDeleteRequest else { return .none }
        state.pendingWorkspaceDeleteRequest = nil
        return sendCommand(.deleteWorkspace(request.workspace.id))

      case .closeSurfaceRequested(let surfaceID):
        return sendCommand(.requestCloseSurface(surfaceID))

      case .closeTabRequested(let tabID):
        return sendCommand(.requestCloseTab(tabID))

      case .closeAllWindowsRequested(let windowIDs):
        guard !windowIDs.isEmpty else { return .none }
        state.confirmationRequest = confirmationRequest(for: .closeAllWindows(windowIDs))
        return .none

      case .collapseSidebarButtonTapped:
        state.isFloatingSidebarVisible = false
        state.isSidebarCollapsed = true
        return .none

      case .floatingSidebarVisibilityChanged(let isVisible):
        state.isFloatingSidebarVisible = isVisible
        return .none

      case .navigateSearchMenuItemSelected(let direction):
        return sendCommand(.navigateSearch(direction))

      case .newTabButtonTapped(let inheritingFromSurfaceID):
        return sendCommand(.createTab(inheritingFromSurfaceID: inheritingFromSurfaceID))

      case .nextTabMenuItemSelected:
        return sendCommand(.nextTab)

      case .pinnedTabOrderChanged(let orderedIDs):
        return sendCommand(.setPinnedTabOrder(orderedIDs))

      case .previousTabMenuItemSelected:
        return sendCommand(.previousTab)

      case .quitRequested(let windowID):
        if let currentWindowID = state.windowID, currentWindowID != windowID {
          return .none
        }
        state.confirmationRequest = confirmationRequest(for: .quit)
        return .none

      case .regularTabOrderChanged(let orderedIDs):
        return sendCommand(.setRegularTabOrder(orderedIDs))

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

      case .splitOperationRequested(let tabID, let operation):
        return sendCommand(.performSplitOperation(tabID: tabID, operation: operation))

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
          .cancellable(id: TerminalWindowCancelID.events, cancelInFlight: true)
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

      case .togglePinned(let tabID):
        return sendCommand(.togglePinned(tabID))

      case .toggleSidebarButtonTapped:
        state.isFloatingSidebarVisible = false
        state.isSidebarCollapsed.toggle()
        return .none

      case .confirmationCancelButtonTapped:
        guard let confirmationRequest = state.confirmationRequest else { return .none }
        state.confirmationRequest = nil
        switch confirmationRequest.target {
        case .quit:
          return .run { [appTerminationClient] _ in
            await appTerminationClient.reply(false)
          }
        case .closeWindow, .closeAllWindows:
          return .none
        }

      case .confirmationConfirmButtonTapped:
        guard let confirmationRequest = state.confirmationRequest else { return .none }
        state.confirmationRequest = nil
        switch confirmationRequest.target {
        case .quit:
          return .run { [appTerminationClient] _ in
            await appTerminationClient.reply(true)
          }
        case .closeWindow(let windowID):
          return .run { [terminalWindowsClient] _ in
            await terminalWindowsClient.closeWindow(windowID)
          }
        case .closeAllWindows(let windowIDs):
          return .run { [terminalWindowsClient] _ in
            await terminalWindowsClient.closeWindows(windowIDs)
          }
        }

      case .windowActivityChanged(let activity):
        return sendCommand(.updateWindowActivity(activity))

      case .windowIdentifierChanged(let windowID):
        state.windowID = windowID
        return .none

      case .windowCloseRequested(let windowID):
        if let currentWindowID = state.windowID, currentWindowID != windowID {
          return .none
        }
        state.confirmationRequest = confirmationRequest(for: .closeWindow(windowID))
        return .none
      }
    }
  }

  private func sendCommand(_ command: TerminalClient.Command) -> Effect<Action> {
    .run { [terminalClient] _ in
      await terminalClient.send(command)
    }
  }

  private func executeClose(for target: TerminalCloseTarget) -> Effect<Action> {
    switch target {
    case .surface(let surfaceID):
      return sendCommand(.closeSurface(surfaceID))
    case .tab(let tabID):
      return sendCommand(.closeTab(tabID))
    }
  }

  private func closeTarget(for target: PendingCloseTarget) -> TerminalCloseTarget {
    switch target {
    case .surface(let surfaceID):
      return .surface(surfaceID)
    case .tab(let tabID):
      return .tab(tabID)
    }
  }

  private func pendingCloseRequest(for target: TerminalCloseTarget) -> PendingCloseRequest {
    switch target {
    case .surface(let surfaceID):
      return .init(
        target: .surface(surfaceID),
        title: "Close Pane?",
        message: "A process is still running in this pane. Close it anyway?"
      )
    case .tab(let tabID):
      return .init(
        target: .tab(tabID),
        title: "Close Tab?",
        message: "A process is still running in this tab. Close it anyway?"
      )
    }
  }

  private func confirmationRequest(for target: ConfirmationTarget) -> ConfirmationRequest {
    switch target {
    case .quit:
      return .init(
        target: .quit,
        title: "Quit Supaterm?",
        message: "Are you sure you want to quit?",
        confirmTitle: "Quit"
      )
    case .closeWindow(let windowID):
      return .init(
        target: .closeWindow(windowID),
        title: "Close Window?",
        message: "A process is still running in this window. Close it anyway?",
        confirmTitle: "Close"
      )
    case .closeAllWindows(let windowIDs):
      return .init(
        target: .closeAllWindows(windowIDs),
        title: "Close All Windows?",
        message: "All terminal sessions will be terminated.",
        confirmTitle: "Close All Windows"
      )
    }
  }
}

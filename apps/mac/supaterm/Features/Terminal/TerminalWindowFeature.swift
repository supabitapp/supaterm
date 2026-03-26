import ComposableArchitecture
import CoreGraphics
import Foundation
import SupatermCLIShared

private enum TerminalWindowCancelID {
  static let events = "TerminalWindowFeature.events"
}

struct TerminalSpaceDeleteRequest: Equatable, Identifiable {
  let space: TerminalSpaceItem

  var id: TerminalSpaceID { space.id }
}

struct TerminalSpaceRenameState: Equatable, Identifiable {
  let space: TerminalSpaceItem
  var draftName: String

  var id: TerminalSpaceID { space.id }
}

@Reducer
struct TerminalWindowFeature {
  @ObservableState
  struct State: Equatable {
    var commandPalette: TerminalCommandPaletteState?
    var confirmationRequest: ConfirmationRequest?
    var isFloatingSidebarVisible = false
    var isSidebarCollapsed = false
    var pendingCloseRequest: PendingCloseRequest?
    var pendingSpaceDeleteRequest: TerminalSpaceDeleteRequest?
    var sidebarFraction: CGFloat = 0.2
    var windowID: ObjectIdentifier?
    var spaceRename: TerminalSpaceRenameState?
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
    case commandPaletteActivateSelection
    case commandPaletteCloseRequested
    case commandPaletteQueryChanged(String)
    case commandPaletteSelectionChanged(Int)
    case commandPaletteSelectionMoved(Int)
    case commandPaletteToggleRequested
    case closeConfirmationCancelButtonTapped
    case closeConfirmationConfirmButtonTapped
    case closeAllWindowsRequested([ObjectIdentifier])
    case closeSurfaceRequested(UUID)
    case closeTabRequested(TerminalTabID)
    case collapseSidebarButtonTapped
    case floatingSidebarVisibilityChanged(Bool)
    case navigateSearchMenuItemSelected(GhosttySearchDirection)
    case newTabButtonTapped(inheritingFromSurfaceID: UUID?)
    case nextSpaceRequested
    case nextTabMenuItemSelected
    case pinnedTabOrderChanged([TerminalTabID])
    case previousSpaceRequested
    case previousTabMenuItemSelected
    case regularTabOrderChanged([TerminalTabID])
    case selectLastTabMenuItemSelected
    case selectTabMenuItemSelected(Int)
    case selectSpaceButtonTapped(TerminalSpaceID)
    case selectSpaceMenuItemSelected(Int)
    case sidebarTabMoveCommitted(
      tabID: TerminalTabID,
      pinnedOrder: [TerminalTabID],
      regularOrder: [TerminalTabID]
    )
    case sidebarFractionChanged(CGFloat)
    case splitOperationRequested(tabID: TerminalTabID, operation: TerminalSplitTreeView.Operation)
    case tabSelected(TerminalTabID)
    case task
    case spaceCreateButtonTapped
    case spaceDeleteCancelButtonTapped
    case spaceDeleteConfirmButtonTapped
    case spaceDeleteRequested(TerminalSpaceItem)
    case spaceRenameCancelButtonTapped
    case spaceRenameRequested(TerminalSpaceItem)
    case spaceRenameSaveButtonTapped
    case spaceRenameTextChanged(String)
    case togglePinned(TerminalTabID)
    case toggleSidebarButtonTapped
    case confirmationCancelButtonTapped
    case confirmationConfirmButtonTapped
    case windowActivityChanged(WindowActivityState)
    case windowIdentifierChanged(ObjectIdentifier)
    case windowCloseRequested(windowID: ObjectIdentifier)
  }

  @Dependency(DesktopNotificationClient.self) var desktopNotificationClient
  @Dependency(TerminalClient.self) var terminalClient
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

        case .notificationReceived(let event):
          guard event.desktopNotificationDisposition.shouldDeliver else { return .none }
          return .run { [desktopNotificationClient] _ in
            await desktopNotificationClient.deliver(
              .init(
                body: event.body,
                subtitle: event.subtitle,
                title: event.resolvedTitle
              )
            )
          }
        }

      case .bindingMenuItemSelected(let command):
        return sendCommand(.performBindingActionOnFocusedSurface(command))

      case .commandPaletteActivateSelection:
        state.commandPalette = nil
        return .none

      case .commandPaletteCloseRequested:
        state.commandPalette = nil
        return .none

      case .commandPaletteQueryChanged(let query):
        guard state.commandPalette != nil else { return .none }
        state.commandPalette?.query = query
        state.commandPalette?.selectedIndex = 0
        return .none

      case .commandPaletteSelectionChanged(let index):
        state.commandPalette?.select(index)
        return .none

      case .commandPaletteSelectionMoved(let offset):
        state.commandPalette?.moveSelection(by: offset)
        return .none

      case .commandPaletteToggleRequested:
        if state.commandPalette == nil {
          state.commandPalette = .init()
        } else {
          state.commandPalette = nil
        }
        return .none

      case .closeConfirmationCancelButtonTapped:
        state.pendingCloseRequest = nil
        return .none

      case .closeConfirmationConfirmButtonTapped:
        guard let pendingCloseRequest = state.pendingCloseRequest else { return .none }
        state.pendingCloseRequest = nil
        return executeClose(for: closeTarget(for: pendingCloseRequest.target))

      case .spaceDeleteCancelButtonTapped:
        state.pendingSpaceDeleteRequest = nil
        return .none

      case .spaceDeleteConfirmButtonTapped:
        guard let request = state.pendingSpaceDeleteRequest else { return .none }
        state.pendingSpaceDeleteRequest = nil
        return sendCommand(.deleteSpace(request.space.id))

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

      case .nextSpaceRequested:
        return sendCommand(.nextSpace)

      case .nextTabMenuItemSelected:
        return sendCommand(.nextTab)

      case .pinnedTabOrderChanged(let orderedIDs):
        return sendCommand(.setPinnedTabOrder(orderedIDs))

      case .previousSpaceRequested:
        return sendCommand(.previousSpace)

      case .previousTabMenuItemSelected:
        return sendCommand(.previousTab)

      case .regularTabOrderChanged(let orderedIDs):
        return sendCommand(.setRegularTabOrder(orderedIDs))

      case .selectLastTabMenuItemSelected:
        return sendCommand(.selectLastTab)

      case .selectTabMenuItemSelected(let slot):
        return sendCommand(.selectTabSlot(slot))

      case .selectSpaceButtonTapped(let spaceID):
        return sendCommand(.selectSpace(spaceID))

      case .selectSpaceMenuItemSelected(let slot):
        return sendCommand(.selectSpaceSlot(slot))

      case .sidebarTabMoveCommitted(let tabID, let pinnedOrder, let regularOrder):
        return sendCommand(
          .moveSidebarTab(tabID: tabID, pinnedOrder: pinnedOrder, regularOrder: regularOrder)
        )

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

      case .spaceCreateButtonTapped:
        return sendCommand(.createSpace)

      case .spaceDeleteRequested(let space):
        state.pendingSpaceDeleteRequest = .init(space: space)
        return .none

      case .spaceRenameCancelButtonTapped:
        state.spaceRename = nil
        return .none

      case .spaceRenameRequested(let space):
        state.spaceRename = .init(space: space, draftName: space.name)
        return .none

      case .spaceRenameSaveButtonTapped:
        guard let spaceRename = state.spaceRename else { return .none }
        state.spaceRename = nil
        return sendCommand(.renameSpace(spaceRename.space.id, spaceRename.draftName))

      case .spaceRenameTextChanged(let text):
        state.spaceRename?.draftName = text
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
        case .closeWindow, .closeAllWindows:
          return .none
        }

      case .confirmationConfirmButtonTapped:
        guard let confirmationRequest = state.confirmationRequest else { return .none }
        state.confirmationRequest = nil
        switch confirmationRequest.target {
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

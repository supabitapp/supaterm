import ComposableArchitecture
import CoreGraphics
import Foundation
import Sharing
import SupatermCLIShared

private enum TerminalWindowCancelID {
  static let events = "TerminalWindowFeature.events"
}

struct TerminalSpaceDeleteRequest: Equatable, Identifiable {
  let space: TerminalSpaceItem

  var id: TerminalSpaceID { space.id }
}

enum TerminalSpaceEditorMode: Equatable {
  case create
  case rename(TerminalSpaceItem)
}

struct TerminalSpaceEditorState: Equatable, Identifiable {
  let mode: TerminalSpaceEditorMode
  var draftName: String

  var id: String {
    switch mode {
    case .create:
      return "create"
    case .rename(let space):
      return space.id.rawValue.uuidString
    }
  }

  var excludedSpaceID: TerminalSpaceID? {
    switch mode {
    case .create:
      return nil
    case .rename(let space):
      return space.id
    }
  }

  var title: String {
    switch mode {
    case .create:
      return "Create Space"
    case .rename:
      return "Rename Space"
    }
  }

  var confirmTitle: String {
    switch mode {
    case .create:
      return "Create"
    case .rename:
      return "Save"
    }
  }
}

@Reducer
struct TerminalWindowFeature {
  @ObservableState
  struct State: Equatable {
    var commandPalette: TerminalCommandPaletteState?
    var confirmationRequest: ConfirmationRequest?
    var startupInput: String?
    var isFloatingSidebarVisible = false
    var isSidebarCollapsed = false
    var pendingCloseRequest: PendingCloseRequest?
    var pendingSpaceDeleteRequest: TerminalSpaceDeleteRequest?
    var sidebarFraction: CGFloat = 0.2
    var spaceEditor: TerminalSpaceEditorState?
    var windowID: ObjectIdentifier?
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
      case .tabs(let tabIDs):
        return "tabs:\(tabIDs.map { $0.rawValue.uuidString }.joined(separator: ","))"
      }
    }
  }

  enum PendingCloseTarget: Equatable {
    case surface(UUID)
    case tab(TerminalTabID)
    case tabs([TerminalTabID])
  }

  enum Action {
    case bindingMenuItemSelected(SupatermCommand)
    case clientEvent(TerminalClient.Event)
    case commandPaletteActivateSelection
    case commandPaletteCloseRequested
    case commandPaletteQueryChanged(String)
    case commandPaletteSlotActivated(Int)
    case commandPaletteSelectionChanged(Int)
    case commandPaletteSelectionMoved(Int)
    case commandPaletteToggleRequested
    case closeConfirmationCancelButtonTapped
    case closeConfirmationConfirmButtonTapped
    case closeAllWindowsRequested([ObjectIdentifier])
    case closeOtherTabsRequested(TerminalTabID)
    case closeSurfaceRequested(UUID)
    case closeTabRequested(TerminalTabID)
    case closeTabsBelowRequested(TerminalTabID)
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
    case sidebarTabSplitRequested(surfaceID: UUID, direction: SupatermPaneDirection)
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
    case spaceEditorCancelButtonTapped
    case spaceRenameRequested(TerminalSpaceItem)
    case spaceEditorSaveButtonTapped
    case spaceEditorTextChanged(String)
    case togglePinned(TerminalTabID)
    case toggleSidebarButtonTapped
    case confirmationCancelButtonTapped
    case confirmationConfirmButtonTapped
    case windowActivityChanged(WindowActivityState)
    case windowIdentifierChanged(ObjectIdentifier)
    case windowCloseRequested(windowID: ObjectIdentifier)
  }

  @Dependency(AnalyticsClient.self) var analyticsClient
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
          @Shared(.supatermSettings) var supatermSettings = .default
          guard supatermSettings.systemNotificationsEnabled else { return .none }
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
        state.commandPalette?.updateQuery(query)
        return .none

      case .commandPaletteSlotActivated(let slot):
        guard let commandPalette = state.commandPalette else { return .none }
        let index = slot - 1
        guard commandPalette.visibleRows.indices.contains(index) else { return .none }
        state.commandPalette?.select(index)
        state.commandPalette = nil
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

      case .closeOtherTabsRequested(let tabID):
        return sendCommand(.requestCloseOtherTabs(tabID))

      case .closeSurfaceRequested(let surfaceID):
        return sendCommand(.requestCloseSurface(surfaceID))

      case .closeTabRequested(let tabID):
        return sendCommand(.requestCloseTab(tabID))

      case .closeTabsBelowRequested(let tabID):
        return sendCommand(.requestCloseTabsBelow(tabID))

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
        analyticsClient.capture("terminal_tab_created")
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

      case .sidebarTabSplitRequested(let surfaceID, let direction):
        return .run { [terminalClient] _ in
          _ = try? await terminalClient.createPane(
            .init(
              command: nil,
              direction: direction,
              focus: false,
              equalize: false,
              target: .contextPane(surfaceID)
            )
          )
        }

      case .sidebarTabMoveCommitted(let tabID, let pinnedOrder, let regularOrder):
        return sendCommand(
          .moveSidebarTab(tabID: tabID, pinnedOrder: pinnedOrder, regularOrder: regularOrder)
        )

      case .sidebarFractionChanged(let fraction):
        state.sidebarFraction = fraction
        return .none

      case .splitOperationRequested(let tabID, let operation):
        analyticsClient.capture("terminal_pane_created")
        return sendCommand(.performSplitOperation(tabID: tabID, operation: operation))

      case .tabSelected(let tabID):
        return sendCommand(.selectTab(tabID))

      case .task:
        let startupInput = state.startupInput
        state.startupInput = nil
        return .merge(
          sendCommand(
            .ensureInitialTab(
              focusing: false,
              startupInput: startupInput
            )
          ),
          .run { [terminalClient] send in
            let events = await terminalClient.events()
            for await event in events {
              await send(.clientEvent(event))
            }
          }
          .cancellable(id: TerminalWindowCancelID.events, cancelInFlight: true)
        )

      case .spaceCreateButtonTapped:
        state.spaceEditor = .init(mode: .create, draftName: "")
        return .none

      case .spaceDeleteRequested(let space):
        state.pendingSpaceDeleteRequest = .init(space: space)
        return .none

      case .spaceEditorCancelButtonTapped:
        state.spaceEditor = nil
        return .none

      case .spaceRenameRequested(let space):
        state.spaceEditor = .init(mode: .rename(space), draftName: space.name)
        return .none

      case .spaceEditorSaveButtonTapped:
        guard let spaceEditor = state.spaceEditor else { return .none }
        state.spaceEditor = nil
        switch spaceEditor.mode {
        case .create:
          analyticsClient.capture("space_created")
          return sendCommand(.createSpace(spaceEditor.draftName))
        case .rename(let space):
          return sendCommand(.renameSpace(space.id, spaceEditor.draftName))
        }

      case .spaceEditorTextChanged(let text):
        state.spaceEditor?.draftName = text
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
    case .tabs(let tabIDs):
      return sendCommand(.closeTabs(tabIDs))
    }
  }

  private func closeTarget(for target: PendingCloseTarget) -> TerminalCloseTarget {
    switch target {
    case .surface(let surfaceID):
      return .surface(surfaceID)
    case .tab(let tabID):
      return .tab(tabID)
    case .tabs(let tabIDs):
      return .tabs(tabIDs)
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
    case .tabs(let tabIDs):
      return .init(
        target: .tabs(tabIDs),
        title: "Close Tabs?",
        message: "A process is still running in one or more of these tabs. Close them anyway?"
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

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

struct TerminalSpaceRenameState: Equatable, Identifiable {
  let space: TerminalSpaceItem
  var draftName: String

  var id: TerminalSpaceID { space.id }
}

struct TerminalSidebarTabSelection: Equatable {
  var anchorTabID: TerminalTabID?
  var tabIDs: Set<TerminalTabID> = []

  mutating func prune(to visibleTabIDs: [TerminalTabID]) {
    let visibleTabIDSet = Set(visibleTabIDs)
    tabIDs = tabIDs.intersection(visibleTabIDSet)
    if let anchorTabID, !visibleTabIDSet.contains(anchorTabID) {
      self.anchorTabID = nil
    }
  }

  mutating func selectOnly(_ tabID: TerminalTabID) {
    anchorTabID = tabID
    tabIDs = [tabID]
  }
}

@Reducer
struct TerminalWindowFeature {
  @ObservableState
  struct State: Equatable {
    var commandPalette: TerminalCommandPaletteState?
    var confirmationRequest: ConfirmationRequest?
    var isFloatingSidebarVisible = false
    var isSidebarCollapsed = false
    var lastSyncedActiveSidebarTabID: TerminalTabID?
    var pendingCloseRequest: PendingCloseRequest?
    var pendingSidebarSelectionActiveTabID: TerminalTabID?
    var pendingSpaceDeleteRequest: TerminalSpaceDeleteRequest?
    var sidebarTabSelection = TerminalSidebarTabSelection()
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
    case closeTabsRequested([TerminalTabID])
    case commandPaletteActivateSelection
    case commandPaletteCloseRequested
    case commandPaletteQueryChanged(String)
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
    case sidebarTabCommandClicked(tabID: TerminalTabID, activeTabID: TerminalTabID?)
    case sidebarTabContextMenuRequested(tabID: TerminalTabID, activeTabID: TerminalTabID?)
    case sidebarTabDragStarted(TerminalTabID)
    case selectLastTabMenuItemSelected
    case selectTabMenuItemSelected(Int)
    case selectSpaceButtonTapped(TerminalSpaceID)
    case selectSpaceMenuItemSelected(Int)
    case sidebarTabRangeSelected(
      tabID: TerminalTabID,
      orderedTabIDs: [TerminalTabID],
      activeTabID: TerminalTabID?
    )
    case sidebarTabSelectionSynced(activeTabID: TerminalTabID?, visibleTabIDs: [TerminalTabID])
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
          @Shared(.appPrefs) var appPrefs = .default
          guard appPrefs.systemNotificationsEnabled else { return .none }
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

      case .closeOtherTabsRequested(let tabID):
        return sendCommand(.requestCloseOtherTabs(tabID))

      case .closeSurfaceRequested(let surfaceID):
        return sendCommand(.requestCloseSurface(surfaceID))

      case .closeTabRequested(let tabID):
        return sendCommand(.requestCloseTab(tabID))

      case .closeTabsRequested(let tabIDs):
        guard !tabIDs.isEmpty else { return .none }
        if tabIDs.count == 1, let tabID = tabIDs.first {
          return sendCommand(.requestCloseTab(tabID))
        }
        return sendCommand(.requestCloseTabs(tabIDs))

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

      case .sidebarTabCommandClicked(let tabID, let activeTabID):
        if state.sidebarTabSelection.tabIDs.contains(tabID) {
          guard tabID != activeTabID else { return .none }
          state.pendingSidebarSelectionActiveTabID = nil
          state.sidebarTabSelection.tabIDs.remove(tabID)
          if state.sidebarTabSelection.anchorTabID == tabID {
            state.sidebarTabSelection.anchorTabID = activeTabID
          }
          return .none
        }
        state.sidebarTabSelection.tabIDs.insert(tabID)
        state.sidebarTabSelection.anchorTabID = tabID
        state.pendingSidebarSelectionActiveTabID = tabID
        return sendCommand(.selectTab(tabID))

      case .sidebarTabContextMenuRequested(let tabID, let activeTabID):
        guard !state.sidebarTabSelection.tabIDs.contains(tabID) else { return .none }
        state.sidebarTabSelection.selectOnly(tabID)
        if activeTabID == tabID {
          state.pendingSidebarSelectionActiveTabID = nil
          return .none
        }
        state.pendingSidebarSelectionActiveTabID = tabID
        return sendCommand(.selectTab(tabID))

      case .sidebarTabDragStarted(let tabID):
        state.sidebarTabSelection.selectOnly(tabID)
        state.pendingSidebarSelectionActiveTabID = tabID
        return sendCommand(.selectTab(tabID))

      case .selectLastTabMenuItemSelected:
        return sendCommand(.selectLastTab)

      case .selectTabMenuItemSelected(let slot):
        return sendCommand(.selectTabSlot(slot))

      case .selectSpaceButtonTapped(let spaceID):
        return sendCommand(.selectSpace(spaceID))

      case .selectSpaceMenuItemSelected(let slot):
        return sendCommand(.selectSpaceSlot(slot))

      case .sidebarTabRangeSelected(let tabID, let orderedTabIDs, _):
        let anchorTabID = state.sidebarTabSelection.anchorTabID ?? tabID
        let tabIDs = selectedTabIDs(
          from: anchorTabID,
          to: tabID,
          in: orderedTabIDs
        )
        guard !tabIDs.isEmpty else {
          state.sidebarTabSelection.selectOnly(tabID)
          state.pendingSidebarSelectionActiveTabID = tabID
          return sendCommand(.selectTab(tabID))
        }
        state.sidebarTabSelection.anchorTabID = anchorTabID
        state.sidebarTabSelection.tabIDs = Set(tabIDs)
        state.pendingSidebarSelectionActiveTabID = tabID
        return sendCommand(.selectTab(tabID))

      case .sidebarTabSelectionSynced(let activeTabID, let visibleTabIDs):
        let previousActiveTabID = state.lastSyncedActiveSidebarTabID
        state.lastSyncedActiveSidebarTabID = activeTabID
        state.sidebarTabSelection.prune(to: visibleTabIDs)

        if state.pendingSidebarSelectionActiveTabID == activeTabID {
          state.pendingSidebarSelectionActiveTabID = nil
          guard let activeTabID else {
            state.sidebarTabSelection = .init()
            return .none
          }
          if state.sidebarTabSelection.tabIDs.isEmpty {
            state.sidebarTabSelection.selectOnly(activeTabID)
          } else {
            state.sidebarTabSelection.tabIDs.insert(activeTabID)
            if state.sidebarTabSelection.anchorTabID == nil {
              state.sidebarTabSelection.anchorTabID = activeTabID
            }
          }
          return .none
        }

        state.pendingSidebarSelectionActiveTabID = nil

        guard let activeTabID, visibleTabIDs.contains(activeTabID) else {
          state.sidebarTabSelection = .init()
          return .none
        }

        if previousActiveTabID != activeTabID
          || state.sidebarTabSelection.tabIDs.isEmpty
          || !state.sidebarTabSelection.tabIDs.contains(activeTabID)
        {
          state.sidebarTabSelection.selectOnly(activeTabID)
          return .none
        }

        if state.sidebarTabSelection.anchorTabID == nil {
          state.sidebarTabSelection.anchorTabID = activeTabID
        }
        return .none

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
        state.sidebarTabSelection.selectOnly(tabID)
        state.pendingSidebarSelectionActiveTabID = tabID
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
        analyticsClient.capture("space_created")
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

  private func selectedTabIDs(
    from anchorTabID: TerminalTabID,
    to tabID: TerminalTabID,
    in orderedTabIDs: [TerminalTabID]
  ) -> [TerminalTabID] {
    guard
      let startIndex = orderedTabIDs.firstIndex(of: anchorTabID),
      let endIndex = orderedTabIDs.firstIndex(of: tabID)
    else {
      return [tabID]
    }
    if startIndex <= endIndex {
      return Array(orderedTabIDs[startIndex...endIndex])
    }
    return Array(orderedTabIDs[endIndex...startIndex])
  }
}

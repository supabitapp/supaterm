import ComposableArchitecture
import Foundation
import SupaTheme
import SupatermCLIShared
import SupatermTerminalCore

struct TerminalNotificationEvent: Equatable, Sendable {
  let attentionState: SupatermNotificationAttentionState
  let body: String
  let desktopNotificationDisposition: SupatermDesktopNotificationDisposition
  let resolvedTitle: String
  let sourceSurfaceID: UUID
  let subtitle: String
}

enum TerminalCloseTarget: Equatable, Sendable {
  case surface(UUID)
  case tab(TerminalTabID)
  case tabs([TerminalTabID])
  case group(TerminalTabGroupID)
}

struct TerminalCloseRequest: Equatable, Sendable {
  let target: TerminalCloseTarget
  let needsConfirmation: Bool
}

struct TerminalClient: Sendable {
  var createPane: @MainActor @Sendable (TerminalCreatePaneRequest) async throws -> SupatermNewPaneResult
  var events: @MainActor @Sendable () -> AsyncStream<Event>
  var send: @MainActor @Sendable (Command) -> Void

  enum Command: Equatable, @unchecked Sendable {
    case closeSurface(UUID)
    case closeTab(TerminalTabID)
    case closeTabs([TerminalTabID])
    case closeGroup(TerminalTabGroupID)
    case createGroup(title: String, color: ThemeTint, tabIDs: [TerminalTabID])
    case createSpace(name: String, color: ThemeTint)
    case createTab(inheritingFromSurfaceID: UUID?)
    case createTabInGroup(TerminalTabGroupID, inheritingFromSurfaceID: UUID?)
    case createTabInSpace(TerminalSpaceID)
    case deleteSpace(TerminalSpaceID)
    case navigateSearch(GhosttySearchDirection)
    case move(TerminalTabMoveRequest)
    case nextSpace
    case nextTab
    case performGhosttyBindingActionOnFocusedSurface(String)
    case performBindingActionOnFocusedSurface(SupatermCommand)
    case performSplitOperation(tabID: TerminalTabID, operation: TerminalSplitTreeView.Operation)
    case previousSpace
    case previousTab
    case requestCloseSurface(UUID)
    case requestCloseTab(TerminalTabID)
    case requestCloseTabs([TerminalTabID])
    case requestCloseTabsBelow(TerminalTabID)
    case requestCloseOtherTabs([TerminalTabID])
    case requestCloseGroup(TerminalTabGroupID)
    case removeTabFromGroup(TerminalTabID)
    case renameSpace(TerminalSpaceID, String)
    case selectLastTab
    case selectTab(TerminalTabID)
    case selectTabSlot(Int)
    case selectSpaceSlot(Int)
    case selectSpace(TerminalSpaceID)
    case renameGroup(TerminalTabGroupID, String)
    case sessionDidChange
    case setGroupColor(TerminalTabGroupID, ThemeTint)
    case setSpaceColor(TerminalSpaceID, ThemeTint)
    case toggleGroupCollapsed(TerminalTabGroupID)
    case togglePinned(TerminalTabID)
    case togglePinnedRootItem(TerminalTabRootItemID)
    case ungroup(TerminalTabGroupID)
    case updateWindowActivity(WindowActivityState)
  }

  enum Event: Equatable, Sendable {
    case commandPaletteToggleRequested
    case closeRequested(TerminalCloseRequest)
    case gotoTabRequested(TerminalGotoTabTarget)
    case newTabRequested(inheritingFromSurfaceID: UUID?)
    case notificationReceived(TerminalNotificationEvent)
    case windowCloseRequested(needsConfirmation: Bool)
  }

  static func live(host: TerminalHostState) -> Self {
    Self(
      createPane: { request in
        try host.createPane(request)
      },
      events: {
        host.eventStream()
      },
      send: { command in
        host.handleCommand(command)
      }
    )
  }
}

enum TerminalGotoTabTarget: Equatable, Sendable {
  case index(Int)
  case last
  case next
  case previous
}

extension TerminalClient: DependencyKey {
  static let liveValue = unimplementedValue()

  static let testValue = unimplementedValue()

  private static func unimplementedValue() -> Self {
    Self(
      createPane: unimplemented("TerminalClient.createPane"),
      events: unimplemented(
        "TerminalClient.events",
        placeholder: AsyncStream { $0.finish() }
      ),
      send: unimplemented("TerminalClient.send")
    )
  }
}

extension DependencyValues {
  var terminalClient: TerminalClient {
    get { self[TerminalClient.self] }
    set { self[TerminalClient.self] = newValue }
  }
}

import ComposableArchitecture
import Foundation
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
}

struct TerminalCloseRequest: Equatable, Sendable {
  let target: TerminalCloseTarget
  let needsConfirmation: Bool
}

struct TerminalClient: Sendable {
  var commandPaletteSnapshot: @MainActor @Sendable () -> TerminalCommandPaletteSnapshot
  var createPane: @MainActor @Sendable (TerminalCreatePaneRequest) async throws -> SupatermNewPaneResult
  var events: @MainActor @Sendable () -> AsyncStream<Event>
  var send: @MainActor @Sendable (Command) -> Void
  var treeSnapshot: @MainActor @Sendable () async -> SupatermTreeSnapshot

  enum Command: Equatable, @unchecked Sendable {
    case closeSurface(UUID)
    case closeTab(TerminalTabID)
    case closeTabs([TerminalTabID])
    case createSpace(String)
    case createTab(inheritingFromSurfaceID: UUID?)
    case deleteSpace(TerminalSpaceID)
    case ensureInitialTab(focusing: Bool, startupInput: String?)
    case navigateSearch(GhosttySearchDirection)
    case moveSidebarTab(
      tabID: TerminalTabID, pinnedOrder: [TerminalTabID], regularOrder: [TerminalTabID])
    case nextSpace
    case nextTab
    case performGhosttyBindingActionOnFocusedSurface(String)
    case performBindingActionOnFocusedSurface(SupatermCommand)
    case performSplitOperation(tabID: TerminalTabID, operation: TerminalSplitTreeView.Operation)
    case previousSpace
    case previousTab
    case requestCloseSurface(UUID)
    case requestCloseTab(TerminalTabID)
    case requestCloseTabsBelow(TerminalTabID)
    case requestCloseOtherTabs(TerminalTabID)
    case renameSpace(TerminalSpaceID, String)
    case selectLastTab
    case selectTab(TerminalTabID)
    case selectTabSlot(Int)
    case selectSpaceSlot(Int)
    case selectSpace(TerminalSpaceID)
    case setPinnedTabOrder([TerminalTabID])
    case setRegularTabOrder([TerminalTabID])
    case togglePinned(TerminalTabID)
    case updateWindowActivity(WindowActivityState)
  }

  enum Event: Equatable, Sendable {
    case commandPaletteToggleRequested
    case closeRequested(TerminalCloseRequest)
    case gotoTabRequested(TerminalGotoTabTarget)
    case newTabRequested(inheritingFromSurfaceID: UUID?)
    case notificationReceived(TerminalNotificationEvent)
  }

  static func live(host: TerminalHostState) -> Self {
    Self(
      commandPaletteSnapshot: {
        host.commandPaletteSnapshot
      },
      createPane: { request in
        try host.createPane(request)
      },
      events: {
        host.eventStream()
      },
      send: { command in
        host.handleCommand(command)
      },
      treeSnapshot: {
        host.treeSnapshot()
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
  static let liveValue = Self(
    commandPaletteSnapshot: { .empty },
    createPane: { _ in
      throw TerminalCreatePaneError.creationFailed
    },
    events: { AsyncStream { $0.finish() } },
    send: { _ in },
    treeSnapshot: { .init(windows: []) }
  )

  static let testValue = Self(
    commandPaletteSnapshot: { .empty },
    createPane: { _ in
      throw TerminalCreatePaneError.creationFailed
    },
    events: { AsyncStream { $0.finish() } },
    send: { _ in },
    treeSnapshot: { .init(windows: []) }
  )
}

extension DependencyValues {
  var terminalClient: TerminalClient {
    get { self[TerminalClient.self] }
    set { self[TerminalClient.self] = newValue }
  }
}

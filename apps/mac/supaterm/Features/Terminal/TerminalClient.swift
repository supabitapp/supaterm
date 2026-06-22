import ComposableArchitecture
import Foundation
import SupatermCLIShared
import SupatermGhosttyFeature
import SupatermTerminalCore
import SupatermTerminalModels

public struct TerminalNotificationEvent: Equatable, Sendable {
  public let attentionState: SupatermNotificationAttentionState
  public let body: String
  public let desktopNotificationDisposition: SupatermDesktopNotificationDisposition
  public let resolvedTitle: String
  public let sourceSurfaceID: UUID
  public let subtitle: String
}

public enum TerminalCloseTarget: Equatable, Sendable {
  case surface(UUID)
  case tab(TerminalTabID)
  case tabs([TerminalTabID])
}

public struct TerminalCloseRequest: Equatable, Sendable {
  public let target: TerminalCloseTarget
  public let needsConfirmation: Bool
}

public struct TerminalClient: Sendable {
  var createPane: @MainActor @Sendable (TerminalCreatePaneRequest) async throws -> SupatermNewPaneResult
  var events: @MainActor @Sendable () -> AsyncStream<Event>
  var send: @MainActor @Sendable (Command) -> Void

  init(
    createPane: @escaping @MainActor @Sendable (TerminalCreatePaneRequest) async throws -> SupatermNewPaneResult,
    events: @escaping @MainActor @Sendable () -> AsyncStream<Event>,
    send: @escaping @MainActor @Sendable (Command) -> Void
  ) {
    self.createPane = createPane
    self.events = events
    self.send = send
  }

  enum Command: Equatable, @unchecked Sendable {
    case closeSurface(UUID)
    case closeTab(TerminalTabID)
    case closeTabs([TerminalTabID])
    case createSpace(String)
    case createTab(inheritingFromSurfaceID: UUID?)
    case deleteSpace(TerminalSpaceID)
    case ensureInitialTab(focusing: Bool, startupCommand: String?, workingDirectoryPath: String? = nil)
    case navigateSearch(GhosttySearchDirection)
    case moveSidebarTab(
      tabID: TerminalTabID, pinnedOrder: [TerminalTabID], regularOrder: [TerminalTabID])
    case nextSpace
    case nextTab
    case performGhosttyBindingActionOnFocusedSurface(String)
    case performBindingActionOnFocusedSurface(SupatermCommand)
    case performSplitOperation(tabID: TerminalTabID, operation: TerminalWindowSplitOperation)
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

  public enum Event: Equatable, Sendable {
    case commandPaletteToggleRequested
    case closeRequested(TerminalCloseRequest)
    case gotoTabRequested(TerminalGotoTabTarget)
    case newTabRequested(inheritingFromSurfaceID: UUID?)
    case notificationReceived(TerminalNotificationEvent)
    case windowCloseRequested(needsConfirmation: Bool)
  }

  public static func live(host: TerminalHostState) -> Self {
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

public enum TerminalGotoTabTarget: Equatable, Sendable {
  case index(Int)
  case last
  case next
  case previous
}

extension TerminalClient: DependencyKey {
  public static let liveValue = Self(
    createPane: { _ in
      throw TerminalCreatePaneError.creationFailed
    },
    events: { AsyncStream { $0.finish() } },
    send: { _ in }
  )

  public static let testValue = Self(
    createPane: { _ in
      throw TerminalCreatePaneError.creationFailed
    },
    events: { AsyncStream { $0.finish() } },
    send: { _ in }
  )
}

extension DependencyValues {
  public var terminalClient: TerminalClient {
    get { self[TerminalClient.self] }
    set { self[TerminalClient.self] = newValue }
  }
}

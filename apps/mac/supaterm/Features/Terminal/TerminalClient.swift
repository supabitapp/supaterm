import ComposableArchitecture
import Foundation
import SupatermCLIShared

struct TerminalCreateTabRequest: Equatable, Sendable {
  enum Target: Equatable, Sendable {
    case contextPane(UUID)
    case space(windowIndex: Int, spaceIndex: Int)
  }

  let command: String?
  let cwd: String?
  let focus: Bool
  let target: Target
}

struct TerminalCreatePaneRequest: Equatable, Sendable {
  enum Target: Equatable, Sendable {
    case contextPane(UUID)
    case pane(windowIndex: Int, spaceIndex: Int, tabIndex: Int, paneIndex: Int)
    case tab(windowIndex: Int, spaceIndex: Int, tabIndex: Int)
  }

  let command: String?
  let direction: SupatermPaneDirection
  let focus: Bool
  let equalize: Bool
  let target: Target
}

struct TerminalNotifyRequest: Equatable, Sendable {
  enum Target: Equatable, Sendable {
    case contextPane(UUID)
    case pane(windowIndex: Int, spaceIndex: Int, tabIndex: Int, paneIndex: Int)
    case tab(windowIndex: Int, spaceIndex: Int, tabIndex: Int)
  }

  let allowDesktopNotificationWhenAgentActive: Bool
  let body: String
  let subtitle: String
  let target: Target
  let title: String?

  init(
    body: String,
    subtitle: String,
    target: Target,
    title: String?,
    allowDesktopNotificationWhenAgentActive: Bool = false
  ) {
    self.allowDesktopNotificationWhenAgentActive = allowDesktopNotificationWhenAgentActive
    self.body = body
    self.subtitle = subtitle
    self.target = target
    self.title = title
  }
}

struct TerminalNotificationEvent: Equatable, Sendable {
  let attentionState: SupatermNotificationAttentionState
  let body: String
  let desktopNotificationDisposition: SupatermDesktopNotificationDisposition
  let resolvedTitle: String
  let sourceSurfaceID: UUID
  let subtitle: String
}

struct TerminalAgentHookResult: Equatable, Sendable {
  let desktopNotification: DesktopNotificationRequest?
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

enum TerminalCreatePaneError: Error, Equatable {
  case contextPaneNotFound
  case creationFailed
  case paneNotFound(windowIndex: Int, spaceIndex: Int, tabIndex: Int, paneIndex: Int)
  case spaceNotFound(windowIndex: Int, spaceIndex: Int)
  case tabNotFound(windowIndex: Int, spaceIndex: Int, tabIndex: Int)
  case windowNotFound(Int)
}

enum TerminalCreateTabError: Error, Equatable {
  case contextPaneNotFound
  case creationFailed
  case spaceNotFound(windowIndex: Int, spaceIndex: Int)
  case windowNotFound(Int)
}

struct TerminalClient: Sendable {
  var createPane: @MainActor @Sendable (TerminalCreatePaneRequest) async throws -> SupatermNewPaneResult
  var events: @MainActor @Sendable () -> AsyncStream<Event>
  var send: @MainActor @Sendable (Command) -> Void
  var treeSnapshot: @MainActor @Sendable () async -> SupatermTreeSnapshot

  enum Command: Equatable, @unchecked Sendable {
    case closeSurface(UUID)
    case closeTab(TerminalTabID)
    case closeTabs([TerminalTabID])
    case createSpace
    case createTab(inheritingFromSurfaceID: UUID?)
    case deleteSpace(TerminalSpaceID)
    case ensureInitialTab(focusing: Bool)
    case navigateSearch(GhosttySearchDirection)
    case moveSidebarTab(tabID: TerminalTabID, pinnedOrder: [TerminalTabID], regularOrder: [TerminalTabID])
    case nextSpace
    case nextTab
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
    case closeRequested(TerminalCloseRequest)
    case gotoTabRequested(TerminalGotoTabTarget)
    case newTabRequested(inheritingFromSurfaceID: UUID?)
    case notificationReceived(TerminalNotificationEvent)
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
    createPane: { _ in
      throw TerminalCreatePaneError.creationFailed
    },
    events: { AsyncStream { $0.finish() } },
    send: { _ in },
    treeSnapshot: { .init(windows: []) }
  )

  static let testValue = Self(
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

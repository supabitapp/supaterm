import ComposableArchitecture
import Foundation
import SupatermCLIShared

struct TerminalCreatePaneRequest: Equatable, Sendable {
  enum Target: Equatable, Sendable {
    case contextPane(UUID)
    case pane(windowIndex: Int, tabIndex: Int, paneIndex: Int)
    case tab(windowIndex: Int, tabIndex: Int)
  }

  let command: String?
  let direction: SupatermPaneDirection
  let focus: Bool
  let target: Target
}

enum TerminalCreatePaneError: Error, Equatable {
  case contextPaneNotFound
  case creationFailed
  case paneNotFound(windowIndex: Int, tabIndex: Int, paneIndex: Int)
  case tabNotFound(windowIndex: Int, tabIndex: Int)
  case windowNotFound(Int)
}

struct TerminalClient: Sendable {
  var createPane: @MainActor @Sendable (TerminalCreatePaneRequest) async throws -> SupatermNewPaneResult
  var events: @MainActor @Sendable () -> AsyncStream<Event>
  var send: @MainActor @Sendable (Command) -> Void
  var tabNeedsCloseConfirmation: @MainActor @Sendable (TerminalTabID) -> Bool
  var treeSnapshot: @MainActor @Sendable () async -> SupatermTreeSnapshot

  enum Command: Equatable, @unchecked Sendable {
    case closeSurface(UUID)
    case closeTab(TerminalTabID)
    case createTab(inheritingFromSurfaceID: UUID?)
    case ensureInitialTab(focusing: Bool)
    case navigateSearch(GhosttySearchDirection)
    case nextTab
    case performBindingActionOnFocusedSurface(String)
    case performSplitOperation(tabID: TerminalTabID, operation: TerminalSplitTreeView.Operation)
    case previousTab
    case selectLastTab
    case selectTab(TerminalTabID)
    case selectTabSlot(Int)
    case setPinnedTabOrder([TerminalTabID])
    case setRegularTabOrder([TerminalTabID])
    case togglePinned(TerminalTabID)
    case updateWindowActivity(WindowActivityState)
  }

  enum Event: Equatable, Sendable {
    case closeSurfaceRequested(surfaceID: UUID, processAlive: Bool)
    case closeTabRequested(TerminalTabID)
    case gotoTabRequested(TerminalGotoTabTarget)
    case newTabRequested(inheritingFromSurfaceID: UUID?)
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
      tabNeedsCloseConfirmation: { tabID in
        host.tabNeedsCloseConfirmation(tabID)
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
    tabNeedsCloseConfirmation: { _ in false },
    treeSnapshot: { .init(windows: []) }
  )

  static let testValue = Self(
    createPane: { _ in
      throw TerminalCreatePaneError.creationFailed
    },
    events: { AsyncStream { $0.finish() } },
    send: { _ in },
    tabNeedsCloseConfirmation: { _ in false },
    treeSnapshot: { .init(windows: []) }
  )
}

extension DependencyValues {
  var terminalClient: TerminalClient {
    get { self[TerminalClient.self] }
    set { self[TerminalClient.self] = newValue }
  }
}

import ComposableArchitecture
import Foundation

struct TerminalClient: Sendable {
  var events: @MainActor @Sendable () -> AsyncStream<Event>
  var send: @MainActor @Sendable (Command) -> Void
  var tabNeedsCloseConfirmation: @MainActor @Sendable (TerminalTabID) -> Bool

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
      events: {
        host.eventStream()
      },
      send: { command in
        host.handleCommand(command)
      },
      tabNeedsCloseConfirmation: { tabID in
        host.tabNeedsCloseConfirmation(tabID)
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
    events: { AsyncStream { $0.finish() } },
    send: { _ in },
    tabNeedsCloseConfirmation: { _ in false }
  )

  static let testValue = Self(
    events: { AsyncStream { $0.finish() } },
    send: { _ in },
    tabNeedsCloseConfirmation: { _ in false }
  )
}

extension DependencyValues {
  var terminalClient: TerminalClient {
    get { self[TerminalClient.self] }
    set { self[TerminalClient.self] = newValue }
  }
}

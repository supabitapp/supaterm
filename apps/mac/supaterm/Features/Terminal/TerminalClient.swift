import ComposableArchitecture
import Foundation
import SupatermCLIShared

struct TerminalNotificationEvent: Equatable, Sendable {
  let attentionState: SupatermNotificationAttentionState
  let body: String
  let notificationDisposition: SupatermNotificationDisposition
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
  var events: @MainActor @Sendable () -> AsyncStream<Event>
  var host: @MainActor @Sendable () -> TerminalHostState

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
      events: {
        host.eventStream()
      },
      host: { host }
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
      events: unimplemented(
        "TerminalClient.events",
        placeholder: AsyncStream { $0.finish() }
      ),
      host: { fatalError("TerminalClient.host is unimplemented") }
    )
  }
}

extension DependencyValues {
  var terminalClient: TerminalClient {
    get { self[TerminalClient.self] }
    set { self[TerminalClient.self] = newValue }
  }
}

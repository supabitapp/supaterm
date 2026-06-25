import AppKit
import SupatermTerminalModels

enum SessionPersistenceState: Equatable {
  case active
  case restoring
  case quitting(TerminalSessionCatalog)
  case quittingAfterSessionTermination

  var allowsLiveSave: Bool {
    self == .active
  }

  var shortCircuitsTerminateReply: Bool {
    self == .quittingAfterSessionTermination
  }

  func catalogToPersist(liveCatalog: TerminalSessionCatalog) -> TerminalSessionCatalog {
    switch self {
    case .active, .restoring:
      return liveCatalog
    case .quitting(let catalog):
      return catalog
    case .quittingAfterSessionTermination:
      return .default
    }
  }

  static func afterTerminationDecision(
    reply: NSApplication.TerminateReply,
    terminatesSessions: Bool,
    liveCatalog: TerminalSessionCatalog
  ) -> Self {
    guard reply == .terminateNow else { return .active }
    return terminatesSessions ? .quittingAfterSessionTermination : .quitting(liveCatalog)
  }
}

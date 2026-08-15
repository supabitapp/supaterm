import SupatermCLIShared

nonisolated enum TerminalPanePresentation: Equatable, Sendable {
  case attaching
  case interrupted
  case failed(String)
  case exited(SupatermHostProcessExit)
  case unavailable

  init(status: SupatermHostTerminalStatus?) {
    guard let status else {
      self = .unavailable
      return
    }

    switch status {
    case .starting, .running, .exiting:
      self = .attaching
    case .interrupted:
      self = .interrupted
    case .failed(let message):
      self = .failed(message)
    case .exited(let exit):
      self = .exited(exit)
    }
  }
}

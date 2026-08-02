enum GhosttySearchDirection: Equatable, Sendable {
  case next
  case previous

  var command: SupatermCommand {
    switch self {
    case .next:
      return .navigateSearch(.next)
    case .previous:
      return .navigateSearch(.previous)
    }
  }
}

extension GhosttySurfaceView {
  func navigateSearch(_ direction: GhosttySearchDirection) {
    performBindingAction(direction.command.ghosttyBindingAction)
  }
}

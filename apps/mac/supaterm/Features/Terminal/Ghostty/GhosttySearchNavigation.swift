enum GhosttySearchDirection: Equatable, Sendable {
  case next
  case previous

  var bindingAction: String {
    switch self {
    case .next:
      return "navigate_search:next"
    case .previous:
      return "navigate_search:previous"
    }
  }
}

extension GhosttySurfaceView {
  func navigateSearch(_ direction: GhosttySearchDirection) {
    performBindingAction(direction.bindingAction)
  }
}

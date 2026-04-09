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

  var oppositeCommand: SupatermCommand {
    switch self {
    case .next:
      return .navigateSearch(.previous)
    case .previous:
      return .navigateSearch(.next)
    }
  }
}

enum GhosttySearchNavigator {
  static func commands(
    direction: GhosttySearchDirection,
    selected: Int?,
    total: Int?
  ) -> [SupatermCommand] {
    let directCommand = direction.command
    guard let total, let selected, total > 1, selected >= 0, selected < total else {
      return [directCommand]
    }

    switch direction {
    case .next where selected == total - 1:
      return Array(repeating: direction.oppositeCommand, count: total - 1)
    case .previous where selected == 0:
      return Array(repeating: direction.oppositeCommand, count: total - 1)
    default:
      return [directCommand]
    }
  }
}

extension GhosttySurfaceView {
  func navigateSearch(_ direction: GhosttySearchDirection) {
    let commands = GhosttySearchNavigator.commands(
      direction: direction,
      selected: bridge.state.searchSelected,
      total: bridge.state.searchTotal
    )
    for command in commands {
      performBindingAction(command.ghosttyBindingAction)
    }
  }
}

enum TerminalSidebarDragTargetEvent: Equatable {
  case accepted(TerminalSidebarDropPlan)
  case rejected
  case miss
  case ended

  init(_ resolution: TerminalSidebarDropResolution) {
    if let plan = resolution.plan {
      self = .accepted(plan)
    } else if resolution.path != nil {
      self = .rejected
    } else {
      self = .miss
    }
  }
}

struct TerminalSidebarDragTargetDecision: Equatable {
  enum TargetChange: Equatable {
    case retain
    case unchanged
    case update(TerminalSidebarDropPlan)
    case clear
  }

  enum HapticChange: Equatable {
    case none
    case update(TerminalSidebarSemanticPath)
    case reset
  }

  let target: TargetChange
  let haptic: HapticChange
}

enum TerminalSidebarDragTargetState: Equatable {
  case none
  case retained(TerminalSidebarDropPlan)
  case accepted(TerminalSidebarDropPlan)

  var plan: TerminalSidebarDropPlan? {
    switch self {
    case .none: nil
    case .retained(let plan), .accepted(let plan): plan
    }
  }

  var acceptsDrop: Bool {
    if case .accepted = self { return true }
    return false
  }

  @discardableResult
  mutating func transition(_ event: TerminalSidebarDragTargetEvent)
    -> TerminalSidebarDragTargetDecision
  {
    let current = plan
    switch event {
    case .accepted(let plan):
      self = .accepted(plan)
      guard current != plan else {
        return TerminalSidebarDragTargetDecision(target: .unchanged, haptic: .none)
      }
      return TerminalSidebarDragTargetDecision(
        target: .update(plan),
        haptic: current?.path == plan.path ? .none : .update(plan.path)
      )
    case .rejected, .miss:
      self = current.map(Self.retained) ?? .none
      return TerminalSidebarDragTargetDecision(target: .retain, haptic: .none)
    case .ended:
      self = .none
      return TerminalSidebarDragTargetDecision(target: .clear, haptic: .reset)
    }
  }
}

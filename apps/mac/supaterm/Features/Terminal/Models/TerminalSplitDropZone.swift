import CoreGraphics

nonisolated enum TerminalSplitDropZone: String, CaseIterable, Equatable, Sendable {
  case top
  case bottom
  case left
  case right

  static func calculate(at point: CGPoint, in size: CGSize) -> Self {
    guard size.width > 0, size.height > 0 else { return .left }
    let relativeX = point.x / size.width
    let relativeY = point.y / size.height
    let left = relativeX
    let right = 1 - relativeX
    let top = relativeY
    let bottom = 1 - relativeY
    let minimum = min(left, right, top, bottom)
    if minimum == left { return .left }
    if minimum == right { return .right }
    if minimum == top { return .top }
    return .bottom
  }

  var isHorizontal: Bool {
    self == .left || self == .right
  }

  var isAfter: Bool {
    self == .right || self == .bottom
  }

  var opposite: Self {
    switch self {
    case .top:
      .bottom
    case .bottom:
      .top
    case .left:
      .right
    case .right:
      .left
    }
  }
}

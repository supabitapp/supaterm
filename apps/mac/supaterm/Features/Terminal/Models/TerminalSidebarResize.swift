import CoreGraphics

struct TerminalSidebarResizeState: Equatable {
  let startingWidth: CGFloat
  var delta: CGFloat
}

enum TerminalSidebarResizeInput: Equatable {
  case began
  case changed(delta: CGFloat)
  case ended
  case failed
  case reset
}

enum TerminalSidebarWidthPolicy {
  static let accessibilityStep: CGFloat = 16
  static let defaultFraction: CGFloat = 0.2
  static let interactionStripWidth: CGFloat = 8
  static let maximumFraction: CGFloat = 0.3
  static let minimumFraction: CGFloat = 0.1

  static func defaultWidth(for totalWidth: CGFloat) -> CGFloat {
    Swift.max(totalWidth, 0) * defaultFraction
  }

  static func resolvedWidth(preferredWidth: CGFloat?, totalWidth: CGFloat) -> CGFloat {
    settledWidth(for: preferredWidth ?? defaultWidth(for: totalWidth), totalWidth: totalWidth)
  }

  static func displayedWidth(
    preferredWidth: CGFloat?,
    resizeState: TerminalSidebarResizeState?,
    totalWidth: CGFloat
  ) -> CGFloat {
    guard let resizeState else {
      return resolvedWidth(preferredWidth: preferredWidth, totalWidth: totalWidth)
    }
    return settledWidth(for: resizeState, totalWidth: totalWidth)
  }

  static func resizeState(
    preferredWidth: CGFloat?,
    totalWidth: CGFloat
  ) -> TerminalSidebarResizeState {
    TerminalSidebarResizeState(
      startingWidth: resolvedWidth(preferredWidth: preferredWidth, totalWidth: totalWidth),
      delta: 0
    )
  }

  static func shouldCollapse(
    resizeState: TerminalSidebarResizeState,
    totalWidth: CGFloat
  ) -> Bool {
    resizeState.startingWidth + resizeState.delta <= widthRange(for: totalWidth).lowerBound
  }

  static func settledWidth(
    for resizeState: TerminalSidebarResizeState,
    totalWidth: CGFloat
  ) -> CGFloat {
    settledWidth(for: resizeState.startingWidth + resizeState.delta, totalWidth: totalWidth)
  }

  static func settledWidth(for width: CGFloat, totalWidth: CGFloat) -> CGFloat {
    let range = widthRange(for: totalWidth)
    return Swift.min(Swift.max(width, range.lowerBound), range.upperBound)
  }

  static func widthRange(for totalWidth: CGFloat) -> ClosedRange<CGFloat> {
    let totalWidth = Swift.max(totalWidth, 0)
    return (totalWidth * minimumFraction)...(totalWidth * maximumFraction)
  }
}

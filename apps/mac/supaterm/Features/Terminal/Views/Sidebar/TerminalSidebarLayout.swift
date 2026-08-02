import CoreGraphics

enum TerminalSidebarLayout {
  struct HorizontalInsets {
    let leading: CGFloat
    let trailing: CGFloat

    func width(in containerWidth: CGFloat) -> CGFloat {
      max(1, containerWidth - leading - trailing)
    }

    func frame(in bounds: CGRect) -> CGRect {
      CGRect(
        x: bounds.minX + leading,
        y: bounds.minY,
        width: width(in: bounds.width),
        height: bounds.height
      )
    }
  }

  static let tabRowCornerRadius: CGFloat = 8
  static let tabRowMinHeight: CGFloat = 30
  static let tabTrailingAccessorySize: CGFloat = 24
  static let rowHorizontalPadding: CGFloat = 10
  static let visibleHorizontalInset: CGFloat = 10
  static let groupedTabIndent: CGFloat = 6
  static var cardHorizontalInsets: HorizontalInsets {
    HorizontalInsets(
      leading: visibleHorizontalInset,
      trailing: visibleHorizontalInset
    )
  }
  static let tabRowVerticalPadding: CGFloat = 5
  static let tabRowSpacing: CGFloat = 2
  static let cardCornerRadius: CGFloat = 12
  static let cardMinHeight: CGFloat = 36
  static let cardVerticalPadding: CGFloat = 8
  static let groupSurfaceOverflow: CGFloat = 2
  static let trafficLightGap: CGFloat = 6

  static func tabContentHorizontalInsets(isGrouped: Bool) -> HorizontalInsets {
    HorizontalInsets(
      leading: rowHorizontalPadding + (isGrouped ? groupedTabIndent : 0),
      trailing: rowHorizontalPadding
    )
  }

  static func tabSurfaceHorizontalInsets(isGrouped: Bool) -> HorizontalInsets {
    guard isGrouped else { return HorizontalInsets(leading: 0, trailing: 0) }
    return HorizontalInsets(
      leading: groupedTabIndent,
      trailing: groupSurfaceOverflow
    )
  }

  static func tabSurfaceFrame(in bounds: CGRect, isGrouped: Bool) -> CGRect {
    tabSurfaceHorizontalInsets(isGrouped: isGrouped).frame(in: bounds)
  }

  static var scrollViewportTopInset: CGFloat {
    WindowTrafficLightMetrics.edgePadding
      + WindowTrafficLightMetrics.buttonSize
      + trafficLightGap
  }

  static func scrollViewportFrame(in bounds: CGRect) -> CGRect {
    CGRect(
      x: bounds.minX,
      y: bounds.minY,
      width: bounds.width,
      height: max(0, bounds.height - scrollViewportTopInset)
    )
  }
}

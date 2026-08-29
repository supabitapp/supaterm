import CoreGraphics

struct TerminalSidebarViewportLayout: Equatable {
  let scrollViewportFrame: CGRect
  let pinnedControlFrame: CGRect

  init(bounds: CGRect, pinnedControlHeight: CGFloat) {
    let scrollTop = bounds.maxY - TerminalSidebarLayout.scrollViewportTopInset
    let controlHeight = min(max(0, pinnedControlHeight), max(0, scrollTop - bounds.minY))
    pinnedControlFrame = CGRect(
      x: bounds.minX,
      y: bounds.minY,
      width: bounds.width,
      height: controlHeight
    )
    scrollViewportFrame = CGRect(
      x: bounds.minX,
      y: pinnedControlFrame.maxY,
      width: bounds.width,
      height: max(0, scrollTop - pinnedControlFrame.maxY)
    )
  }
}

enum TerminalSidebarNewTabPlacement {
  static let visibilityThreshold: CGFloat = 3

  static func shouldPin(
    itemFrame: CGRect?,
    visibleRect: CGRect,
    pinnedHeight: CGFloat,
    isPinned: Bool
  ) -> Bool {
    guard let itemFrame, !itemFrame.isEmpty, !visibleRect.isEmpty else { return false }
    let availableMaxY = visibleRect.maxY + (isPinned ? pinnedHeight : 0)
    return itemFrame.maxY >= availableMaxY - visibilityThreshold
  }
}

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

  static let tabRowCornerRadius: CGFloat = 10
  static let tabRowMinHeight: CGFloat = 30
  static let tabAgentStatusTextMinimumWidth: CGFloat = 240
  static let tabPaneLineHeight: CGFloat = 18
  static let tabPaneLineSpacing: CGFloat = 2
  static let tabTrailingAccessorySize: CGFloat = 24
  static let rowHorizontalPadding: CGFloat = 10
  static let visibleHorizontalInset: CGFloat = 6
  static let groupedTabIndent: CGFloat = 6
  static var cardHorizontalInsets: HorizontalInsets {
    HorizontalInsets(
      leading: visibleHorizontalInset,
      trailing: visibleHorizontalInset
    )
  }
  static let tabRowVerticalPadding: CGFloat = 5
  static let tabRowSpacing: CGFloat = 2
  static let newTabRowHeight: CGFloat = 37
  static let pinnedControlHeight: CGFloat = 40
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

}

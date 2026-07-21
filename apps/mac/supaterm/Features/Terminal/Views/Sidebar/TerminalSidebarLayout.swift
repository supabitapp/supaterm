import CoreGraphics
import Foundation

enum TerminalSidebarLayout {
  static let groupCornerRadius: CGFloat = 12
  static let tabRowCornerRadius: CGFloat = 8
  static let tabRowMinHeight: CGFloat = 30
  static let rowHorizontalPadding: CGFloat = 10
  static let tabRowVerticalPadding: CGFloat = 5
  static let tabRowSpacing: CGFloat = 2
  static let cardCornerRadius: CGFloat = 12
  static let cardMinHeight: CGFloat = 36
  static let cardVerticalPadding: CGFloat = 8
  static let trafficLightTopPadding: CGFloat = 6

  static var firstVisibleSectionTopInset: CGFloat {
    trafficLightTopPadding + WindowTrafficLightMetrics.topPadding + WindowTrafficLightMetrics.buttonSize + 4
  }

  static func spaceMonogram(
    for name: String,
    fallbackIndex: Int
  ) -> String {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    if let first = trimmed.first {
      return String(first).uppercased()
    }
    return String(fallbackIndex + 1)
  }

  static func showsSpaceList(
    spacesCount: Int
  ) -> Bool {
    spacesCount > 1
  }

}

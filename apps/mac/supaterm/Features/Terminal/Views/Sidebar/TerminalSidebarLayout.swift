import CoreGraphics
import Foundation

enum TerminalSidebarDropZoneID: Hashable {
  case pinned
  case regular
}

enum TerminalSidebarSpaceBarLayoutMode: Equatable {
  case normal
  case compact

  static func determine(
    spaceCount: Int,
    availableWidth: CGFloat
  ) -> Self {
    guard spaceCount > 0 else { return .normal }

    let badgeSide: CGFloat = 32
    let minSpacing: CGFloat = 4
    let dotSide: CGFloat = 6

    let normalMinWidth =
      (CGFloat(spaceCount) * badgeSide)
      + (CGFloat(max(spaceCount - 1, 0)) * minSpacing)
    let compactMinWidth =
      badgeSide
      + (CGFloat(max(spaceCount - 1, 0)) * dotSide)
      + (CGFloat(max(spaceCount - 1, 0)) * minSpacing)

    if availableWidth >= normalMinWidth {
      return .normal
    }
    if availableWidth >= compactMinWidth {
      return .compact
    }
    return .compact
  }
}

enum TerminalSidebarLayout {
  static let tabRowCornerRadius: CGFloat = 12
  static let tabRowHeight: CGFloat = 48
  static let tabRowSpacing: CGFloat = 2

  static func insertingID(
    _ id: TerminalTabID,
    into ids: [TerminalTabID],
    at destinationIndex: Int
  ) -> [TerminalTabID] {
    var reordered = ids.filter { $0 != id }
    let clampedDestination = max(0, min(destinationIndex, reordered.count))
    reordered.insert(id, at: clampedDestination)
    return reordered
  }

  static func removingID(
    _ id: TerminalTabID,
    from ids: [TerminalTabID]
  ) -> [TerminalTabID] {
    ids.filter { $0 != id }
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

  static func reorderedIDs(
    _ ids: [TerminalTabID],
    movingFrom sourceIndex: Int,
    to destinationIndex: Int
  ) -> [TerminalTabID] {
    guard ids.indices.contains(sourceIndex) else { return ids }

    var reordered = ids
    let item = reordered.remove(at: sourceIndex)
    let clampedDestination = max(0, min(destinationIndex, reordered.count))
    reordered.insert(item, at: clampedDestination)
    return reordered
  }

  static func reorderOffset(
    for index: Int,
    sourceIndex: Int?,
    destinationIndex: Int?,
    rowHeight: CGFloat,
    spacing: CGFloat
  ) -> CGFloat {
    guard
      let sourceIndex,
      let destinationIndex,
      sourceIndex != destinationIndex
    else {
      return 0
    }

    let step = rowHeight + spacing
    if sourceIndex < destinationIndex {
      if index > sourceIndex && index <= destinationIndex {
        return -step
      }
    } else if index >= destinationIndex && index < sourceIndex {
      return step
    }
    return 0
  }

  static func centersDragPreviewInSidebar(
    sourceZone: TerminalSidebarDropZoneID?,
    activeZone: TerminalSidebarDropZoneID?,
    isCursorInSidebar: Bool
  ) -> Bool {
    guard isCursorInSidebar, let sourceZone else { return false }
    return activeZone == sourceZone
  }

  static func unionFrame(
    _ frames: [CGRect]
  ) -> CGRect {
    frames.reduce(.null) { partial, frame in
      partial.union(frame)
    }
  }

  static func showsTopIndicator(
    scrollOffset: CGFloat
  ) -> Bool {
    scrollOffset > 0.5
  }

  static func showsBottomIndicator(
    scrollOffset: CGFloat,
    viewportHeight: CGFloat,
    contentHeight: CGFloat,
    selectedFrame: CGRect?
  ) -> Bool {
    let overflowBelow =
      contentHeight > viewportHeight
      && scrollOffset + viewportHeight < contentHeight - 0.5
    let selectedBelow =
      selectedFrame.map { $0.minY > scrollOffset + viewportHeight } ?? false
    return overflowBelow || selectedBelow
  }
}

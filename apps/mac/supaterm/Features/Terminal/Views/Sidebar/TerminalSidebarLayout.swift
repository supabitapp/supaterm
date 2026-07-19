import CoreGraphics
import Foundation

enum TerminalSidebarDropZoneID: Hashable {
  case projects(isPinned: Bool)
  case tabs(projectID: TerminalProjectID, isPinned: Bool)
}

struct TerminalSidebarProjectDropResult: Equatable {
  let orderedIDs: [TerminalProjectID]
  let togglesPinned: Bool
}

enum TerminalSidebarLayout {
  static let tabRowCornerRadius: CGFloat = 8
  static let tabRowMinHeight: CGFloat = 30
  static let rowHorizontalPadding: CGFloat = 10
  static let tabRowVerticalPadding: CGFloat = 5
  static let tabRowSpacing: CGFloat = 2
  static let projectGroupSpacing: CGFloat = 8
  static let cardCornerRadius: CGFloat = 12
  static let cardMinHeight: CGFloat = 36
  static let cardVerticalPadding: CGFloat = 8
  static let trafficLightTopPadding: CGFloat = 6

  static var firstVisibleSectionTopInset: CGFloat {
    trafficLightTopPadding + WindowTrafficLightMetrics.topPadding + WindowTrafficLightMetrics.buttonSize + 4
  }

  static func insertingID<ID: Equatable>(
    _ id: ID,
    into ids: [ID],
    at destinationIndex: Int
  ) -> [ID] {
    var reordered = ids.filter { $0 != id }
    let clampedDestination = max(0, min(destinationIndex, reordered.count))
    reordered.insert(id, at: clampedDestination)
    return reordered
  }

  static func removingID<ID: Equatable>(
    _ id: ID,
    from ids: [ID]
  ) -> [ID] {
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

  static func showsSpaceList(
    spacesCount: Int
  ) -> Bool {
    spacesCount > 1
  }

  static func reorderedIDs<ID>(
    _ ids: [ID],
    movingFrom sourceIndex: Int,
    to destinationIndex: Int
  ) -> [ID] {
    guard ids.indices.contains(sourceIndex) else { return ids }

    var reordered = ids
    let item = reordered.remove(at: sourceIndex)
    let clampedDestination = max(0, min(destinationIndex, reordered.count))
    reordered.insert(item, at: clampedDestination)
    return reordered
  }

  static func insertionIndex<ID: Hashable>(
    for localY: CGFloat,
    orderedIDs: [ID],
    frames: [ID: CGRect]
  ) -> Int {
    for (index, id) in orderedIDs.enumerated() {
      guard let frame = frames[id] else { continue }
      if localY < frame.midY {
        return index
      }
    }
    return orderedIDs.count
  }

  static func projectDrop(
    moving projectID: TerminalProjectID,
    pinnedIDs: [TerminalProjectID],
    regularIDs: [TerminalProjectID],
    source: (isPinned: Bool, index: Int),
    target: (isPinned: Bool, index: Int)
  ) -> TerminalSidebarProjectDropResult {
    if source.isPinned == target.isPinned {
      let reorderedIDs = reorderedIDs(
        source.isPinned ? pinnedIDs : regularIDs,
        movingFrom: source.index,
        to: target.index
      )
      return TerminalSidebarProjectDropResult(
        orderedIDs: source.isPinned ? reorderedIDs + regularIDs : pinnedIDs + reorderedIDs,
        togglesPinned: false
      )
    }

    let updatedPinnedIDs =
      target.isPinned
      ? insertingID(projectID, into: pinnedIDs, at: target.index)
      : removingID(projectID, from: pinnedIDs)
    let updatedRegularIDs =
      target.isPinned
      ? removingID(projectID, from: regularIDs)
      : insertingID(projectID, into: regularIDs, at: target.index)
    return TerminalSidebarProjectDropResult(
      orderedIDs: updatedPinnedIDs + updatedRegularIDs,
      togglesPinned: true
    )
  }

  static func reorderOffset(
    for index: Int,
    sourceIndex: Int?,
    destinationIndex: Int?,
    rowExtent: CGFloat
  ) -> CGFloat {
    guard
      let sourceIndex,
      let destinationIndex,
      sourceIndex != destinationIndex,
      rowExtent > 0
    else {
      return 0
    }

    if sourceIndex < destinationIndex {
      if index > sourceIndex && index <= destinationIndex {
        return -rowExtent
      }
    } else if index >= destinationIndex && index < sourceIndex {
      return rowExtent
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
    guard let first = frames.first else { return .zero }
    return frames.dropFirst().reduce(first) { partial, frame in
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

import CoreGraphics
import Testing

@testable import supaterm

struct TerminalSidebarLayoutTests {
  @Test
  func spaceBarLayoutUsesNormalModeWhenWidthFitsBadges() {
    #expect(
      TerminalSidebarSpaceBarLayoutMode.determine(
        spaceCount: 3,
        availableWidth: 104
      ) == .normal
    )
  }

  @Test
  func spaceBarLayoutUsesCompactModeWhenWidthIsTight() {
    #expect(
      TerminalSidebarSpaceBarLayoutMode.determine(
        spaceCount: 3,
        availableWidth: 103
      ) == .compact
    )
  }

  @Test
  func spaceMonogramUsesFirstNonWhitespaceCharacter() {
    #expect(
      TerminalSidebarLayout.spaceMonogram(
        for: "  shell",
        fallbackIndex: 2
      ) == "S"
    )
  }

  @Test
  func spaceMonogramFallsBackToOrdinalForBlankName() {
    #expect(
      TerminalSidebarLayout.spaceMonogram(
        for: "   ",
        fallbackIndex: 2
      ) == "3"
    )
  }

  @Test
  func reorderedIDsMovesItemForward() {
    let first = TerminalTabID()
    let second = TerminalTabID()
    let third = TerminalTabID()

    let reordered = TerminalSidebarLayout.reorderedIDs(
      [first, second, third],
      movingFrom: 0,
      to: 2
    )

    #expect(reordered == [second, third, first])
  }

  @Test
  func reorderedIDsMovesItemBackward() {
    let first = TerminalTabID()
    let second = TerminalTabID()
    let third = TerminalTabID()

    let reordered = TerminalSidebarLayout.reorderedIDs(
      [first, second, third],
      movingFrom: 2,
      to: 0
    )

    #expect(reordered == [third, first, second])
  }

  @Test
  func insertingIDClampsAndRemovesExistingOccurrence() {
    let first = TerminalTabID()
    let second = TerminalTabID()
    let third = TerminalTabID()

    let reordered = TerminalSidebarLayout.insertingID(
      second,
      into: [first, second, third],
      at: 10
    )

    #expect(reordered == [first, third, second])
  }

  @Test
  func removingIDDropsOnlyTheRequestedTab() {
    let first = TerminalTabID()
    let second = TerminalTabID()
    let third = TerminalTabID()

    #expect(
      TerminalSidebarLayout.removingID(
        second,
        from: [first, second, third]
      ) == [first, third]
    )
  }

  @Test
  func reorderOffsetShiftsRowsBetweenSourceAndDestination() {
    #expect(
      TerminalSidebarLayout.reorderOffset(
        for: 2,
        sourceIndex: 1,
        destinationIndex: 3,
        rowHeight: 36,
        spacing: 2
      ) == -38
    )
    #expect(
      TerminalSidebarLayout.reorderOffset(
        for: 3,
        sourceIndex: 1,
        destinationIndex: 3,
        rowHeight: 36,
        spacing: 2
      ) == -38
    )
    #expect(
      TerminalSidebarLayout.reorderOffset(
        for: 0,
        sourceIndex: 1,
        destinationIndex: 3,
        rowHeight: 36,
        spacing: 2
      ) == 0
    )
  }

  @Test
  func scrollIndicatorsReflectOverflowAndSelectedTabPosition() {
    #expect(TerminalSidebarLayout.showsTopIndicator(scrollOffset: 1))
    #expect(!TerminalSidebarLayout.showsTopIndicator(scrollOffset: 0))

    #expect(
      TerminalSidebarLayout.showsBottomIndicator(
        scrollOffset: 0,
        viewportHeight: 200,
        contentHeight: 260,
        selectedFrame: nil
      )
    )
    #expect(
      TerminalSidebarLayout.showsBottomIndicator(
        scrollOffset: 0,
        viewportHeight: 200,
        contentHeight: 180,
        selectedFrame: CGRect(x: 0, y: 240, width: 100, height: 36)
      )
    )
    #expect(
      !TerminalSidebarLayout.showsBottomIndicator(
        scrollOffset: 40,
        viewportHeight: 200,
        contentHeight: 220,
        selectedFrame: CGRect(x: 0, y: 120, width: 100, height: 36)
      )
    )
  }

  @Test
  func unionFrameSpansAllDropZones() {
    #expect(
      TerminalSidebarLayout.unionFrame(
        [
          CGRect(x: 10, y: 20, width: 100, height: 40),
          CGRect(x: 12, y: 80, width: 96, height: 120),
        ]
      ) == CGRect(x: 10, y: 20, width: 100, height: 180)
    )
  }
}

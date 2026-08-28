import XCTest

final class TabDragUITests: SupatermUITestCase {
  @MainActor
  func testDraggingTabReordersTwiceAndPinsAcrossSections() async throws {
    try await createNamedTabs(["First UI Tab", "Second UI Tab", "Third UI Tab"])

    let firstTab = sidebarTabRow(named: "First UI Tab")
    let thirdTab = sidebarTabRow(named: "Third UI Tab")
    let didSelectThirdTab = await waitForSidebarSelection(thirdTab)
    XCTAssertTrue(didSelectThirdTab)

    let reorderedTitles = ["Second UI Tab", "Third UI Tab", "First UI Tab"]
    let didReorder = await dragTab(
      source: firstTab,
      destination: sidebarPinnedControl(SupatermUITestIdentifier.Accessibility.sidebarNewTab),
      destinationY: 0.5,
      until: { self.tabRowsMatch(reorderedTitles) && firstTab.isSelected }
    )
    XCTAssertTrue(didReorder)

    let secondTab = sidebarTabRow(named: "Second UI Tab")
    let didReorderAgain = await dragTab(
      source: firstTab,
      destination: secondTab,
      destinationY: 0.1,
      until: {
        self.tabRowsMatch(["First UI Tab", "Second UI Tab", "Third UI Tab"])
          && firstTab.isSelected
      }
    )
    XCTAssertTrue(didReorderAgain)

    try clickSidebarContextMenuItem("Pin Tab", on: secondTab)
    let didPinSecondTab = await wait(for: secondTab) { $0.label.contains("Pinned") }
    XCTAssertTrue(didPinSecondTab)

    let pinDivider = app.descendants(matching: .tableRow)["sidebar.pin-divider"]
    let didPinThirdTab = await dragTab(
      source: thirdTab,
      destination: secondTab,
      destinationY: 0.1,
      until: {
        self.tabRowsMatch(["Third UI Tab", "Second UI Tab", "First UI Tab"])
          && thirdTab.frame.maxY <= pinDivider.frame.minY
      }
    )
    XCTAssertTrue(didPinThirdTab)
  }

  @MainActor
  private func tabRowsMatch(_ titles: [String]) -> Bool {
    guard sidebarTabRows.count == titles.count else { return false }
    return titles.indices.allSatisfy {
      sidebarTabRows.element(boundBy: $0).label.contains(titles[$0])
    }
  }

  @MainActor
  private func dragTab(
    source: XCUIElement,
    destination: XCUIElement,
    destinationY: CGFloat,
    until condition: @escaping () -> Bool
  ) async -> Bool {
    for _ in 0..<2 {
      guard source.exists, destination.exists else { return false }

      source.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(
        forDuration: 0.5,
        thenDragTo: destination.coordinate(
          withNormalizedOffset: CGVector(dx: 0.5, dy: destinationY)
        ),
        withVelocity: .slow,
        thenHoldForDuration: 0.5
      )
      if await wait(timeout: .seconds(10), until: condition) {
        return true
      }
    }
    return condition()
  }
}

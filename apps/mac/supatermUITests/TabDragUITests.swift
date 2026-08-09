import XCTest

final class TabDragUITests: SupatermUITestCase {
  @MainActor
  func testDraggingUnselectedTabToSplitKeepsTheLiveHostSelected() async throws {
    try await createNamedTabs(["Split Host", "Dragged Source"])

    let host = sidebarTabRow(named: "Split Host")
    host.click()
    let didSelectHost = await waitForSidebarSelection(host)
    XCTAssertTrue(didSelectHost)

    let source = sidebarTabRow(named: "Dragged Source")
    let destination = mainTerminal.coordinate(
      withNormalizedOffset: CGVector(dx: 0.82, dy: 0.5)
    )
    source.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(
      forDuration: 0.5,
      thenDragTo: destination,
      withVelocity: .slow,
      thenHoldForDuration: 0.5
    )

    _ = try await requireVisiblePanes(count: 2)
    let didMergeIntoHost = await wait {
      self.sidebarTabRows.count == 1
        && host.exists
        && host.isSelected
        && !source.exists
    }
    XCTAssertTrue(didMergeIntoHost)
  }

  @MainActor
  func testDraggingTabReordersRegularSectionAndPinsAcrossSections() async throws {
    try await createNamedTabs(["First UI Tab", "Second UI Tab", "Third UI Tab"])

    let reorderedTitles = ["Second UI Tab", "Third UI Tab", "First UI Tab"]
    let didReorder = await dragTab(
      source: sidebarTabRow(named: "First UI Tab"),
      destination: sidebarTabRow(named: "Third UI Tab"),
      destinationY: 0.9,
      until: { self.tabRowsMatch(reorderedTitles) }
    )
    XCTAssertTrue(didReorder)

    let secondTab = sidebarTabRow(named: "Second UI Tab")
    try clickSidebarContextMenuItem("Pin Tab", on: secondTab)
    let didPinSecondTab = await wait(for: secondTab) { $0.label.contains("Pinned") }
    XCTAssertTrue(didPinSecondTab)

    let thirdTab = sidebarTabRow(named: "Third UI Tab")
    let didPinThirdTab = await dragTab(
      source: thirdTab,
      destination: secondTab,
      destinationY: 0.1,
      until: { thirdTab.label.contains("Pinned") }
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

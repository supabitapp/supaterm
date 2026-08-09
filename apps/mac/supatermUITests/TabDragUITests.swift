import XCTest

final class TabDragUITests: SupatermUITestCase {
  @MainActor
  func testDraggingTheOnlySelectedTabToSplitCreatesANewPane() async throws {
    try await createNamedTabs(["Only Tab"])

    let source = sidebarTabRow(named: "Only Tab")
    XCTAssertTrue(source.isSelected)
    source.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(
      forDuration: 0.5,
      thenDragTo: mainTerminal.coordinate(
        withNormalizedOffset: CGVector(dx: 0.82, dy: 0.5)
      ),
      withVelocity: .slow,
      thenHoldForDuration: 0.5
    )

    _ = try await requireVisiblePanes(count: 2)
    XCTAssertEqual(sidebarTabRows.count, 1)
    XCTAssertTrue(source.exists)
    XCTAssertTrue(source.isSelected)
  }

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
  func testDraggingIntoACollapsedGroupedHostKeepsTheSplitActive() async throws {
    try await createNamedTabs(["Grouped Host", "Dragged Source"])
    try await createGroup(named: "Host Group", containing: "Grouped Host")

    let host = sidebarTabRow(named: "Grouped Host")
    host.click()
    let didSelectHost = await waitForSidebarSelection(host)
    XCTAssertTrue(didSelectHost)

    let header = sidebarGroupHeader(named: "Host Group")
    try clickSidebarContextMenuItem("Collapse Group", on: header)
    let didCollapse = await wait(for: header) {
      ($0.value as? String) == "Collapsed"
    }
    XCTAssertTrue(didCollapse)

    let source = sidebarTabRow(named: "Dragged Source")
    source.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(
      forDuration: 0.5,
      thenDragTo: mainTerminal.coordinate(
        withNormalizedOffset: CGVector(dx: 0.82, dy: 0.5)
      ),
      withVelocity: .slow,
      thenHoldForDuration: 0.5
    )

    _ = try await requireVisiblePanes(count: 2)
    let didMergeIntoGroup = await wait {
      header.exists
        && (header.value as? String) == "Expanded"
        && host.exists
        && host.isSelected
        && !source.exists
    }
    XCTAssertTrue(didMergeIntoGroup)
  }

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
      destination: thirdTab,
      destinationY: 0.9,
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

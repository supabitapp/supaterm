import XCTest

final class TabSplitDragUITests: SupatermUITestCase {
  @MainActor
  func testDraggingTheOnlySelectedTabToSplitCanDragAgain() async throws {
    try await createNamedTabs(["Only Tab"])

    for expectedPaneCount in 2...3 {
      let source = sidebarTabRow(named: "Only Tab")
      XCTAssertTrue(source.isSelected)
      _ = try await requireVisiblePanes(count: expectedPaneCount - 1)
      let splitGroup = app.splitGroups.matching(
        NSPredicate(format: "label BEGINSWITH %@", "Terminal split:")
      ).firstMatch
      XCTAssertTrue(splitGroup.exists)
      source.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(
        forDuration: 0.5,
        thenDragTo: splitGroup.coordinate(
          withNormalizedOffset: CGVector(dx: 0.82, dy: 0.5)
        ),
        withVelocity: .slow,
        thenHoldForDuration: 0.5
      )

      _ = try await requireVisiblePanes(count: expectedPaneCount)
      XCTAssertEqual(sidebarTabRows.count, 1)
      let didRestoreSource = await wait {
        let restoredSource = self.sidebarTabRow(named: "Only Tab")
        return restoredSource.exists && restoredSource.isHittable && restoredSource.isSelected
      }
      XCTAssertTrue(didRestoreSource)
    }
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
  func testDraggingIntoACollapsedProjectHostKeepsTheSplitActive() async throws {
    try await createNamedTabs(["Project Host", "Dragged Source"])
    try await createProject(named: "Host Project", containing: "Project Host")

    let host = sidebarTabRow(named: "Project Host")
    host.click()
    let didSelectHost = await waitForSidebarSelection(host)
    XCTAssertTrue(didSelectHost)

    let header = sidebarProjectHeader(named: "Host Project")
    try clickSidebarContextMenuItem("Collapse Project", on: header)
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
    let didMergeIntoProject = await wait {
      header.exists
        && (header.value as? String) == "Expanded"
        && host.exists
        && host.isSelected
        && !source.exists
    }
    XCTAssertTrue(didMergeIntoProject)
  }
}

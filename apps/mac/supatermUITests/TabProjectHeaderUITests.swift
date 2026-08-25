import XCTest

final class TabProjectHeaderUITests: SupatermUITestCase {
  @MainActor
  func testProjectNewTabAppearsOnlyWhileHoveringItsHeaderAndCreatesSelectedTab() async throws {
    try await createNamedTabs(["Seed"])
    try await createProject(named: "Hover", containing: "Seed")
    let header = try require(sidebarProjectHeader(named: "Hover"))
    let child = try require(sidebarStructuralTabRow(named: "Seed"))
    let newTab = app.buttons["New Tab in Hover"]
    XCTAssertEqual(header.elementType, .button)

    header.hover()
    XCTAssertTrue(newTab.waitForExistence(timeout: 2))

    child.hover()
    let didHideNewTab = await wait(for: newTab) { !$0.exists }
    XCTAssertTrue(didHideNewTab)

    header.hover()
    try require(newTab)
    newTab.click()

    let projectID = header.identifier.dropFirst(
      SupatermUITestIdentifier.Accessibility.sidebarProjectHeaderPrefix.count
    )
    let projectTabPrefix =
      SupatermUITestIdentifier.Accessibility.sidebarProjectPrefix
      + projectID
      + SupatermUITestIdentifier.Accessibility.sidebarProjectTabMarker
    let didCreateSelectedTab = await wait {
      let rows = self.sidebarTabRows.allElementsBoundByIndex
      return rows.count == 2
        && rows.contains {
          $0.identifier != child.identifier
            && $0.identifier.hasPrefix(projectTabPrefix)
            && $0.isSelected
        }
    }
    XCTAssertTrue(didCreateSelectedTab)
  }

  @MainActor
  func testProjectHeaderTogglesFromItsFullWidth() async throws {
    try await createNamedTabs(["Seed"])
    try await createProject(named: "Toggle", containing: "Seed")
    let header = try require(sidebarProjectHeader(named: "Toggle"))
    let row = try require(sidebarProjectHeaders.matching(identifier: header.identifier).firstMatch)
    XCTAssertEqual(header.frame, row.frame)

    header.click()
    let didCollapse = await wait(for: sidebarStructuralTabRow(named: "Seed")) { !$0.exists }
    XCTAssertTrue(didCollapse)

    header.click()
    XCTAssertTrue(sidebarStructuralTabRow(named: "Seed").waitForExistence(timeout: 2))
  }

  @MainActor
  func testCollapsedProjectSurvivesSidebarToggle() async throws {
    try await createNamedTabs(["Seed", "Root"])
    try await createProject(named: "Toggle", containing: "Seed")
    let header = try require(sidebarProjectHeader(named: "Toggle"))

    header.click()
    let didCollapse = await wait(for: sidebarStructuralTabRow(named: "Seed")) { !$0.exists }
    XCTAssertTrue(didCollapse)

    let hideSidebarButton = app.buttons["Hide sidebar"]
    try require(hideSidebarButton)
    hideSidebarButton.click()
    let didCollapseSidebar = await waitForSidebarCollapsed()
    XCTAssertTrue(didCollapseSidebar)

    let showSidebarButton = app.buttons.matching(
      NSPredicate(format: "label BEGINSWITH %@", "Show sidebar")
    ).firstMatch
    try require(showSidebarButton)
    showSidebarButton.click()
    let didExpandSidebar = await waitForSidebarExpanded()
    XCTAssertTrue(didExpandSidebar)
    let restoredHeader = sidebarProjectHeader(named: "Toggle")
    let didRestore = await wait(for: restoredHeader) {
      $0.isHittable && ($0.value as? String) == "Collapsed"
    }
    XCTAssertTrue(didRestore)
    XCTAssertTrue(sidebarStructuralTabRow(named: "Root").isHittable)
    XCTAssertFalse(sidebarStructuralTabRow(named: "Seed").exists)
  }
}

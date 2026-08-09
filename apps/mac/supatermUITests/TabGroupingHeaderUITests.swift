import XCTest

final class TabGroupingHeaderUITests: SupatermUITestCase {
  @MainActor
  func testGroupCloseAppearsOnlyWhileHoveringItsHeader() async throws {
    try await createNamedTabs(["Seed"])
    try await createGroup(named: "Hover", containing: "Seed")
    let header = try require(sidebarGroupHeader(named: "Hover"))
    let child = try require(sidebarStructuralTabRow(named: "Seed"))
    let close = app.buttons["Close Hover"]
    XCTAssertEqual(header.elementType, .button)

    header.hover()
    XCTAssertTrue(close.waitForExistence(timeout: 2))

    child.hover()
    let didHideClose = await wait(for: close) { !$0.exists }
    XCTAssertTrue(didHideClose)
  }

  @MainActor
  func testGroupHeaderTogglesFromItsFullWidth() async throws {
    try await createNamedTabs(["Seed"])
    try await createGroup(named: "Toggle", containing: "Seed")
    let header = try require(sidebarGroupHeader(named: "Toggle"))
    let row = try require(sidebarGroupHeaders.matching(identifier: header.identifier).firstMatch)
    XCTAssertEqual(header.frame, row.frame)

    header.click()
    let didCollapse = await wait(for: sidebarStructuralTabRow(named: "Seed")) { !$0.exists }
    XCTAssertTrue(didCollapse)

    header.click()
    XCTAssertTrue(sidebarStructuralTabRow(named: "Seed").waitForExistence(timeout: 2))
  }

  @MainActor
  func testCollapsedGroupSurvivesSidebarToggle() async throws {
    try await createNamedTabs(["Seed", "Root"])
    try await createGroup(named: "Toggle", containing: "Seed")
    let header = try require(sidebarGroupHeader(named: "Toggle"))

    header.click()
    let didCollapse = await wait(for: sidebarStructuralTabRow(named: "Seed")) { !$0.exists }
    XCTAssertTrue(didCollapse)

    try clickMenuItem(.toggleSidebar)
    let didHide = await wait(for: header) { !$0.isHittable }
    XCTAssertTrue(didHide)

    try clickMenuItem(.toggleSidebar)
    let restoredHeader = sidebarGroupHeader(named: "Toggle")
    let didRestore = await wait(for: restoredHeader) {
      $0.isHittable && ($0.value as? String) == "Collapsed"
    }
    XCTAssertTrue(didRestore)
    XCTAssertTrue(sidebarStructuralTabRow(named: "Root").isHittable)
    XCTAssertFalse(sidebarStructuralTabRow(named: "Seed").exists)
  }

  @MainActor
  func testNewTabCommandsChooseRootOrSelectedGroup() async throws {
    try await createNamedTabs(["Seed"])
    try await createGroup(named: "Target", containing: "Seed")
    let seed = try require(sidebarTabRow(named: "Seed"))

    seed.click()
    app.typeKey("t", modifierFlags: .command)
    let didCreateRootTab = await waitForSidebarElementCount(sidebarTabRows, equals: 2)
    XCTAssertTrue(didCreateRootTab)
    try await renameSelectedTab(to: "Root")
    await requireSidebarStructure([
      .group("Target", children: ["Seed"]),
      .tab("Root"),
    ])

    seed.click()
    app.typeKey("t", modifierFlags: [.command, .option])
    let didCreateShortcutChild = await waitForSidebarElementCount(sidebarTabRows, equals: 3)
    XCTAssertTrue(didCreateShortcutChild)
    try await renameSelectedTab(to: "Shortcut Child")
    await requireSidebarStructure([
      .group("Target", children: ["Seed", "Shortcut Child"]),
      .tab("Root"),
    ])

    try clickSidebarContextMenuItem(
      "New Tab in Group",
      on: sidebarGroupHeader(named: "Target")
    )
    let didCreateMenuChild = await waitForSidebarElementCount(sidebarTabRows, equals: 4)
    XCTAssertTrue(didCreateMenuChild)
    try await renameSelectedTab(to: "Menu Child")
    await requireSidebarStructure([
      .group("Target", children: ["Seed", "Shortcut Child", "Menu Child"]),
      .tab("Root"),
    ])
  }
}

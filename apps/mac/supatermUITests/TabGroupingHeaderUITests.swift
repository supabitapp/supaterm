import XCTest

final class TabGroupingHeaderUITests: SupatermUITestCase {
  @MainActor
  func testGroupNewTabAppearsOnlyWhileHoveringItsHeaderAndCreatesSelectedTab() async throws {
    try await createNamedTabs(["Seed"])
    try await createGroup(named: "Hover", containing: "Seed")
    let header = try require(sidebarGroupHeader(named: "Hover"))
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

    let groupID = header.identifier.dropFirst(
      SupatermUITestIdentifier.Accessibility.sidebarGroupHeaderPrefix.count
    )
    let groupTabPrefix =
      SupatermUITestIdentifier.Accessibility.sidebarGroupPrefix
      + groupID
      + SupatermUITestIdentifier.Accessibility.sidebarGroupedTabMarker
    let didCreateSelectedTab = await wait {
      let rows = self.sidebarTabRows.allElementsBoundByIndex
      return rows.count == 2
        && rows.contains {
          $0.identifier != child.identifier
            && $0.identifier.hasPrefix(groupTabPrefix)
            && $0.isSelected
        }
    }
    XCTAssertTrue(didCreateSelectedTab)
  }

  @MainActor
  func testGroupHeaderTogglesFromItsFullWidth() async throws {
    try await createNamedTabs(["Seed", "Root"])
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
  func testCollapsedGroupHidesNewTabAccessoryWhileHovered() async throws {
    try await createNamedTabs(["Seed"])
    try await createGroup(named: "Collapsed", containing: "Seed")
    let header = try require(sidebarGroupHeader(named: "Collapsed"))

    header.click()
    let didCollapse = await wait(for: header) {
      ($0.value as? String) == "Collapsed"
    }
    XCTAssertTrue(didCollapse)

    header.hover()
    let didShowNewTab = await wait(timeout: .milliseconds(500)) {
      self.app.buttons["New Tab in Collapsed"].exists
    }
    XCTAssertFalse(didShowNewTab)
  }

  @MainActor
  func testCollapsedGroupKeepsOnlyItsSelectedTabVisible() async throws {
    try await createNamedTabs(["Seed", "Root"])
    try await createGroup(named: "Selected", containing: "Seed")
    let seed = try require(sidebarStructuralTabRow(named: "Seed"))
    seed.click()
    let didSelectSeed = await waitForSidebarSelection(seed)
    XCTAssertTrue(didSelectSeed)

    app.typeKey("t", modifierFlags: [.command, .option])
    let didCreateTab = await waitForSidebarElementCount(sidebarTabRows, equals: 3)
    XCTAssertTrue(didCreateTab)
    try await renameSelectedTab(to: "Kept")

    let header = try require(sidebarGroupHeader(named: "Selected"))
    header.click()
    let didCollapse = await wait(for: header) {
      ($0.value as? String) == "Collapsed"
    }
    XCTAssertTrue(didCollapse)
    await requireSidebarStructure([
      .group("Selected", children: ["Kept"]),
      .tab("Root"),
    ])
    XCTAssertTrue(sidebarStructuralTabRow(named: "Kept").isSelected)
    XCTAssertFalse(sidebarStructuralTabRow(named: "Seed").exists)

    header.click()
    await requireSidebarStructure([
      .group("Selected", children: ["Seed", "Kept"]),
      .tab("Root"),
    ])
  }

  @MainActor
  func testGroupColorSubmenuSurvivesLiveTabUpdates() async throws {
    await requireInitialSidebarTab()
    let tab = try require(sidebarTabRows.firstMatch)
    try await createGroup(named: "Live", containing: tab)
    let header = try require(sidebarGroupHeader(named: "Live"))

    mainTerminal.click()
    mainTerminal.typeText(
      #"node -e 'let i=0;let t=setInterval(()=>{"#
        + #"process.stdout.write("\x1b]7;file://localhost""#
        + #"+(++i%2?"/tmp":process.env.HOME)+"\x07");"#
        + #"if(i===100)clearInterval(t)},100)'"#
    )
    mainTerminal.typeKey(.return, modifierFlags: [])

    header.rightClick()
    let color = try require(app.menuItems["Color"].firstMatch)
    color.hover()
    let blue = try require(app.menuItems["Blue"].firstMatch)

    let didDisappear = await wait(for: blue, timeout: .seconds(3)) {
      !$0.exists || !$0.isHittable
    }
    XCTAssertFalse(didDisappear)
    XCTAssertTrue(blue.exists)
    XCTAssertTrue(blue.isHittable)
    blue.click()

    let didSetColor = await wait(for: header) {
      $0.label.contains("Blue group")
    }
    XCTAssertTrue(didSetColor)
  }

  @MainActor
  func testCollapsedGroupSurvivesSidebarToggle() async throws {
    try await createNamedTabs(["Seed", "Root"])
    try await createGroup(named: "Toggle", containing: "Seed")
    let header = try require(sidebarGroupHeader(named: "Toggle"))

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
    let restoredHeader = sidebarGroupHeader(named: "Toggle")
    let didRestore = await wait(for: restoredHeader) {
      $0.isHittable && ($0.value as? String) == "Collapsed"
    }
    XCTAssertTrue(didRestore)
    XCTAssertTrue(sidebarStructuralTabRow(named: "Root").isHittable)
    XCTAssertFalse(sidebarStructuralTabRow(named: "Seed").exists)
  }
}

import XCTest

final class DiaParityDragUITests: SupatermUITestCase {
  @MainActor
  func testAdjacentDownwardReorderMatchesExpectedOrder() async throws {
    try await createNamedTabs(Self.fourTabTitles)

    try drag(
      sidebarStructuralTabRow(named: "A UI Tab"),
      to: sidebarStructuralTabRow(named: "B UI Tab")
    )

    await requireSidebarStructure([
      .tab("B UI Tab"),
      .tab("A UI Tab"),
      .tab("C UI Tab"),
      .tab("D UI Tab"),
    ])
  }

  @MainActor
  func testAdjacentUpwardReorderMatchesExpectedOrder() async throws {
    try await createNamedTabs(Self.fourTabTitles)

    try drag(
      sidebarStructuralTabRow(named: "D UI Tab"),
      to: sidebarStructuralTabRow(named: "C UI Tab")
    )

    await requireSidebarStructure([
      .tab("A UI Tab"),
      .tab("B UI Tab"),
      .tab("D UI Tab"),
      .tab("C UI Tab"),
    ])
  }

  @MainActor
  func testAdjacentDownwardReorderWithinGroupMatchesExpectedOrder() async throws {
    try await createNamedTabs([Self.fourTabTitles[0]])
    try await createGroup(named: "UI Group", containing: Self.fourTabTitles[0])

    for (index, title) in Self.fourTabTitles.dropFirst().enumerated() {
      try clickSidebarContextMenuItem(
        "New Tab in Group",
        on: sidebarGroupHeader(named: "UI Group")
      )
      let didCreateTab = await waitForSidebarElementCount(
        sidebarTabRows,
        equals: index + 2,
        timeout: .seconds(30)
      )
      XCTAssertTrue(didCreateTab)
      try await renameSelectedTab(to: title)
    }

    await requireSidebarStructure([
      .group("UI Group", children: Self.fourTabTitles)
    ])

    try drag(
      sidebarStructuralTabRow(named: "A UI Tab"),
      to: sidebarStructuralTabRow(named: "B UI Tab")
    )

    await requireSidebarStructure([
      .group(
        "UI Group",
        children: ["B UI Tab", "A UI Tab", "C UI Tab", "D UI Tab"]
      )
    ])
  }

  @MainActor
  func testHorizontalTabInteractionsCommitAndSurviveVerticalRoundTrip() async throws {
    try await createNamedTabs(["Seed", "Mover", "Tail"])
    try await createGroup(named: "Target", containing: "Seed")
    try clickMenuItem(.toggleTabLayout)

    try drag(horizontalTab(named: "Mover"), to: horizontalGroup(named: "Target"))
    let didJoinGroup = await wait {
      self.horizontalGroup(named: "Target").frame.maxX
        <= self.horizontalTab(named: "Mover").frame.minX
        && self.horizontalTab(named: "Mover").frame.maxX
          <= self.horizontalTab(named: "Seed").frame.minX
    }
    XCTAssertTrue(didJoinGroup)

    try drag(
      horizontalTab(named: "Seed"),
      to: horizontalTab(named: "Mover"),
      destinationOffset: CGVector(dx: 0.25, dy: 0.5)
    )
    let didReorderGroupedTabs = await wait {
      self.horizontalTab(named: "Seed").frame.maxX
        <= self.horizontalTab(named: "Mover").frame.minX
    }
    XCTAssertTrue(didReorderGroupedTabs)

    try drag(
      horizontalGroup(named: "Target"),
      to: horizontalTab(named: "Tail"),
      destinationOffset: CGVector(dx: 0.9, dy: 0.5)
    )
    let didReorderGroup = await wait {
      self.horizontalTab(named: "Tail").frame.maxX
        <= self.horizontalGroup(named: "Target").frame.minX
    }
    XCTAssertTrue(didReorderGroup)

    let mover = try require(horizontalTab(named: "Mover"))
    mover.click()
    let didSelectMover = await wait(for: mover) { $0.isSelected }
    XCTAssertTrue(didSelectMover)

    let group = try require(horizontalGroup(named: "Target"))
    group.click()
    let didCollapseGroup = await wait(for: group) { ($0.value as? String) == "Collapsed" }
    XCTAssertTrue(didCollapseGroup)
    XCTAssertFalse(horizontalTab(named: "Seed").exists)
    group.click()
    let didExpandGroup = await wait(for: group) { ($0.value as? String) == "Expanded" }
    XCTAssertTrue(didExpandGroup)

    try clickMenuItem(.toggleTabLayout)
    await requireSidebarStructure([
      .tab("Tail"),
      .group("Target", children: ["Seed", "Mover"]),
    ])
    let didKeepSelection = await waitForSidebarSelection(sidebarTabRow(named: "Mover"))
    XCTAssertTrue(didKeepSelection)
  }

  @MainActor
  private func horizontalTab(named title: String) -> XCUIElement {
    app.radioButtons.matching(NSPredicate(format: "label == %@", title)).firstMatch
  }

  @MainActor
  private func horizontalGroup(named title: String) -> XCUIElement {
    app.disclosureTriangles.matching(
      NSPredicate(format: "label == %@", "Tab Group \(title)")
    ).firstMatch
  }

  private static let fourTabTitles = [
    "A UI Tab",
    "B UI Tab",
    "C UI Tab",
    "D UI Tab",
  ]
}

import XCTest

final class TabGroupingDragUITests: SupatermUITestCase {
  @MainActor
  func testRootTabDropsIntoExpandedGroup() async throws {
    try await createNamedTabs(["Root A", "Group Seed", "Root B"])
    try await createGroup(named: "Alpha", containing: "Group Seed")
    await requireSidebarStructure([
      .tab("Root A"),
      .group("Alpha", children: ["Group Seed"]),
      .tab("Root B"),
    ])

    try drag(
      sidebarStructuralTabRow(named: "Root A"),
      to: sidebarGroupHeader(named: "Alpha")
    )

    await requireSidebarStructure([
      .group("Alpha", children: ["Group Seed", "Root A"]),
      .tab("Root B"),
    ])
  }

  @MainActor
  func testLastGroupChildDropsIntoRootAndRemovesEmptyGroup() async throws {
    try await createNamedTabs(["Root Before", "Only Child", "Root After"])
    try await createGroup(named: "Solo", containing: "Only Child")
    await requireSidebarStructure([
      .tab("Root Before"),
      .group("Solo", children: ["Only Child"]),
      .tab("Root After"),
    ])

    try drag(
      sidebarStructuralTabRow(named: "Only Child"),
      to: sidebarFooterRow(SupatermUITestIdentifier.Accessibility.sidebarNewTab)
    )

    await requireSidebarStructure([
      .tab("Root Before"),
      .tab("Root After"),
      .tab("Only Child"),
    ])
    XCTAssertEqual(sidebarGroupHeaders.count, 0)
  }

  @MainActor
  func testWholeGroupAtBottomDropsAtSecondRootPosition() async throws {
    try await createNamedTabs(["First", "Second", "Third", "Group Child"])
    try await createGroup(named: "Bottom Group", containing: "Group Child")
    await requireSidebarStructure([
      .tab("First"),
      .tab("Second"),
      .tab("Third"),
      .group("Bottom Group", children: ["Group Child"]),
    ])

    try drag(
      sidebarGroupHeader(named: "Bottom Group"),
      to: sidebarStructuralTabRow(named: "Second"),
      destinationOffset: CGVector(dx: 0.5, dy: 0.1)
    )

    await requireSidebarStructure([
      .tab("First"),
      .group("Bottom Group", children: ["Group Child"]),
      .tab("Second"),
      .tab("Third"),
    ])
  }

  @MainActor
  func testGroupedTabDroppedBetweenGroupsRemainsRoot() async throws {
    try await createNamedTabs(["Alpha Child", "Beta Child", "Mover"])
    try await createGroup(named: "Alpha", containing: "Alpha Child")
    try await createGroup(named: "Beta", containing: "Beta Child")

    try drag(
      sidebarStructuralTabRow(named: "Mover"),
      to: sidebarGroupHeader(named: "Beta")
    )
    await requireSidebarStructure([
      .group("Alpha", children: ["Alpha Child"]),
      .group("Beta", children: ["Beta Child", "Mover"]),
    ])

    let alphaChild = try require(sidebarStructuralTabRow(named: "Alpha Child"))
    let betaHeader = try require(sidebarGroupHeader(named: "Beta"))
    let gap = max(1, betaHeader.frame.minY - alphaChild.frame.maxY)
    let destination = betaHeader.coordinate(
      withNormalizedOffset: CGVector(dx: 0.5, dy: 0)
    ).withOffset(CGVector(dx: 0, dy: -gap / 2))
    try drag(sidebarStructuralTabRow(named: "Mover"), to: destination)

    await requireSidebarStructure([
      .group("Alpha", children: ["Alpha Child"]),
      .tab("Mover"),
      .group("Beta", children: ["Beta Child"]),
    ])
  }

  @MainActor
  func testExpandedAndCollapsedGroupHeadersAcceptTabs() async throws {
    try await createNamedTabs(["Seed", "Expanded Join", "Collapsed Join", "Tail"])
    try await createGroup(named: "Target", containing: "Seed")

    try drag(
      sidebarStructuralTabRow(named: "Expanded Join"),
      to: sidebarGroupHeader(named: "Target")
    )
    await requireSidebarStructure([
      .group("Target", children: ["Seed", "Expanded Join"]),
      .tab("Collapsed Join"),
      .tab("Tail"),
    ])

    let tail = try require(sidebarTabRow(named: "Tail"))
    tail.click()
    let didSelectTail = await waitForSidebarSelection(tail)
    XCTAssertTrue(didSelectTail)
    try clickSidebarContextMenuItem("Collapse Group", on: sidebarGroupHeader(named: "Target"))
    let didCollapse = await wait(for: sidebarGroupHeader(named: "Target")) {
      ($0.value as? String) == "Collapsed"
    }
    XCTAssertTrue(didCollapse)
    XCTAssertFalse(sidebarStructuralTabRow(named: "Seed").exists)

    try drag(
      sidebarStructuralTabRow(named: "Collapsed Join"),
      to: sidebarGroupHeader(named: "Target"),
      destinationOffset: CGVector(dx: 0.5, dy: 0.2)
    )
    let didAddToCollapsedGroup = await wait(for: sidebarGroupHeader(named: "Target")) {
      $0.label.contains("3 tabs")
    }
    XCTAssertTrue(didAddToCollapsedGroup)

    try clickSidebarContextMenuItem("Expand Group", on: sidebarGroupHeader(named: "Target"))
    await requireSidebarStructure([
      .group("Target", children: ["Seed", "Expanded Join", "Collapsed Join"]),
      .tab("Tail"),
    ])
  }

  @MainActor
  func testNewTabFooterDropAppendsRootWithoutActivatingFooter() async throws {
    try await createNamedTabs(["First", "Second", "Third"])
    let newTab = try require(
      sidebarFooterRow(SupatermUITestIdentifier.Accessibility.sidebarNewTab)
    )

    try drag(sidebarStructuralTabRow(named: "First"), to: newTab)

    await requireSidebarStructure([
      .tab("Second"),
      .tab("Third"),
      .tab("First"),
    ])
    XCTAssertEqual(sidebarGroupHeaders.count, 0)
    XCTAssertTrue(
      sidebarFooterRow(SupatermUITestIdentifier.Accessibility.sidebarNewGroup).exists
    )
  }

  @MainActor
  private func requireSidebarStructure(
    _ expected: [SidebarRootExpectation],
    file: StaticString = #filePath,
    line: UInt = #line
  ) async {
    let didMatch = await waitForSidebarStructure(expected)
    XCTAssertTrue(
      didMatch,
      "Expected \(expected); actual \(sidebarStructureDescription())",
      file: file,
      line: line
    )
  }
}

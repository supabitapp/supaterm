import XCTest

final class TabGroupMembershipDragUITests: SupatermUITestCase {
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
      .group("Beta", children: ["Mover", "Beta Child"]),
    ])

    let betaHeader = try require(sidebarGroupHeader(named: "Beta"))
    try drag(
      sidebarStructuralTabRow(named: "Mover"),
      to: betaHeader,
      destinationOffset: CGVector(dx: 0.5, dy: 0.05)
    )

    await requireSidebarStructure([
      .group("Alpha", children: ["Alpha Child"]),
      .tab("Mover"),
      .group("Beta", children: ["Beta Child"]),
    ])
  }

  @MainActor
  func testGroupHeadersAcceptTabsWithoutChangingCollapseState() async throws {
    try await createNamedTabs(["Seed", "Expanded Join", "Collapsed Join", "Tail"])
    try await createGroup(named: "Target", containing: "Seed")

    try drag(
      sidebarStructuralTabRow(named: "Expanded Join"),
      to: sidebarGroupHeader(named: "Target")
    )
    await requireSidebarStructure([
      .group("Target", children: ["Expanded Join", "Seed"]),
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
      destinationOffset: CGVector(dx: 0.5, dy: 0.35)
    )
    let didAddToCollapsedGroup = await wait(
      for: sidebarGroupHeader(named: "Target")
    ) {
      $0.label.contains("3 tabs") && ($0.value as? String) == "Collapsed"
    }
    XCTAssertTrue(didAddToCollapsedGroup)
    XCTAssertFalse(sidebarStructuralTabRow(named: "Collapsed Join").exists)

    sidebarGroupHeader(named: "Target").click()
    await requireSidebarStructure([
      .group("Target", children: ["Collapsed Join", "Expanded Join", "Seed"]),
      .tab("Tail"),
    ])
  }
}

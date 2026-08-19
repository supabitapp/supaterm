import XCTest

final class TabRootDragUITests: SupatermUITestCase {
  @MainActor
  func testDroppingTabOnTabOnlyReordersRoots() async throws {
    try await createNamedTabs(["First", "Mover"])

    try drag(
      sidebarStructuralTabRow(named: "Mover"),
      to: sidebarStructuralTabRow(named: "First")
    )

    await requireSidebarStructure([
      .tab("Mover"),
      .tab("First"),
    ])
    XCTAssertEqual(sidebarGroupHeaders.count, 0)
  }

  @MainActor
  func testRootTabDropsBeforeFirstGroupAtLeadingEdge() async throws {
    try await createNamedTabs(["Group Seed", "Mover"])
    try await createGroup(named: "First", containing: "Group Seed")
    await requireSidebarStructure([
      .group("First", children: ["Group Seed"]),
      .tab("Mover"),
    ])

    let header = try require(sidebarGroupHeader(named: "First"))
    let beforeGroup = header.coordinate(
      withNormalizedOffset: CGVector(dx: 0.5, dy: 0)
    ).withOffset(CGVector(dx: 0, dy: 3))
    try drag(
      sidebarStructuralTabRow(named: "Mover"),
      to: beforeGroup
    )

    await requireSidebarStructure([
      .tab("Mover"),
      .group("First", children: ["Group Seed"]),
    ])
  }

  @MainActor
  func testRootTabDropsIntoExpandedGroup() async throws {
    try await createNamedTabs(["Group Seed", "Root A", "Root B"])
    try await createGroup(named: "Alpha", containing: "Group Seed")
    await requireSidebarStructure([
      .group("Alpha", children: ["Group Seed"]),
      .tab("Root A"),
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
  func testNewTabPinnedControlDropAppendsRootWithoutActivatingControl() async throws {
    try await createNamedTabs(["First", "Second", "Third"])
    let newTab = try require(
      sidebarPinnedControl(SupatermUITestIdentifier.Accessibility.sidebarNewTab)
    )

    try drag(sidebarStructuralTabRow(named: "First"), to: newTab)

    await requireSidebarStructure([
      .tab("Second"),
      .tab("Third"),
      .tab("First"),
    ])
    XCTAssertEqual(sidebarGroupHeaders.count, 0)
  }
}

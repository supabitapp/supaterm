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
    XCTAssertEqual(sidebarProjectHeaders.count, 0)
  }

  @MainActor
  func testUnassignedTabStaysAfterProjectsAtProjectLeadingEdge() async throws {
    try await createNamedTabs(["Project Seed", "Mover"])
    try await createProject(named: "First", containing: "Project Seed")
    await requireSidebarStructure([
      .project("First", children: ["Project Seed"]),
      .tab("Mover"),
    ])

    let header = try require(sidebarProjectHeader(named: "First"))
    let beforeProject = header.coordinate(
      withNormalizedOffset: CGVector(dx: 0.5, dy: 0)
    ).withOffset(CGVector(dx: 0, dy: 3))
    try drag(
      sidebarStructuralTabRow(named: "Mover"),
      to: beforeProject
    )

    await requireSidebarStructure([
      .project("First", children: ["Project Seed"]),
      .tab("Mover"),
    ])
  }

  @MainActor
  func testRootTabDropsIntoExpandedProject() async throws {
    try await createNamedTabs(["Project Seed", "Root A", "Root B"])
    try await createProject(named: "Alpha", containing: "Project Seed")
    await requireSidebarStructure([
      .project("Alpha", children: ["Project Seed"]),
      .tab("Root A"),
      .tab("Root B"),
    ])

    try drag(
      sidebarStructuralTabRow(named: "Root A"),
      to: sidebarProjectHeader(named: "Alpha")
    )

    await requireSidebarStructure([
      .project("Alpha", children: ["Project Seed", "Root A"]),
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
    XCTAssertEqual(sidebarProjectHeaders.count, 0)
  }
}

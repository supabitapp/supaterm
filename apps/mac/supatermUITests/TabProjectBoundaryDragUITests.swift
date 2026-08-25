import XCTest

final class TabProjectBoundaryDragUITests: SupatermUITestCase {
  @MainActor
  func testLastProjectTabDropsIntoUnassignedAndHidesEmptySection() async throws {
    try await createNamedTabs(["Root Before", "Only Child", "Root After"])
    try await createProject(named: "Solo", containing: "Only Child")
    await requireSidebarStructure([
      .tab("Root Before"),
      .project("Solo", children: ["Only Child"]),
      .tab("Root After"),
    ])

    try drag(
      sidebarStructuralTabRow(named: "Only Child"),
      to: sidebarPinnedControl(SupatermUITestIdentifier.Accessibility.sidebarNewTab)
    )

    await requireSidebarStructure([
      .tab("Root Before"),
      .tab("Root After"),
      .tab("Only Child"),
    ])
    XCTAssertEqual(sidebarProjectHeaders.count, 0)
  }

  @MainActor
  func testWholeProjectReordersThroughTheExistingHeaderDrag() async throws {
    try await createNamedTabs(["First Child", "Second Child", "Tail"])
    try await createProject(named: "First", containing: "First Child")
    try await createProject(named: "Second", containing: "Second Child")
    await requireSidebarStructure([
      .project("First", children: ["First Child"]),
      .project("Second", children: ["Second Child"]),
      .tab("Tail"),
    ])

    try drag(
      sidebarProjectHeader(named: "Second"),
      to: sidebarProjectHeader(named: "First"),
      destinationOffset: CGVector(dx: 0.5, dy: 0.1)
    )

    await requireSidebarStructure([
      .project("Second", children: ["Second Child"]),
      .project("First", children: ["First Child"]),
      .tab("Tail"),
    ])
  }
}

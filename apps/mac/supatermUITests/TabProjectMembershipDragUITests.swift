import XCTest

final class TabProjectMembershipDragUITests: SupatermUITestCase {
  @MainActor
  func testProjectTabMovesBetweenProjectAndUnassignedHeaders() async throws {
    try await createNamedTabs(["Alpha Child", "Beta Child", "Mover"])
    try await createProject(named: "Alpha", containing: "Alpha Child")
    try await createProject(named: "Beta", containing: "Beta Child")

    try drag(
      sidebarStructuralTabRow(named: "Mover"),
      to: sidebarProjectHeader(named: "Beta")
    )
    await requireSidebarStructure([
      .project("Alpha", children: ["Alpha Child"]),
      .project("Beta", children: ["Beta Child", "Mover"]),
    ])

    try drag(
      sidebarStructuralTabRow(named: "Mover"),
      to: sidebarUnassignedHeader
    )

    await requireSidebarStructure([
      .project("Alpha", children: ["Alpha Child"]),
      .tab("Mover"),
      .project("Beta", children: ["Beta Child"]),
    ])
  }

  @MainActor
  func testExpandedAndCollapsedProjectHeadersAcceptTabs() async throws {
    try await createNamedTabs(["Seed", "Expanded Join", "Collapsed Join", "Tail"])
    try await createProject(named: "Target", containing: "Seed")

    try drag(
      sidebarStructuralTabRow(named: "Expanded Join"),
      to: sidebarProjectHeader(named: "Target")
    )
    await requireSidebarStructure([
      .project("Target", children: ["Seed", "Expanded Join"]),
      .tab("Collapsed Join"),
      .tab("Tail"),
    ])

    let tail = try require(sidebarTabRow(named: "Tail"))
    tail.click()
    let didSelectTail = await waitForSidebarSelection(tail)
    XCTAssertTrue(didSelectTail)
    try clickSidebarContextMenuItem("Collapse Project", on: sidebarProjectHeader(named: "Target"))
    let didCollapse = await wait(for: sidebarProjectHeader(named: "Target")) {
      ($0.value as? String) == "Collapsed"
    }
    XCTAssertTrue(didCollapse)
    XCTAssertFalse(sidebarStructuralTabRow(named: "Seed").exists)

    try drag(
      sidebarStructuralTabRow(named: "Collapsed Join"),
      to: sidebarProjectHeader(named: "Target"),
      destinationOffset: CGVector(dx: 0.5, dy: 0.35)
    )
    let didAddAndExpandCollapsedProject = await wait(
      for: sidebarProjectHeader(named: "Target")
    ) {
      $0.label.contains("3 tabs") && ($0.value as? String) == "Expanded"
    }
    XCTAssertTrue(didAddAndExpandCollapsedProject)

    await requireSidebarStructure([
      .project("Target", children: ["Seed", "Expanded Join", "Collapsed Join"]),
      .tab("Tail"),
    ])
  }
}

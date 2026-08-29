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

  private static let fourTabTitles = [
    "A UI Tab",
    "B UI Tab",
    "C UI Tab",
    "D UI Tab",
  ]
}

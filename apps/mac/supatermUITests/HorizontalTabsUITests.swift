import XCTest

final class HorizontalTabsUITests: SupatermUITestCase {
  @MainActor
  func testLayoutSwitchKeepsTabSelectionInteractive() async throws {
    try await createNamedTabs(["First Layout Tab", "Second Layout Tab"])

    try clickMenuItem(.toggleTabLayout)

    let horizontalTabs = app.buttons.matching(
      NSPredicate(
        format: "identifier BEGINSWITH %@",
        SupatermUITestIdentifier.Accessibility.horizontalTabPrefix
      )
    )
    let didShowHorizontalTabs = await wait {
      horizontalTabs.count == 2 && !self.sidebarTabOutline.exists
    }
    XCTAssertTrue(didShowHorizontalTabs)

    let firstTab = horizontalTabs.matching(
      NSPredicate(format: "label CONTAINS %@", "First Layout Tab")
    ).firstMatch
    try require(firstTab)
    firstTab.click()
    let didSelectFirstTab = await wait(for: firstTab) { $0.isSelected }
    XCTAssertTrue(didSelectFirstTab)

    try clickMenuItem(.toggleTabLayout)

    let didRestoreSidebar = await wait {
      self.sidebarTabRows.count == 2
        && self.sidebarTabRow(named: "First Layout Tab").isSelected
    }
    XCTAssertTrue(didRestoreSidebar)
  }
}

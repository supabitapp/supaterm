import XCTest

final class TabLifecycleUITests: SupatermUITestCase {
  @MainActor
  func testNewAndCloseTabUpdateSidebarRows() async throws {
    await requireInitialSidebarTab()

    try clickMenuItem(.newTab)

    let didCreateTab = await waitForSidebarElementCount(
      sidebarTabRows,
      equals: 2,
      timeout: .seconds(30)
    )
    XCTAssertTrue(didCreateTab)

    try closeSelectedTab()

    let didCloseTab = await waitForSidebarElementCount(
      sidebarTabRows,
      equals: 1,
      timeout: .seconds(30)
    )
    XCTAssertTrue(didCloseTab)
  }

  @MainActor
  func testFreeTrialTabLimitShowsDialog() async throws {
    app.launchEnvironment["SUPATERM_LICENSE_MODE"] = "free"
    try relaunch()
    await requireInitialSidebarTab()

    for expectedCount in 2...5 {
      try clickMenuItem(.newTab)
      let didCreateTab = await waitForSidebarElementCount(
        sidebarTabRows,
        equals: expectedCount,
        timeout: .seconds(30)
      )
      XCTAssertTrue(didCreateTab)
    }

    try clickMenuItem(.newTab)
    let title = app.staticTexts["Free Trial Limit"]
    try require(title)
    attachAppScreenshot(named: "dialog-free-trial-tab-limit")

    let cancelButton = app.buttons[
      SupatermUITestIdentifier.Accessibility.dialogCancel
    ]
    try require(cancelButton).click()
    let didDismiss = await wait(for: title) { !$0.exists }
    XCTAssertTrue(didDismiss)
  }
}

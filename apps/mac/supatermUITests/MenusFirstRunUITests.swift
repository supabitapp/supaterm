import XCTest

final class MenusFirstRunUITests: SupatermUITestCase {
  @MainActor
  func testMenuBarStructure() throws {
    _ = mainWindow

    try assertMenu(
      "supaterm",
      exposes: [
        SupatermUITestIdentifier.MenuItemIdentifier.about.rawValue,
        SupatermUITestIdentifier.MenuItemIdentifier.settings.rawValue,
      ]
    )
    try assertMenu(
      "File",
      exposes: [
        SupatermUITestIdentifier.MenuItemIdentifier.newWindow.rawValue,
        SupatermUITestIdentifier.MenuItemIdentifier.newTab.rawValue,
        SupatermUITestIdentifier.MenuItemIdentifier.newTabInGroup.rawValue,
      ]
    )
    try assertMenu(
      "Edit",
      exposes: [
        SupatermUITestIdentifier.MenuItemIdentifier.copy.rawValue,
        SupatermUITestIdentifier.MenuItemIdentifier.paste.rawValue,
      ]
    )
    try assertMenu(
      "View",
      exposes: [
        SupatermUITestIdentifier.MenuItemIdentifier.toggleSidebar.rawValue,
        SupatermUITestIdentifier.MenuItemIdentifier.changeTabTitle.rawValue,
      ]
    )
    try assertMenu(
      "Tabs",
      exposes: [
        SupatermUITestIdentifier.MenuItemIdentifier.nextTab.rawValue,
        SupatermUITestIdentifier.MenuItemIdentifier.selectLastTab.rawValue,
      ]
    )
    try assertMenu(
      "Spaces",
      exposes: [
        SupatermUITestIdentifier.MenuItemIdentifier.firstSpace.rawValue,
        SupatermUITestIdentifier.MenuItemIdentifier.secondSpace.rawValue,
      ]
    )
    try assertMenu(
      "Window",
      exposes: [
        SupatermUITestIdentifier.MenuItemIdentifier.zoomSplit.rawValue,
        SupatermUITestIdentifier.MenuItemIdentifier.nextSplit.rawValue,
      ]
    )
    try assertMenu(
      "Help",
      exposes: [
        SupatermUITestIdentifier.MenuItemIdentifier.changelog.rawValue,
        SupatermUITestIdentifier.MenuItemIdentifier.submitGitHubIssue.rawValue,
      ]
    )
  }

  @MainActor
  func testPinMenuFollowsSelectedTabState() async throws {
    _ = mainWindow

    let tabRow = sidebarTabRows.firstMatch
    guard tabRow.waitForExistence(timeout: 30) else {
      XCTFail("Initial sidebar tab row did not appear")
      return
    }

    tabRow.rightClick()
    let pin = app.menuItems["Pin Tab"]
    XCTAssertTrue(pin.waitForExistence(timeout: 10))
    XCTAssertTrue(pin.isEnabled)
    XCTAssertFalse(app.menuItems["Unpin Tab"].exists)
    pin.click()

    let didMoveToPinnedSection = await wait(for: tabRow) { row in
      row.exists && row.label.contains("Pinned")
    }
    XCTAssertTrue(didMoveToPinnedSection)

    tabRow.rightClick()
    let unpin = app.menuItems["Unpin Tab"]
    XCTAssertTrue(unpin.waitForExistence(timeout: 10))
    XCTAssertTrue(unpin.isEnabled)
    XCTAssertFalse(pin.exists)
  }

  @MainActor
  func testSecondSpaceMenuItemBecomesEnabledAfterCreatingSpace() async throws {
    _ = mainWindow

    try openMenu("Spaces")
    let secondSpace = rawMenuItem(
      SupatermUITestIdentifier.MenuItemIdentifier.secondSpace.rawValue
    )
    XCTAssertTrue(secondSpace.waitForExistence(timeout: 10))
    XCTAssertFalse(secondSpace.isEnabled)
    app.typeKey(.escape, modifierFlags: [])

    let terminal = app.textViews.firstMatch
    XCTAssertTrue(terminal.waitForExistence(timeout: 30))
    terminal.click()
    app.typeText("sp space new Second\n")

    let spaceButtons = app.buttons.matching(
      identifier: SupatermUITestIdentifier.Accessibility.sidebarSpaceButton
    )
    let didCreateSecondSpace = await wait(
      for: spaceButtons.element(boundBy: 1),
      timeout: .seconds(30)
    ) { $0.exists }
    XCTAssertTrue(didCreateSecondSpace)

    try openMenu("Spaces")
    let didEnableSecondSpace = await wait(for: secondSpace) {
      $0.exists && $0.isEnabled
    }
    XCTAssertTrue(didEnableSecondSpace)
  }

  @MainActor
  func testOnlyFirstLaunchRunsOnboarding() async throws {
    try relaunch(removing: ["launch-state.json", "session.json"])

    _ = mainWindow

    let firstTerminal = app.textViews.firstMatch
    XCTAssertTrue(firstTerminal.waitForExistence(timeout: 30))
    let didRenderOnboarding = await wait(
      for: firstTerminal,
      timeout: .seconds(30)
    ) { terminal in
      (terminal.value as? String)?.contains("Welcome to Supaterm!") == true
    }
    XCTAssertTrue(didRenderOnboarding)

    let launchState = stateHome.appendingPathComponent("launch-state.json")
    let didPersistLaunchState = await waitForFile(at: launchState)
    XCTAssertTrue(didPersistLaunchState)

    try relaunch(removing: ["session.json"])

    let secondTerminal = app.textViews.firstMatch
    XCTAssertTrue(secondTerminal.waitForExistence(timeout: 30))
    secondTerminal.click()
    app.typeText("/usr/bin/printf 'second-launch-%s\\n' ready\n")

    let didStartShell = await wait(
      for: secondTerminal,
      timeout: .seconds(30)
    ) { terminal in
      (terminal.value as? String)?.contains("second-launch-ready") == true
    }
    XCTAssertTrue(didStartShell)
    XCTAssertFalse((secondTerminal.value as? String)?.contains("Welcome to Supaterm!") == true)
  }

  @MainActor
  private func assertMenu(_ title: String, exposes identifiers: [String]) throws {
    try openMenu(title)
    for identifier in identifiers {
      XCTAssertTrue(
        rawMenuItem(identifier).waitForExistence(timeout: 10),
        "\(title) menu did not expose \(identifier)"
      )
    }
    app.typeKey(.escape, modifierFlags: [])
  }

  @MainActor
  private func openMenu(_ title: String) throws {
    let menu = app.menuBars.menuBarItems[title]
    try require(menu)
    menu.click()
  }

  @MainActor
  private func rawMenuItem(_ identifier: String) -> XCUIElement {
    app.menuItems.matching(identifier: identifier).firstMatch
  }

  @MainActor
  private func waitForFile(
    at url: URL,
    timeout: Duration = .seconds(10)
  ) async -> Bool {
    await wait(timeout: timeout) {
      FileManager.default.fileExists(atPath: url.path)
    }
  }
}

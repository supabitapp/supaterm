import XCTest

final class MenusFirstRunUITests: SupatermUITestCase {
  private enum MenuItemIdentifier {
    static let firstSpace = "app.supabit.supaterm.spaces.select.1"
    static let secondSpace = "app.supabit.supaterm.spaces.select.2"
  }

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
        MenuItemIdentifier.firstSpace,
        MenuItemIdentifier.secondSpace,
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

    let tabRow = app.buttons.matching(
      identifier: SupatermUITestIdentifier.Accessibility.sidebarTabRow
    ).firstMatch
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

    let pinnedSection = app.descendants(matching: .any).matching(
      identifier: SupatermUITestIdentifier.Accessibility.sidebarPinnedSection
    ).firstMatch
    let didMoveToPinnedSection = await wait(for: pinnedSection) { section in
      section.descendants(matching: .button).matching(
        identifier: SupatermUITestIdentifier.Accessibility.sidebarTabRow
      ).firstMatch.exists
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
    let secondSpace = rawMenuItem(MenuItemIdentifier.secondSpace)
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
    let stateHome = try XCTUnwrap(app.launchEnvironment["SUPATERM_STATE_HOME"])
    let stateHomeURL = URL(fileURLWithPath: stateHome)
    try relaunch(at: stateHomeURL, removing: ["launch-state.json", "session.json"])

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

    let launchState = stateHomeURL.appendingPathComponent("launch-state.json")
    let didPersistLaunchState = await waitForFile(at: launchState)
    XCTAssertTrue(didPersistLaunchState)

    try relaunch(at: stateHomeURL, removing: ["session.json"])

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
    _ = try XCTUnwrap(menu.waitForExistence(timeout: 10) ? menu : nil)
    menu.click()
  }

  @MainActor
  private func rawMenuItem(_ identifier: String) -> XCUIElement {
    app.menuItems.matching(identifier: identifier).firstMatch
  }

  private func waitForFile(
    at url: URL,
    timeout: Duration = .seconds(10),
    pollInterval: Duration = .milliseconds(100)
  ) async -> Bool {
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: timeout)
    while clock.now < deadline {
      if FileManager.default.fileExists(atPath: url.path) {
        return true
      }
      try? await Task.sleep(for: pollInterval)
    }
    return FileManager.default.fileExists(atPath: url.path)
  }

  @MainActor
  private func relaunch(at stateHome: URL, removing filenames: [String]) throws {
    app.terminate()
    XCTAssertTrue(app.wait(for: .notRunning, timeout: 10))

    for filename in filenames {
      let file = stateHome.appendingPathComponent(filename)
      if FileManager.default.fileExists(atPath: file.path) {
        try FileManager.default.removeItem(at: file)
      }
    }

    app.launch()
    app.activate()
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 30))
  }
}

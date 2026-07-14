import XCTest

class SupatermUITestCase: XCTestCase {
  private(set) var app: XCUIApplication!

  override func setUp() async throws {
    try await super.setUp()
    continueAfterFailure = false

    let token = UUID().uuidString
    let stateHome = FileManager.default.temporaryDirectory
      .appendingPathComponent("supaterm-ui-\(token)", isDirectory: true)
    let home = stateHome.appendingPathComponent("home", isDirectory: true)
    let zmx = stateHome.appendingPathComponent("zmx", isDirectory: true)
    try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: zmx, withIntermediateDirectories: true)

    let app = await MainActor.run {
      let app = XCUIApplication()
      app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
      app.launchEnvironment = [
        "HOME": home.path,
        "SUPATERM_INSTANCE_NAME": "ui-\(token)",
        "SUPATERM_STATE_HOME": stateHome.path,
        "ZMX_DIR": zmx.path,
      ]
      app.launch()
      app.activate()
      return app
    }
    self.app = app

    addTeardownBlock {
      await MainActor.run {
        app.terminate()
      }
      try? FileManager.default.removeItem(at: stateHome)
    }
  }

  @MainActor
  var mainWindow: XCUIElement {
    let window = app.windows.firstMatch
    XCTAssertTrue(window.waitForExistence(timeout: 30))
    return window
  }

  @MainActor
  func menuItem(_ identifier: SupatermUITestIdentifier.MenuItemIdentifier) -> XCUIElement {
    app.menuItems.matching(identifier: identifier.rawValue).firstMatch
  }

  @MainActor
  func clickMenuItem(
    _ identifier: SupatermUITestIdentifier.MenuItemIdentifier,
    timeout: TimeInterval = 10
  ) {
    let topLevelMenu = app.menuBars.menuItems[identifier.menuTitle]
    XCTAssertTrue(topLevelMenu.waitForExistence(timeout: timeout))
    topLevelMenu.click()

    let item = menuItem(identifier)
    XCTAssertTrue(item.waitForExistence(timeout: timeout))
    item.click()
  }

  @MainActor
  func wait(
    for element: XCUIElement,
    timeout: Duration = .seconds(10),
    pollInterval: Duration = .milliseconds(100),
    until condition: (XCUIElement) -> Bool
  ) async -> Bool {
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: timeout)
    while clock.now < deadline {
      if condition(element) {
        return true
      }
      try? await Task.sleep(for: pollInterval)
    }
    return condition(element)
  }
}

import Foundation
import XCTest

class SupatermUITestCase: XCTestCase {
  private(set) var app: XCUIApplication!

  var stateHome: URL {
    guard let path = app.launchEnvironment["SUPATERM_STATE_HOME"] else {
      preconditionFailure("Missing SUPATERM_STATE_HOME")
    }
    return URL(fileURLWithPath: path, isDirectory: true)
  }

  var sessionFileURL: URL {
    stateHome.appendingPathComponent("session.json")
  }

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
    try Data("0".utf8).write(to: stateHome.appendingPathComponent("launch-state.json"))

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
  var mainTerminal: XCUIElement {
    _ = mainWindow
    let terminal = app.textViews.firstMatch
    XCTAssertTrue(terminal.waitForExistence(timeout: 30))
    return terminal
  }

  @MainActor
  func menuItem(_ identifier: SupatermUITestIdentifier.MenuItemIdentifier) -> XCUIElement {
    app.menuItems.matching(identifier: identifier.rawValue).firstMatch
  }

  @MainActor
  func clickMenuItem(
    _ identifier: SupatermUITestIdentifier.MenuItemIdentifier,
    timeout: TimeInterval = 10
  ) throws {
    let topLevelMenu = app.menuBars.menuBarItems[identifier.menuTitle]
    try require(topLevelMenu, timeout: timeout)
    topLevelMenu.click()

    let item = menuItem(identifier)
    try require(item, timeout: timeout)
    item.click()
  }

  @MainActor
  @discardableResult
  func require(
    _ element: XCUIElement,
    timeout: TimeInterval = 10,
    _ message: @autoclosure () -> String = "",
    file: StaticString = #filePath,
    line: UInt = #line
  ) throws -> XCUIElement {
    try XCTUnwrap(
      element.waitForExistence(timeout: timeout) ? element : nil,
      message(),
      file: file,
      line: line
    )
  }

  @MainActor
  func element(_ identifier: String, in container: XCUIElement? = nil) -> XCUIElement {
    if let container {
      return container.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }
    return app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }

  @MainActor
  func relaunch(removing filenames: [String] = []) throws {
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

  @MainActor
  func wait(
    timeout: Duration = .seconds(10),
    pollInterval: Duration = .milliseconds(100),
    until condition: () -> Bool
  ) async -> Bool {
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: timeout)
    while clock.now < deadline {
      if condition() {
        return true
      }
      try? await Task.sleep(for: pollInterval)
    }
    return condition()
  }

  @MainActor
  func wait(
    for element: XCUIElement,
    timeout: Duration = .seconds(10),
    pollInterval: Duration = .milliseconds(100),
    until condition: (XCUIElement) -> Bool
  ) async -> Bool {
    await wait(timeout: timeout, pollInterval: pollInterval) {
      condition(element)
    }
  }
}

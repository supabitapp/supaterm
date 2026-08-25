import Foundation
import SupatermSupport
import XCTest

class SupatermUITestCase: XCTestCase {
  @MainActor
  private final class UICondition {
    let evaluate: () -> Bool

    init(_ evaluate: @escaping () -> Bool) {
      self.evaluate = evaluate
    }
  }

  private(set) var app: XCUIApplication!

  @MainActor
  var stateHome: URL {
    guard let path = app.launchEnvironment["SUPATERM_STATE_HOME"] else {
      preconditionFailure("Missing SUPATERM_STATE_HOME")
    }
    return URL(fileURLWithPath: path, isDirectory: true)
  }

  @MainActor
  var sessionFileURL: URL {
    stateHome.appendingPathComponent("session.json")
  }

  override func setUp() async throws {
    try await super.setUp()
    continueAfterFailure = false

    let temporaryDirectory = FileManager.default.temporaryDirectory
    try SessionHostTestWorkspace.reapAbandoned(
      in: temporaryDirectory,
      stateHomePrefix: "supaterm-ui-",
      instanceNamePrefix: "ui-"
    )

    let token = UUID().uuidString
    let instanceName = "ui-\(token)"
    let stateHome =
      temporaryDirectory
      .appendingPathComponent("supaterm-ui-\(token)", isDirectory: true)
    let workspace = try SessionHostTestWorkspace(stateHome: stateHome, instanceName: instanceName)
    try FileManager.default.createDirectory(
      at: workspace.sessionHostDirectory,
      withIntermediateDirectories: true
    )
    let home = stateHome.appendingPathComponent("home", isDirectory: true)
    try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
    try Data("0".utf8).write(to: stateHome.appendingPathComponent("launch-state.json"))
    try Data(#"{"acknowledgedVersion":"999999999.0.0"}"#.utf8).write(
      to: stateHome.appendingPathComponent("release-announcements.json")
    )

    let app = await MainActor.run {
      let app = XCUIApplication()
      app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
      app.launchEnvironment = [
        "HOME": home.path,
        "SUPATERM_INSTANCE_NAME": instanceName,
        "SUPATERM_STATE_HOME": stateHome.path,
        "SUPATERM_VERBOSE_LOGGING": "1",
        SessionHostEnvironment.disabledKey: "1",
        SessionHostEnvironment.directoryKey: workspace.sessionHostDirectory.path,
      ]
      return app
    }
    self.app = app

    addTeardownBlock {
      let stopped = await MainActor.run { () -> Bool in
        guard app.state != .notRunning else { return true }
        app.terminate()
        return app.wait(for: .notRunning, timeout: 10)
      }
      XCTAssertTrue(stopped)
      guard stopped else { return }
      try workspace.cleanup()
    }

    await MainActor.run {
      app.launch()
      app.activate()
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
    until condition: @escaping () -> Bool
  ) async -> Bool {
    guard !condition() else { return true }

    let components = timeout.components
    let seconds =
      TimeInterval(components.seconds)
      + TimeInterval(components.attoseconds) / 1e18
    let condition = UICondition(condition)
    let expectation = XCTestExpectation(description: "UI state")
    let timer = Timer(timeInterval: 0.1, repeats: true) { timer in
      let isSatisfied = MainActor.assumeIsolated { condition.evaluate() }
      guard isSatisfied else { return }
      timer.invalidate()
      expectation.fulfill()
    }
    RunLoop.main.add(timer, forMode: .common)
    let result = await XCTWaiter.fulfillment(of: [expectation], timeout: seconds)
    timer.invalidate()
    return result == .completed || condition.evaluate()
  }

  @MainActor
  func wait(
    for element: XCUIElement,
    timeout: Duration = .seconds(10),
    until condition: @escaping (XCUIElement) -> Bool
  ) async -> Bool {
    await wait(timeout: timeout) {
      condition(element)
    }
  }

  @MainActor
  func assertEventually(
    _ element: XCUIElement,
    timeout: Duration = .seconds(10),
    file: StaticString = #filePath,
    line: UInt = #line,
    until condition: @escaping (XCUIElement) -> Bool
  ) async {
    let didMatch = await wait(for: element, timeout: timeout, until: condition)
    XCTAssertTrue(didMatch, file: file, line: line)
  }

}

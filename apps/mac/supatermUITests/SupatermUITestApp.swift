import Foundation
import XCTest

struct SupatermUITestApp {
  let app: XCUIApplication
  let stateHome: URL

  var sessionFileURL: URL {
    stateHome.appendingPathComponent("session.json")
  }

  static func makeIsolated() throws -> SupatermUITestApp {
    let token = UUID().uuidString
    let stateHome = FileManager.default.temporaryDirectory
      .appendingPathComponent("supaterm-ui-\(token)", isDirectory: true)
    let home = stateHome.appendingPathComponent("home", isDirectory: true)
    let zmx = stateHome.appendingPathComponent("zmx", isDirectory: true)
    try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: zmx, withIntermediateDirectories: true)
    try Data("0".utf8).write(to: stateHome.appendingPathComponent("launch-state.json"))

    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment = [
      "HOME": home.path,
      "SUPATERM_INSTANCE_NAME": "ui-\(token)",
      "SUPATERM_STATE_HOME": stateHome.path,
      "ZMX_DIR": zmx.path,
    ]
    return SupatermUITestApp(app: app, stateHome: stateHome)
  }

  @MainActor
  func launchAndWaitForTerminal() -> XCUIElement {
    app.launch()
    app.activate()
    XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 30))
    let terminal = app.textViews.firstMatch
    XCTAssertTrue(terminal.waitForExistence(timeout: 30))
    return terminal
  }
}

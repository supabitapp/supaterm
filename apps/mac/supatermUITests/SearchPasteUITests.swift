import AppKit
import XCTest

final class SearchPasteUITests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
  }

  @MainActor
  func testUserCanPasteIntoSearchAfterReactivatingApp() async throws {
    let token = UUID().uuidString
    let stateHome = FileManager.default.temporaryDirectory
      .appendingPathComponent("supaterm-ui-\(token)", isDirectory: true)
    let home = stateHome.appendingPathComponent("home", isDirectory: true)
    let zmx = stateHome.appendingPathComponent("zmx", isDirectory: true)
    let pasteboardItems = pasteboardSnapshot()
    try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: zmx, withIntermediateDirectories: true)

    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launchEnvironment = [
      "HOME": home.path,
      "SUPATERM_INSTANCE_NAME": "ui-\(token)",
      "SUPATERM_STATE_HOME": stateHome.path,
      "ZMX_DIR": zmx.path,
    ]
    addTeardownBlock {
      app.terminate()
      NSPasteboard.general.clearContents()
      _ = NSPasteboard.general.writeObjects(pasteboardItems)
      try? FileManager.default.removeItem(at: stateHome)
    }

    app.launch()
    app.activate()
    XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 30))
    let terminal = app.textViews.firstMatch
    XCTAssertTrue(terminal.waitForExistence(timeout: 30))
    terminal.click()

    let readinessText = "search focus ready"
    let terminalText = try XCTUnwrap(terminal.value as? String)
    app.typeKey("f", modifierFlags: .command)
    try await Task.sleep(for: .milliseconds(200))
    app.typeText(readinessText)
    XCTAssertEqual(terminal.value as? String, terminalText)
    replacePasteboard(with: "readiness sentinel")
    app.typeKey("a", modifierFlags: .command)
    app.typeKey("c", modifierFlags: .command)
    XCTAssertEqual(NSPasteboard.general.string(forType: .string), readinessText)
    app.typeKey(.delete, modifierFlags: [])

    let pastedText = "search paste regression"
    replacePasteboard(with: pastedText)

    try await reactivate(app)

    app.typeKey("v", modifierFlags: .command)
    try await Task.sleep(for: .milliseconds(500))
    XCTAssertEqual(terminal.value as? String, terminalText)

    replacePasteboard(with: "verification sentinel")
    app.typeKey("a", modifierFlags: .command)
    app.typeKey("c", modifierFlags: .command)

    XCTAssertEqual(NSPasteboard.general.string(forType: .string), pastedText)

    app.typeKey(.escape, modifierFlags: [])
    try await reactivate(app)

    let terminalInput = "terminal focus restored"
    app.typeText(terminalInput)
    try await Task.sleep(for: .milliseconds(500))
    XCTAssertEqual(terminal.value as? String, terminalText + terminalInput)
  }

  @MainActor
  private func reactivate(_ app: XCUIApplication) async throws {
    let finder = XCUIApplication(bundleIdentifier: "com.apple.finder")
    finder.activate()
    XCTAssertTrue(finder.wait(for: .runningForeground, timeout: 5))
    app.activate()
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 5))
    try await Task.sleep(for: .milliseconds(200))
  }

  @MainActor
  private func replacePasteboard(with string: String) {
    NSPasteboard.general.clearContents()
    XCTAssertTrue(NSPasteboard.general.setString(string, forType: .string))
  }

  private func pasteboardSnapshot() -> [NSPasteboardItem] {
    NSPasteboard.general.pasteboardItems?.map { item in
      let snapshot = NSPasteboardItem()
      for type in item.types {
        if let data = item.data(forType: type) {
          snapshot.setData(data, forType: type)
        }
      }
      return snapshot
    } ?? []
  }
}

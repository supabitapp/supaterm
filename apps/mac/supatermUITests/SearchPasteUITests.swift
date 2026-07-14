import AppKit
import XCTest

final class SearchPasteUITests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
  }

  @MainActor
  func testUserCanPasteIntoSearchAfterReactivatingApp() async throws {
    let harness = try SupatermUITestApp.makeIsolated()
    let app = harness.app
    let stateHome = harness.stateHome
    let pasteboardItems = pasteboardSnapshot()
    addTeardownBlock {
      app.terminate()
      NSPasteboard.general.clearContents()
      _ = NSPasteboard.general.writeObjects(pasteboardItems)
      try? FileManager.default.removeItem(at: stateHome)
    }

    let terminal = harness.launchAndWaitForTerminal()
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

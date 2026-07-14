import Foundation
import XCTest

final class SessionRestoreUITests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
  }

  @MainActor
  func testLayoutAndSessionsSurviveQuitAndRelaunch() async throws {
    let harness = try SupatermUITestApp.makeIsolated()
    let app = harness.app
    let stateHome = harness.stateHome
    addTeardownBlock {
      app.terminate()
      try? FileManager.default.removeItem(at: stateHome)
    }

    let terminal = harness.launchAndWaitForTerminal()
    terminal.click()

    app.typeKey("d", modifierFlags: .command)
    try await waitForPaneCount(app, 2)
    app.typeKey("d", modifierFlags: [.command, .shift])
    try await waitForPaneCount(app, 3)

    app.typeKey("t", modifierFlags: .command)
    try await waitForPaneCount(app, 1)
    app.typeKey("d", modifierFlags: .command)
    try await waitForPaneCount(app, 2)

    let token = UUID().uuidString
    let marker = "restore-\(token)"
    try await Task.sleep(for: .milliseconds(500))
    app.typeText("echo \"re\"store-\(token)\n")
    try await waitForPaneValue(app, containing: marker)

    let savedLayout = try await waitForSessionLayout(at: harness.sessionFileURL) { layout in
      layout.selectedTabIndex == 1
        && layout.tabs.count == 2
        && layout.tabs[0].leafIDs.count == 3
        && layout.tabs[1].leafIDs.count == 2
    }

    quit(app, returnModifiers: [])

    app.launch()
    app.activate()
    XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 30))
    try await waitForPaneCount(app, 2)
    try await waitForPaneValue(app, containing: marker)
    try await waitForSessionLayout(at: harness.sessionFileURL) { $0 == savedLayout }

    quit(app, returnModifiers: .shift)
  }

  @MainActor
  private func quit(
    _ app: XCUIApplication,
    returnModifiers: XCUIElement.KeyModifierFlags
  ) {
    app.typeKey("q", modifierFlags: .command)
    XCTAssertTrue(app.buttons["Quit"].waitForExistence(timeout: 10))
    app.typeKey(.return, modifierFlags: returnModifiers)
    XCTAssertTrue(app.wait(for: .notRunning, timeout: 30))
  }

  @MainActor
  private func waitForPaneCount(
    _ app: XCUIApplication,
    _ expected: Int,
    timeout: TimeInterval = 30
  ) async throws {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if app.textViews.count == expected { return }
      try await Task.sleep(for: .milliseconds(200))
    }
    XCTAssertEqual(app.textViews.count, expected)
  }

  @MainActor
  private func waitForPaneValue(
    _ app: XCUIApplication,
    containing marker: String,
    timeout: TimeInterval = 30
  ) async throws {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      let values = app.textViews.allElementsBoundByIndex.compactMap { $0.value as? String }
      if values.contains(where: { $0.contains(marker) }) { return }
      try await Task.sleep(for: .milliseconds(200))
    }
    XCTFail("No pane shows \(marker)")
  }

  @discardableResult
  private func waitForSessionLayout(
    at url: URL,
    timeout: TimeInterval = 30,
    matching predicate: (SessionLayout) -> Bool
  ) async throws -> SessionLayout {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if let layout = sessionLayout(at: url), predicate(layout) {
        return layout
      }
      try await Task.sleep(for: .milliseconds(200))
    }
    let lastLayout = sessionLayout(at: url)
    return try XCTUnwrap(
      lastLayout.flatMap { predicate($0) ? $0 : nil },
      "Timed out waiting for session layout, last saw \(String(describing: lastLayout))"
    )
  }

  private func sessionLayout(at url: URL) -> SessionLayout? {
    guard
      let data = try? Data(contentsOf: url),
      let catalog = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let windows = catalog["windows"] as? [[String: Any]],
      windows.count == 1,
      let spaces = windows[0]["spaces"] as? [[String: Any]],
      spaces.count == 1,
      let tabs = spaces[0]["tabs"] as? [[String: Any]]
    else { return nil }
    return SessionLayout(
      selectedTabIndex: spaces[0]["selectedTabIndex"] as? Int,
      tabs: tabs.compactMap { tab in
        guard let root = tab["root"] as? [String: Any] else { return nil }
        var leafIDs: [String] = []
        var splitDirections: [String] = []
        flatten(root, into: &leafIDs, &splitDirections)
        return SessionTabLayout(leafIDs: leafIDs, splitDirections: splitDirections)
      }
    )
  }

  private func flatten(
    _ node: [String: Any],
    into leafIDs: inout [String],
    _ splitDirections: inout [String]
  ) {
    if let leaf = node["leaf"] as? [String: Any], let id = leaf["id"] as? String {
      leafIDs.append(id)
    }
    guard let split = node["split"] as? [String: Any] else { return }
    splitDirections.append(split["direction"] as? String ?? "")
    if let left = split["left"] as? [String: Any] {
      flatten(left, into: &leafIDs, &splitDirections)
    }
    if let right = split["right"] as? [String: Any] {
      flatten(right, into: &leafIDs, &splitDirections)
    }
  }
}

private struct SessionLayout: Equatable {
  let selectedTabIndex: Int?
  let tabs: [SessionTabLayout]
}

private struct SessionTabLayout: Equatable {
  let leafIDs: [String]
  let splitDirections: [String]
}

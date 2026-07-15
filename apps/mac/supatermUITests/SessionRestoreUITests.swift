import Foundation
import XCTest

final class SessionRestoreUITests: SupatermUITestCase {
  @MainActor
  func testWindowFrameSurvivesQuitAndRelaunch() async throws {
    _ = mainWindow
    let terminal = mainTerminal
    terminal.click()
    let defaultFrame = app.windows.firstMatch.frame

    quit(app, returnModifiers: [])

    let data = try Data(contentsOf: sessionFileURL)
    var catalog = try XCTUnwrap(
      JSONSerialization.jsonObject(with: data) as? [String: Any]
    )
    var windows = try XCTUnwrap(catalog["windows"] as? [[String: Any]])
    XCTAssertEqual(windows.count, 1)
    let savedFrame = try XCTUnwrap(windows.first?["frame"] as? [String: Any])
    let savedWidth = try XCTUnwrap(savedFrame["width"] as? Double)
    let savedHeight = try XCTUnwrap(savedFrame["height"] as? Double)
    XCTAssertEqual(savedWidth, defaultFrame.width, accuracy: 1)
    XCTAssertEqual(savedHeight, defaultFrame.height, accuracy: 1)

    windows[0]["frame"] = [
      "x": 60.0,
      "y": 60.0,
      "width": 1_180.0,
      "height": 760.0,
    ]
    catalog["windows"] = windows
    let mutatedData = try JSONSerialization.data(withJSONObject: catalog, options: [.sortedKeys])
    try mutatedData.write(to: sessionFileURL, options: .atomic)

    app.launch()
    app.activate()
    let restoredWindow = app.windows.firstMatch
    XCTAssertTrue(restoredWindow.waitForExistence(timeout: 30))
    let didRestoreFrame = await wait(
      for: restoredWindow,
      timeout: .seconds(30)
    ) { window in
      let frame = window.frame
      return abs(frame.width - 1_180) <= 1
        && abs(frame.height - 760) <= 1
        && abs(frame.minX - 60) <= 1
    }
    XCTAssertTrue(didRestoreFrame)
    let restoredFrame = restoredWindow.frame
    XCTAssertEqual(restoredFrame.width, 1_180, accuracy: 1)
    XCTAssertEqual(restoredFrame.height, 760, accuracy: 1)
    XCTAssertEqual(restoredFrame.minX, 60, accuracy: 1)
    XCTAssertNotEqual(restoredFrame.size, defaultFrame.size)

    quit(app, returnModifiers: .shift)
  }

  @MainActor
  func testSelectedPinnedTabStaysSelectedAfterRelaunch() async throws {
    _ = mainWindow
    let didShowInitialTab = await waitForCount(tabRows, equals: 1, timeout: .seconds(30))
    XCTAssertTrue(didShowInitialTab)

    let pinnedSection = app.descendants(matching: .any).matching(
      identifier: SupatermUITestIdentifier.Accessibility.sidebarPinnedSection
    ).firstMatch
    let regularSection = app.descendants(matching: .any).matching(
      identifier: SupatermUITestIdentifier.Accessibility.sidebarRegularSection
    ).firstMatch
    let pinnedRows = pinnedSection.descendants(matching: .button).matching(
      identifier: SupatermUITestIdentifier.Accessibility.sidebarTabRow
    )
    let regularRows = regularSection.descendants(matching: .button).matching(
      identifier: SupatermUITestIdentifier.Accessibility.sidebarTabRow
    )
    let pinnedRow = pinnedRows.firstMatch
    let regularRow = regularRows.firstMatch

    try clickContextMenuItem("Pin Tab", on: tabRows.firstMatch)
    let didPinInitialTab = await wait(for: pinnedRow, timeout: .seconds(30)) { row in
      row.exists && regularRows.count < 1
    }
    XCTAssertTrue(didPinInitialTab)

    try clickMenuItem(.newTab)
    let didCreateRegularTab = await wait(for: regularRow, timeout: .seconds(30)) { row in
      row.exists && row.isSelected
    }
    XCTAssertTrue(didCreateRegularTab)

    pinnedRow.click()
    let didSelectPinnedTab = await wait(for: pinnedRow) { $0.isSelected }
    XCTAssertTrue(didSelectPinnedTab)
    XCTAssertFalse(regularRow.isSelected)

    let pinnedTabsURL = stateHome.appendingPathComponent("pinned-tabs.json")
    let didSavePinnedSelection = await waitForSessionCatalog(at: sessionFileURL) { catalog in
      guard
        let windows = catalog["windows"] as? [[String: Any]],
        windows.count == 1,
        let spaces = windows[0]["spaces"] as? [[String: Any]],
        spaces.count == 1
      else { return false }
      return spaces[0]["selectedPinnedTabID"] is String
        && spaces[0]["selectedTabIndex"] == nil
        && FileManager.default.fileExists(atPath: pinnedTabsURL.path)
    }
    XCTAssertTrue(didSavePinnedSelection)

    quit(app, returnModifiers: [])

    app.launch()
    app.activate()
    XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 30))
    let didRestoreTabs = await wait(for: pinnedRow, timeout: .seconds(30)) { row in
      row.exists && regularRow.exists
    }
    XCTAssertTrue(didRestoreTabs)
    let didRestorePinnedSelection = await wait(for: pinnedRow, timeout: .seconds(30)) {
      $0.isSelected
    }
    XCTAssertTrue(didRestorePinnedSelection)
    XCTAssertFalse(regularRow.isSelected)

    quit(app, returnModifiers: .shift)
  }

  @MainActor
  func testManualTabAndTerminalTitlesSurviveQuitAndRelaunch() async throws {
    let terminal = mainTerminal
    XCTAssertTrue(terminal.waitForExistence(timeout: 30))
    terminal.click()
    let didShowInitialTab = await waitForCount(tabRows, equals: 1, timeout: .seconds(30))
    XCTAssertTrue(didShowInitialTab)

    let paneTitle = "pane-\(UUID().uuidString)"
    try await changeTitle(
      to: paneTitle,
      with: .changeTerminalTitle,
      heading: "Change Terminal Title"
    )
    let didShowPaneTitle = await waitForTabTitle(paneTitle)
    XCTAssertTrue(didShowPaneTitle)

    app.typeKey("t", modifierFlags: .command)
    let didCreateSecondTab = await waitForCount(tabRows, equals: 2, timeout: .seconds(30))
    XCTAssertTrue(didCreateSecondTab)

    let tabTitle = "tab-\(UUID().uuidString)"
    try await changeTitle(
      to: tabTitle,
      with: .changeTabTitle,
      heading: "Change Tab Title"
    )
    let didShowTabTitle = await waitForTabTitle(tabTitle)
    XCTAssertTrue(didShowTabTitle)

    let didSaveTitles = await waitForFile(at: sessionFileURL) { data in
      guard let contents = String(data: data, encoding: .utf8) else { return false }
      return contents.contains(paneTitle) && contents.contains(tabTitle)
    }
    XCTAssertTrue(didSaveTitles)

    quit(app, returnModifiers: [])

    app.launch()
    app.activate()
    XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 30))
    let didRestoreTabCount = await waitForCount(tabRows, equals: 2, timeout: .seconds(30))
    XCTAssertTrue(didRestoreTabCount)
    let didRestorePaneTitle = await waitForTabTitle(paneTitle)
    XCTAssertTrue(didRestorePaneTitle)
    let didRestoreTabTitle = await waitForTabTitle(tabTitle)
    XCTAssertTrue(didRestoreTabTitle)

    quit(app, returnModifiers: .shift)
  }

  @MainActor
  func testLayoutAndSessionsSurviveQuitAndRelaunch() async throws {
    let terminal = mainTerminal
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

    let savedLayout = try await waitForSessionLayout(at: sessionFileURL) { layout in
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
    try await waitForSessionLayout(at: sessionFileURL) { $0 == savedLayout }

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

  @MainActor
  private var tabRows: XCUIElementQuery {
    app.buttons.matching(
      identifier: SupatermUITestIdentifier.Accessibility.sidebarTabRow
    )
  }

  @MainActor
  private func clickContextMenuItem(
    _ title: String,
    on element: XCUIElement,
    timeout: TimeInterval = 10
  ) throws {
    let foundElement = try XCTUnwrap(
      element.waitForExistence(timeout: timeout) ? element : nil
    )
    foundElement.rightClick()

    let itemCandidate = app.menuItems[title]
    let item = try XCTUnwrap(
      itemCandidate.waitForExistence(timeout: timeout) ? itemCandidate : nil
    )
    item.click()
  }

  @MainActor
  private func changeTitle(
    to title: String,
    with menuItem: SupatermUITestIdentifier.MenuItemIdentifier,
    heading: String
  ) async throws {
    try clickMenuItem(menuItem)

    let headingElement = app.staticTexts[heading]
    XCTAssertTrue(headingElement.waitForExistence(timeout: 10))
    let sheet = app.sheets.firstMatch
    let field = sheet.textFields.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 10))
    field.click()
    field.typeKey("a", modifierFlags: .command)
    field.typeText(title)
    sheet.buttons["OK"].click()

    let didDismissSheet = await wait(for: headingElement) { !$0.exists }
    XCTAssertTrue(didDismissSheet)
  }

  @MainActor
  private func waitForCount(
    _ query: XCUIElementQuery,
    equals expectedCount: Int,
    timeout: Duration = .seconds(10)
  ) async -> Bool {
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: timeout)
    while clock.now < deadline {
      if query.count == expectedCount {
        return true
      }
      try? await Task.sleep(for: .milliseconds(100))
    }
    return query.count == expectedCount
  }

  @MainActor
  private func waitForTabTitle(_ title: String) async -> Bool {
    await wait(for: tabRows.firstMatch, timeout: .seconds(30)) { _ in
      self.tabRows.allElementsBoundByIndex.contains { $0.label.contains(title) }
    }
  }

  private func waitForFile(
    at url: URL,
    timeout: Duration = .seconds(30),
    matching predicate: (Data) -> Bool
  ) async -> Bool {
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: timeout)
    while clock.now < deadline {
      if let data = try? Data(contentsOf: url), predicate(data) {
        return true
      }
      try? await Task.sleep(for: .milliseconds(100))
    }
    return (try? Data(contentsOf: url)).map(predicate) == true
  }

  private func waitForSessionCatalog(
    at url: URL,
    matching predicate: ([String: Any]) -> Bool
  ) async -> Bool {
    await waitForFile(at: url) { data in
      guard
        let catalog = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
      else { return false }
      return predicate(catalog)
    }
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

import XCTest

final class PanesSplitsUITests: SupatermUITestCase {
  private static let paneIdentifierPrefix = "terminal.pane."

  @MainActor
  private var terminalPanes: XCUIElementQuery {
    app.textViews.matching(
      NSPredicate(format: "identifier BEGINSWITH %@", Self.paneIdentifierPrefix)
    )
  }

  @MainActor
  private var focusedTerminalPanes: XCUIElementQuery {
    terminalPanes.matching(NSPredicate(format: "hasKeyboardFocus == true"))
  }

  @MainActor
  func testSplitRightCreatesTwoVisiblePanes() async throws {
    _ = try await requireVisiblePanes(count: 1)

    try clickMenuItem(.splitRight)

    let panes = try await requireVisiblePanes(count: 2)
    XCTAssertGreaterThan(
      abs(panes[0].frame.midX - panes[1].frame.midX),
      abs(panes[0].frame.midY - panes[1].frame.midY)
    )
  }

  @MainActor
  func testSplitDownCreatesTwoVisiblePanes() async throws {
    _ = try await requireVisiblePanes(count: 1)

    try clickMenuItem(.splitDown)

    let panes = try await requireVisiblePanes(count: 2)
    XCTAssertGreaterThan(
      abs(panes[0].frame.midY - panes[1].frame.midY),
      abs(panes[0].frame.midX - panes[1].frame.midX)
    )
  }

  @MainActor
  func testDirectionalFocusNavigationMovesFocusBetweenPanes() async throws {
    _ = try await requireVisiblePanes(count: 1)
    try clickMenuItem(.splitRight)
    let panes = try await requireVisiblePanes(count: 2)
    let leftPane = try XCTUnwrap(panes.min { $0.frame.midX < $1.frame.midX })
    let rightPane = try XCTUnwrap(panes.max { $0.frame.midX < $1.frame.midX })

    try clickMenuItem(.selectSplitLeft)
    try await requireFocus(on: leftPane)

    try clickMenuItem(.selectSplitRight)
    try await requireFocus(on: rightPane)
  }

  @MainActor
  func testSplitWhileSearchOpenFocusesNewPane() async throws {
    let originalPane = try await requireVisiblePanes(count: 1)[0]
    originalPane.click()
    let originalIdentifier = originalPane.identifier

    app.typeKey("f", modifierFlags: .command)
    let searchField = app.textFields[SupatermUITestIdentifier.Accessibility.searchField]
    XCTAssertTrue(searchField.waitForExistence(timeout: 10))
    searchField.typeText("SPLITFOCUSNEEDLE")
    XCTAssertEqual(searchField.value as? String, "SPLITFOCUSNEEDLE")

    try clickMenuItem(.splitRight)
    let panes = try await requireVisiblePanes(count: 2)
    let newPane = try XCTUnwrap(panes.first { $0.identifier != originalIdentifier })

    let remountedSearchField = app.textFields[
      SupatermUITestIdentifier.Accessibility.searchField
    ]
    XCTAssertTrue(remountedSearchField.waitForExistence(timeout: 10))
    try await requireFocus(on: newPane)

    app.typeText(
      "printf '\\x53\\x50\\x4C\\x49\\x54\\x46\\x4F\\x43\\x55\\x53\\x4D\\x41\\x52\\x4B\\x45\\x52\\n'"
    )
    app.typeKey(.return, modifierFlags: [])
    let markerPrinted = await wait(for: newPane, timeout: .seconds(30)) {
      ($0.value as? String)?.contains("SPLITFOCUSMARKER") == true
    }
    XCTAssertTrue(markerPrinted)
    XCTAssertEqual(remountedSearchField.value as? String, "SPLITFOCUSNEEDLE")
  }

  @MainActor
  func testTopBarTitleFollowsFocusedPane() async throws {
    let leftPane = try await requireVisiblePanes(count: 1)[0]
    leftPane.click()
    try await requireFocus(on: leftPane)

    let leftTitle = "pane-title-L-\(UUID().uuidString.prefix(8))"
    leftPane.typeText("printf '\\033]0;\(leftTitle)\\007'; sleep 600\n")
    let didSetLeftTitle = await wait(for: leftPane, timeout: .seconds(30)) {
      $0.label == leftTitle
    }
    XCTAssertTrue(didSetLeftTitle)

    let sidebarTabRow = app.buttons.matching(
      identifier: SupatermUITestIdentifier.Accessibility.sidebarTabRow
    ).firstMatch
    try clickMenuItem(.toggleSidebar)
    let didHideSidebar = await wait(for: sidebarTabRow) { !$0.isHittable }
    XCTAssertTrue(didHideSidebar)

    let leftTopBarTitle = app.staticTexts[leftTitle]
    let didShowLeftTitle = await wait(for: leftTopBarTitle) {
      $0.exists && $0.isHittable
    }
    XCTAssertTrue(didShowLeftTitle)

    try clickMenuItem(.splitRight)
    let panes = try await requireVisiblePanes(count: 2)
    let rightPane = try XCTUnwrap(panes.max { $0.frame.midX < $1.frame.midX })
    try await requireFocus(on: rightPane)

    let rightTitle = "pane-title-R-\(UUID().uuidString.prefix(8))"
    rightPane.typeText("printf '\\033]0;\(rightTitle)\\007'; sleep 600\n")
    let didSetRightTitle = await wait(for: rightPane, timeout: .seconds(30)) {
      $0.label == rightTitle
    }
    XCTAssertTrue(didSetRightTitle)

    let rightTopBarTitle = app.staticTexts[rightTitle]
    let didShowRightTitle = await wait(for: rightTopBarTitle) {
      $0.exists && $0.isHittable
    }
    XCTAssertTrue(didShowRightTitle)
    let didHideLeftTitle = await wait(for: leftTopBarTitle) { !$0.exists }
    XCTAssertTrue(didHideLeftTitle)

    try clickMenuItem(.selectSplitLeft)
    try await requireFocus(on: leftPane)
    let didRestoreLeftTitle = await wait(for: leftTopBarTitle) {
      $0.exists && $0.isHittable
    }
    XCTAssertTrue(didRestoreLeftTitle)
    let didHideRightTitle = await wait(for: rightTopBarTitle) { !$0.exists }
    XCTAssertTrue(didHideRightTitle)

    try clickMenuItem(.selectSplitRight)
    try await requireFocus(on: rightPane)
    let didRestoreRightTitle = await wait(for: rightTopBarTitle) {
      $0.exists && $0.isHittable
    }
    XCTAssertTrue(didRestoreRightTitle)
    let didRemoveLeftTitle = await wait(for: leftTopBarTitle) { !$0.exists }
    XCTAssertTrue(didRemoveLeftTitle)

    leftPane.click()
    app.typeKey("c", modifierFlags: .control)
    rightPane.click()
    app.typeKey("c", modifierFlags: .control)
  }

  @MainActor
  func testExitingShellClosesPaneWithoutConfirmation() async throws {
    _ = try await requireVisiblePanes(count: 1)
    let originalIdentifier = terminalPanes.element(boundBy: 0).identifier

    try clickMenuItem(.splitRight)
    let panes = try await requireVisiblePanes(count: 2)
    let newPane = try XCTUnwrap(panes.first { $0.identifier != originalIdentifier })
    newPane.click()
    try await requireFocus(on: newPane)

    newPane.typeText("exit\n")
    let didClosePane = await wait(for: mainWindow, timeout: .seconds(30)) { _ in
      self.terminalPanes.count == 1
        && self.terminalPanes.element(boundBy: 0).identifier == originalIdentifier
    }
    guard didClosePane else {
      XCTFail("Exited pane did not close while preserving its sibling")
      return
    }

    XCTAssertEqual(mainWindow.sheets.count, 0)
    XCTAssertFalse(
      app.buttons[SupatermUITestIdentifier.Accessibility.dialogConfirm].exists
    )

    let survivor = terminalPanes.element(boundBy: 0)
    try await requireFocus(on: survivor)

    let token = UUID().uuidString.prefix(8)
    app.typeText("echo exit-\"close\"-\(token)\n")
    let survivorReceivedInput = await wait(for: survivor, timeout: .seconds(30)) {
      ($0.value as? String)?.contains("exit-close-\(token)") == true
    }
    XCTAssertTrue(survivorReceivedInput)
  }

  @MainActor
  func testToggleSplitZoomFocusesTargetPane() async throws {
    _ = try await requireVisiblePanes(count: 1)
    try clickMenuItem(.splitRight)
    let panes = try await requireVisiblePanes(count: 2)
    let leftPane = try XCTUnwrap(panes.min { $0.frame.midX < $1.frame.midX })
    let paneIdentifiers = Set(panes.map(\.identifier))

    try clickMenuItem(.selectSplitLeft)
    try await requireFocus(on: leftPane)

    try clickMenuItem(.zoomSplit)
    let zoomedPanes = try await requireVisiblePanes(count: 1)
    XCTAssertEqual(zoomedPanes[0].identifier, leftPane.identifier)
    try await requireFocus(on: leftPane)

    try clickMenuItem(.zoomSplit)
    let restoredPanes = try await requireVisiblePanes(count: 2)
    XCTAssertEqual(Set(restoredPanes.map(\.identifier)), paneIdentifiers)
    try await requireFocus(on: leftPane)
  }

  @MainActor
  func testCommandWClosesFocusedPaneNotWindow() async throws {
    let ghosttyConfigDirectory = stateHome.appendingPathComponent("ghostty", isDirectory: true)
    try FileManager.default.createDirectory(
      at: ghosttyConfigDirectory,
      withIntermediateDirectories: true
    )
    try Data("confirm-close-surface = false\n".utf8).write(
      to: ghosttyConfigDirectory.appendingPathComponent("config")
    )
    app.launchEnvironment["XDG_CONFIG_HOME"] = stateHome.path
    try relaunch()

    _ = try await requireVisiblePanes(count: 1)
    try clickMenuItem(.splitRight)
    let panes = try await requireVisiblePanes(count: 2)
    let leftPane = try XCTUnwrap(panes.min { $0.frame.midX < $1.frame.midX })
    let rightPane = try XCTUnwrap(panes.max { $0.frame.midX < $1.frame.midX })
    let leftPaneIdentifier = leftPane.identifier

    rightPane.click()
    try await requireFocus(on: rightPane)
    app.typeKey("w", modifierFlags: .command)

    let survivors = try await requireVisiblePanes(count: 1)
    XCTAssertEqual(survivors[0].identifier, leftPaneIdentifier)
    XCTAssertEqual(mainWindow.sheets.count, 0)
    XCTAssertEqual(app.windows.count, 1)
    XCTAssertTrue(mainWindow.exists)
  }

  @MainActor
  func testZoomSplitHidesAndRestoresOtherPane() async throws {
    _ = try await requireVisiblePanes(count: 1)
    try clickMenuItem(.splitRight)
    let panes = try await requireVisiblePanes(count: 2)
    let paneIdentifiers = Set(panes.map(\.identifier))

    try clickMenuItem(.zoomSplit)

    let zoomedPanes = try await requireVisiblePanes(count: 1)
    XCTAssertTrue(paneIdentifiers.contains(zoomedPanes[0].identifier))

    try clickMenuItem(.zoomSplit)

    let restoredPanes = try await requireVisiblePanes(count: 2)
    XCTAssertEqual(Set(restoredPanes.map(\.identifier)), paneIdentifiers)
  }

  @MainActor
  func testResizeAndEqualizeChangeLayoutWithoutLosingPanes() async throws {
    _ = try await requireVisiblePanes(count: 1)
    try clickMenuItem(.splitRight)
    let panes = try await requireVisiblePanes(count: 2)
    let leftPane = try XCTUnwrap(panes.min { $0.frame.midX < $1.frame.midX })
    let initialFrame = leftPane.frame
    let paneIdentifiers = Set(panes.map(\.identifier))

    for _ in 0..<3 {
      try clickMenuItem(.moveSplitDividerLeft)
    }

    let didResize = await wait(for: leftPane) {
      $0.exists && $0.frame.width < initialFrame.width - 5
    }
    guard didResize else {
      XCTFail("Split divider did not move left")
      return
    }
    let resizedPanes = try await requireVisiblePanes(count: 2)
    XCTAssertEqual(Set(resizedPanes.map(\.identifier)), paneIdentifiers)

    try clickMenuItem(.equalizeSplits)

    let didEqualize = await wait(for: leftPane) {
      $0.exists && abs($0.frame.width - initialFrame.width) < 2
    }
    XCTAssertTrue(didEqualize)
    let equalizedPanes = try await requireVisiblePanes(count: 2)
    XCTAssertEqual(Set(equalizedPanes.map(\.identifier)), paneIdentifiers)
  }

  @MainActor
  func testClosingBusyPaneRequiresConfirmation() async throws {
    _ = try await requireVisiblePanes(count: 1)
    try clickMenuItem(.splitRight)
    let panes = try await requireVisiblePanes(count: 2)
    let rightPane = try XCTUnwrap(panes.max { $0.frame.midX < $1.frame.midX })
    rightPane.click()
    try await requireFocus(on: rightPane)

    let processSentinel = "pane-busy"
    rightPane.typeText("printf '\\033]0;\(processSentinel)\\007'; sleep 600\n")
    let didStartProcess = await wait(for: rightPane, timeout: .seconds(30)) {
      $0.label == processSentinel
    }
    guard didStartProcess else {
      XCTFail("Busy pane process did not start")
      return
    }

    try clickMenuItem(.closeSurface)

    let cancelButton = mainWindow.sheets.firstMatch.buttons["Cancel"]
    guard cancelButton.waitForExistence(timeout: 10) else {
      XCTFail("Close confirmation did not appear")
      return
    }
    cancelButton.click()
    _ = try await requireVisiblePanes(count: 2)

    rightPane.click()
    try await requireFocus(on: rightPane)
    try clickMenuItem(.closeSurface)

    let confirmButton = mainWindow.sheets.firstMatch.buttons["Close"]
    guard confirmButton.waitForExistence(timeout: 10) else {
      XCTFail("Close confirmation did not reappear")
      return
    }
    confirmButton.click()

    _ = try await requireVisiblePanes(count: 1)
  }

  @MainActor
  private func requireVisiblePanes(count expectedCount: Int) async throws -> [XCUIElement] {
    let didReachCount = await wait(for: mainWindow, timeout: .seconds(30)) { _ in
      guard self.terminalPanes.count == expectedCount else { return false }
      return (0..<expectedCount).allSatisfy {
        let pane = self.terminalPanes.element(boundBy: $0)
        return pane.exists && !pane.frame.isEmpty
      }
    }
    return try XCTUnwrap(
      didReachCount
        ? (0..<expectedCount).map { terminalPanes.element(boundBy: $0) }
        : nil,
      "Expected \(expectedCount) visible terminal panes"
    )
  }

  @MainActor
  private func requireFocus(on pane: XCUIElement) async throws {
    let focusedPane = focusedTerminalPanes.matching(identifier: pane.identifier).firstMatch
    let didFocus = await wait(for: focusedPane) { $0.exists }
    XCTAssertTrue(didFocus, "Expected pane \(pane.identifier) to have keyboard focus")
  }
}

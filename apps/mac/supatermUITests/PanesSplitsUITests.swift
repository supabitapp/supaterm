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

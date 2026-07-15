import XCTest

final class DialogsLifecycleUITests: SupatermUITestCase {
  @MainActor
  func testCloseAllWindowsShowsSingleConfirmationThatCancelsAndCloses() async throws {
    _ = mainTerminal

    try clickMenuItem(.newWindow)
    let didOpenSecondWindow = await wait(
      for: app.windows.firstMatch,
      timeout: .seconds(30)
    ) { _ in
      self.app.windows.count == 2 && self.app.textViews.count == 2
    }
    XCTAssertTrue(didOpenSecondWindow)

    try clickMenuItem(.closeAllWindows)

    let title = app.staticTexts["Close All Windows?"]
    XCTAssertTrue(title.waitForExistence(timeout: 10))
    let confirmButtons = app.buttons.matching(
      identifier: SupatermUITestIdentifier.Accessibility.dialogConfirm
    )
    let cancelButtons = app.buttons.matching(
      identifier: SupatermUITestIdentifier.Accessibility.dialogCancel
    )
    XCTAssertEqual(confirmButtons.count, 1)
    XCTAssertEqual(cancelButtons.count, 1)

    cancelButtons.firstMatch.click()
    let didCancel = await wait(for: title) { !$0.exists }
    XCTAssertTrue(didCancel)
    XCTAssertEqual(app.windows.count, 2)
    XCTAssertEqual(app.textViews.count, 2)

    try clickMenuItem(.closeAllWindows)
    XCTAssertTrue(title.waitForExistence(timeout: 10))
    confirmButtons.firstMatch.click()

    let didCloseAllWindows = await wait(
      for: app.windows.firstMatch,
      timeout: .seconds(30)
    ) { _ in
      self.app.windows.count < 1
    }
    XCTAssertTrue(didCloseAllWindows)
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 5))
  }

  @MainActor
  func testChangeTerminalTitleAppliesTypedTitle() async throws {
    _ = mainWindow
    let terminal = app.textViews.firstMatch
    XCTAssertTrue(terminal.waitForExistence(timeout: 30))
    terminal.click()

    let title = "Lifecycle Terminal \(UUID().uuidString)"
    try clickMenuItem(.changeTerminalTitle)

    let heading = app.staticTexts["Change Terminal Title"]
    XCTAssertTrue(heading.waitForExistence(timeout: 10))

    let field = app.textFields.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 10))
    field.click()
    field.typeKey("a", modifierFlags: .command)
    field.typeText(title)

    let confirmButton = app.sheets.firstMatch.buttons["OK"]
    XCTAssertTrue(confirmButton.waitForExistence(timeout: 10))
    confirmButton.click()

    let didDismiss = await wait(for: heading) { !$0.exists }
    XCTAssertTrue(didDismiss)
    let didApplyTitle = await waitForTabTitle(title)
    XCTAssertTrue(didApplyTitle)
  }

  @MainActor
  func testQuitCanBeCancelledWhileForegroundProcessIsRunning() async throws {
    _ = mainWindow
    let terminal = app.textViews.firstMatch
    XCTAssertTrue(terminal.waitForExistence(timeout: 30))
    terminal.click()

    let marker = "quit-cancel-\(UUID().uuidString)"
    app.typeText("echo \(marker); sleep 300\n")
    let processStarted = await wait(for: terminal, timeout: .seconds(30)) { element in
      (element.value as? String)?.contains(marker) == true
    }
    XCTAssertTrue(processStarted)

    app.typeKey("q", modifierFlags: .command)

    let quitDialog = element(SupatermUITestIdentifier.Accessibility.dialogQuit)
    XCTAssertTrue(quitDialog.waitForExistence(timeout: 10))

    let cancelButton = app.buttons[
      SupatermUITestIdentifier.Accessibility.dialogCancel
    ]
    XCTAssertTrue(cancelButton.waitForExistence(timeout: 10))
    cancelButton.click()

    let didDismiss = await wait(for: quitDialog) { !$0.exists }
    XCTAssertTrue(didDismiss)
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 5))
    XCTAssertTrue(mainWindow.exists)

    terminal.click()
    app.typeKey("c", modifierFlags: .control)
  }

  @MainActor
  func testReactivatingAfterClosingLastWindowOpensTerminalWindow() async throws {
    let window = mainWindow

    try clickMenuItem(.closeWindow)

    let confirmButton = app.buttons[
      SupatermUITestIdentifier.Accessibility.dialogConfirm
    ]
    XCTAssertTrue(confirmButton.waitForExistence(timeout: 10))
    confirmButton.click()

    let didCloseWindow = await wait(for: window, timeout: .seconds(30)) { !$0.exists }
    XCTAssertTrue(didCloseWindow)

    let finder = XCUIApplication(bundleIdentifier: "com.apple.finder")
    finder.activate()
    XCTAssertTrue(finder.wait(for: .runningForeground, timeout: 5))
    app.activate()
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 5))

    _ = mainWindow
    XCTAssertTrue(app.textViews.firstMatch.waitForExistence(timeout: 30))
  }

  @MainActor
  private func waitForTabTitle(_ title: String) async -> Bool {
    let rows = tabRows
    return await wait(
      for: rows.firstMatch,
      timeout: .seconds(30)
    ) { _ in
      rows.allElementsBoundByIndex.contains { $0.label.contains(title) }
    }
  }

  @MainActor
  private var tabRows: XCUIElementQuery {
    app.buttons.matching(
      identifier: SupatermUITestIdentifier.Accessibility.sidebarTabRow
    )
  }
}

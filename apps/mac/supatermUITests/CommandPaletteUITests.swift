import XCTest

final class CommandPaletteUITests: SupatermUITestCase {
  @MainActor
  func testShortcutFocusesInputAndEscapeRestoresTerminalFocus() async throws {
    let terminal = try readyTerminal()
    terminal.click()
    let terminalValue = try XCTUnwrap(terminal.value as? String)

    let input = try await openPalette()
    let query = "toggle side"
    app.typeText(query)

    let didFocusInput = await wait(for: input) {
      $0.value as? String == query
    }
    XCTAssertTrue(didFocusInput)
    XCTAssertEqual(terminal.value as? String, terminalValue)

    app.typeKey(.escape, modifierFlags: [])

    let didDismiss = await wait(for: input) { !$0.exists }
    XCTAssertTrue(didDismiss)

    let focusedTerminal = app.textViews.matching(keyboardFocusPredicate).firstMatch
    let didRestoreTerminalFocus = await wait(for: focusedTerminal) { $0.exists }
    XCTAssertTrue(didRestoreTerminalFocus)

    let terminalInput = "palette focus restored"
    app.typeText(terminalInput)

    let didTypeInTerminal = await wait(for: terminal) {
      $0.value as? String == terminalValue + terminalInput
    }
    XCTAssertTrue(didTypeInTerminal)
  }

  @MainActor
  func testTypingPartialQueryFiltersRowsAndHandlesEmptyResults() async throws {
    let terminal = try readyTerminal()
    terminal.click()
    let input = try await openPalette()
    let rows = paletteRows

    input.typeText("tOgGlE sIdE")

    let didFilter = await wait(for: rows.firstMatch) {
      $0.exists && rows.count == 1
    }
    XCTAssertTrue(didFilter)
    XCTAssertTrue(rows.firstMatch.label.contains("Toggle Sidebar"))

    app.typeKey("a", modifierFlags: .command)
    app.typeText("zzzzzzzzzz")

    let noMatches = app.staticTexts["No matches"]
    let didShowEmptyState = await wait(for: noMatches) {
      $0.exists && !rows.firstMatch.exists
    }
    XCTAssertTrue(didShowEmptyState)

    app.typeKey(.downArrow, modifierFlags: [])
    app.typeKey(.return, modifierFlags: [])

    let didKeepEmptyPaletteOpen = await wait(for: focusedPaletteInput) {
      $0.exists && input.value as? String == "zzzzzzzzzz"
    }
    XCTAssertTrue(didKeepEmptyPaletteOpen)
  }

  @MainActor
  func testArrowKeysMoveSelectionBetweenRows() async throws {
    let terminal = try readyTerminal()
    terminal.click()
    let input = try await openPalette()
    let rows = paletteRows

    input.typeText("Space")

    let firstRow = rows.element(boundBy: 0)
    let secondRow = rows.element(boundBy: 1)
    let didShowSpaceRows = await wait(for: secondRow) {
      $0.exists && rows.count == 2
    }
    XCTAssertTrue(didShowSpaceRows)
    XCTAssertTrue(firstRow.label.contains("Create Space"))
    XCTAssertTrue(secondRow.label.contains("Rename Space"))

    let didSelectFirstRow = await wait(for: firstRow) { $0.isSelected }
    XCTAssertTrue(didSelectFirstRow)
    XCTAssertFalse(secondRow.isSelected)

    app.typeKey(.downArrow, modifierFlags: [])

    let didSelectSecondRow = await wait(for: secondRow) {
      $0.isSelected && !firstRow.isSelected
    }
    XCTAssertTrue(didSelectSecondRow)

    app.typeKey(.upArrow, modifierFlags: [])

    let didReturnToFirstRow = await wait(for: firstRow) {
      $0.isSelected && !secondRow.isSelected
    }
    XCTAssertTrue(didReturnToFirstRow)
  }

  @MainActor
  func testToggleSidebarCommandHidesAndRestoresSidebar() async throws {
    let terminal = try readyTerminal()
    terminal.click()
    let sidebarRow = app.buttons.matching(
      identifier: SupatermUITestIdentifier.Accessibility.sidebarTabRow
    ).firstMatch

    try await executePaletteCommand("Toggle Sidebar")

    let didHideSidebar = await wait(for: sidebarRow) { !$0.isHittable }
    XCTAssertTrue(didHideSidebar)

    try await executePaletteCommand("Toggle Sidebar")

    let didRestoreSidebar = await wait(for: sidebarRow) { $0.isHittable }
    XCTAssertTrue(didRestoreSidebar)
  }

  @MainActor
  func testCreateSpaceCommandAddsSpaceBarButton() async throws {
    let terminal = try readyTerminal()
    terminal.click()

    try await executePaletteCommand("Create Space")

    let nameField = app.textFields[
      SupatermUITestIdentifier.Accessibility.dialogSpaceName
    ]
    XCTAssertTrue(nameField.waitForExistence(timeout: 10))
    nameField.click()

    let spaceName = "Palette UI Test"
    nameField.typeText(spaceName)

    let confirmButton = app.buttons[
      SupatermUITestIdentifier.Accessibility.dialogConfirm
    ]
    let didEnableConfirm = await wait(for: confirmButton) {
      $0.exists && $0.isEnabled
    }
    XCTAssertTrue(didEnableConfirm)
    confirmButton.click()

    let spaceButtons = app.buttons.matching(
      identifier: SupatermUITestIdentifier.Accessibility.sidebarSpaceButton
    )
    let createdSpaceButton = spaceButtons.matching(
      NSPredicate(format: "label == %@", "Space \(spaceName)")
    ).firstMatch
    let didCreateSpace = await wait(for: createdSpaceButton) {
      $0.exists && spaceButtons.count == 2
    }
    XCTAssertTrue(didCreateSpace)
  }

  @MainActor
  func testPinTabCommandMovesCurrentTabToPinnedSection() async throws {
    let terminal = try readyTerminal()
    terminal.click()

    let pinnedSection = element(
      SupatermUITestIdentifier.Accessibility.sidebarPinnedSection
    )
    let regularSection = element(
      SupatermUITestIdentifier.Accessibility.sidebarRegularSection
    )
    XCTAssertTrue(pinnedSection.waitForExistence(timeout: 10))
    XCTAssertTrue(regularSection.waitForExistence(timeout: 10))

    let pinnedRows = pinnedSection.descendants(matching: .button).matching(
      identifier: SupatermUITestIdentifier.Accessibility.sidebarTabRow
    )
    let regularRows = regularSection.descendants(matching: .button).matching(
      identifier: SupatermUITestIdentifier.Accessibility.sidebarTabRow
    )
    XCTAssertEqual(pinnedRows.count, 0)
    XCTAssertEqual(regularRows.count, 1)

    try await executePaletteCommand("Pin Tab")

    let didMoveTab = await wait(for: pinnedRows.firstMatch) {
      $0.exists && pinnedRows.count == 1 && !regularRows.firstMatch.exists
    }
    XCTAssertTrue(didMoveTab)
  }

  @MainActor
  private var paletteRows: XCUIElementQuery {
    app.buttons.matching(
      identifier: SupatermUITestIdentifier.Accessibility.paletteResultRow
    )
  }

  @MainActor
  private var focusedPaletteInput: XCUIElement {
    app.textFields
      .matching(identifier: SupatermUITestIdentifier.Accessibility.paletteInput)
      .matching(keyboardFocusPredicate)
      .firstMatch
  }

  private var keyboardFocusPredicate: NSPredicate {
    NSPredicate(format: "hasKeyboardFocus == true")
  }

  @MainActor
  private func readyTerminal() throws -> XCUIElement {
    _ = mainWindow

    let sidebarRow = app.buttons.matching(
      identifier: SupatermUITestIdentifier.Accessibility.sidebarTabRow
    ).firstMatch
    try require(sidebarRow, timeout: 30, "Initial sidebar tab row did not appear")

    let terminal = app.textViews.firstMatch
    return try require(terminal, timeout: 30, "Terminal did not appear")
  }

  @MainActor
  private func openPalette() async throws -> XCUIElement {
    app.typeKey("p", modifierFlags: [.command, .shift])

    let input = app.textFields[
      SupatermUITestIdentifier.Accessibility.paletteInput
    ]
    let existingInput = try require(input, "Command palette input did not appear")
    let didFocus = await wait(for: focusedPaletteInput) { $0.exists }
    return try XCTUnwrap(
      didFocus ? existingInput : nil,
      "Command palette input did not receive keyboard focus"
    )
  }

  @MainActor
  private func executePaletteCommand(_ title: String) async throws {
    let input = try await openPalette()
    input.typeText(title)

    let rows = paletteRows
    let didFilterToCommand = await wait(for: rows.firstMatch) {
      $0.exists && rows.count == 1
    }
    XCTAssertTrue(didFilterToCommand)
    XCTAssertTrue(rows.firstMatch.label.contains(title))

    app.typeKey(.return, modifierFlags: [])

    let didDismiss = await wait(for: input) { !$0.exists }
    XCTAssertTrue(didDismiss)
  }
}

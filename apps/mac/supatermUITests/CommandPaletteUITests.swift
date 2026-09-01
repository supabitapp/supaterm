import AppKit
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
  func testWordInitialQueryFiltersRowsAndRanksTitleMatchFirst() async throws {
    let terminal = try readyTerminal()
    terminal.click()
    let input = try await openPalette()
    let rows = paletteRows
    let initialRowCount = rows.count

    input.typeText("spr")

    let didFilter = await wait(for: rows.firstMatch) {
      $0.exists && rows.count < initialRowCount
    }
    XCTAssertTrue(didFilter)
    XCTAssertTrue(rows.firstMatch.label.contains("Split Pane Right"))
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
    XCTAssertTrue(firstRow.label.contains("Edit Space"))
    XCTAssertTrue(secondRow.label.contains("Create Space"))

    let didSelectFirstRow = await wait(for: firstRow) { $0.isSelected }
    XCTAssertTrue(didSelectFirstRow)
    XCTAssertFalse(secondRow.isSelected)
    firstRow.hover()

    app.typeKey(.downArrow, modifierFlags: [])

    let didSelectSecondRow = await wait(for: secondRow) {
      $0.isSelected && !firstRow.isSelected
    }
    XCTAssertTrue(didSelectSecondRow)
    XCTAssertGreaterThan(
      try backgroundLuminance(of: secondRow),
      try backgroundLuminance(of: firstRow)
    )

    app.typeKey(.upArrow, modifierFlags: [])

    let didReturnToFirstRow = await wait(for: firstRow) {
      $0.isSelected && !secondRow.isSelected
    }
    XCTAssertTrue(didReturnToFirstRow)
  }

  @MainActor
  private func backgroundLuminance(of element: XCUIElement) throws -> CGFloat {
    let image = element.screenshot().image
    let data = try XCTUnwrap(image.tiffRepresentation)
    let bitmap = try XCTUnwrap(NSBitmapImageRep(data: data))
    let color = try XCTUnwrap(
      bitmap.colorAt(x: bitmap.pixelsWide * 3 / 4, y: bitmap.pixelsHigh / 2)?
        .usingColorSpace(.sRGB)
    )
    return
      0.2126 * color.redComponent
      + 0.7152 * color.greenComponent
      + 0.0722 * color.blueComponent
  }

  @MainActor
  func testClickingCommandActivatesIt() async throws {
    let terminal = try readyTerminal()
    terminal.click()
    let input = try await openPalette()
    input.typeText("Toggle Sidebar")

    let rows = paletteRows
    let row = rows.firstMatch
    let didShowCommand = await wait(for: row) {
      $0.exists && rows.count == 1 && $0.label.contains("Toggle Sidebar")
    }
    XCTAssertTrue(didShowCommand)

    row.hover()
    let didSelectRow = await wait(for: row) { $0.isSelected }
    XCTAssertTrue(didSelectRow)
    row.click()

    let didDismiss = await wait(for: input) { !$0.exists }
    XCTAssertTrue(didDismiss)
    let didCollapseSidebar = await waitForSidebarCollapsed()
    XCTAssertTrue(didCollapseSidebar)
  }

  @MainActor
  func testToggleSidebarCommandHidesAndRestoresSidebar() async throws {
    let terminal = try readyTerminal()
    terminal.click()

    try await executePaletteCommand("Toggle Sidebar")
    terminal.hover()

    let didCollapseSidebar = await waitForSidebarCollapsed()
    XCTAssertTrue(didCollapseSidebar)

    try await executePaletteCommand("Toggle Sidebar")

    let didExpandSidebar = await waitForSidebarExpanded()
    XCTAssertTrue(didExpandSidebar)
  }

  @MainActor
  func testTitleCommandsPresentSheets() async throws {
    let terminal = try readyTerminal()
    terminal.click()

    for (commandTitle, sheetTitle) in [
      ("Rename Tab", "Change Tab Title"),
      ("Rename Pane", "Change Terminal Title"),
    ] {
      try await executePaletteCommand(commandTitle)

      let sheet = mainWindow.sheets.firstMatch
      let didPresentSheet = await wait(for: sheet) {
        $0.exists && $0.staticTexts[sheetTitle].exists
      }
      XCTAssertTrue(didPresentSheet)

      sheet.buttons["Cancel"].click()
      let didDismissSheet = await wait(for: sheet) { !$0.exists }
      XCTAssertTrue(didDismissSheet)
    }
  }

  @MainActor
  func testCreateSpaceCommandDisplaysNewSpaceInTheSameWindow() async throws {
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

    let didDisplayCreatedSpace = await waitForDisplayedSpace(named: spaceName)
    XCTAssertTrue(didDisplayCreatedSpace)

    let didAddSpaceDot = await waitForSidebarElementCount(spaceDots, equals: 2)
    XCTAssertTrue(didAddSpaceDot)
    XCTAssertEqual(app.windows.count, 1)
  }

  @MainActor
  func testPinTabCommandMovesCurrentTabToPinnedSection() async throws {
    let terminal = try readyTerminal()
    terminal.click()

    let rows = sidebarTabRows
    XCTAssertEqual(rows.count, 1)
    XCTAssertFalse(rows.firstMatch.label.contains("Pinned"))

    try await executePaletteCommand("Pin Tab")

    let didMoveTab = await wait(for: rows.firstMatch) {
      $0.exists && $0.label.contains("Pinned") && rows.count == 1
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

    let sidebarRow = sidebarTabRows.firstMatch
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

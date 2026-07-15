import XCTest

final class TabsSpacesUITests: SupatermUITestCase {
  private static let paneIdentifierPrefix = "terminal.pane."
  private static let coldStartTimeout: Duration = .seconds(60)
  private static let pinnedStatusSessionID = "pinned-status-lane"

  @MainActor
  func testNewAndCloseTabUpdateSidebarRows() async throws {
    _ = mainWindow
    let didShowInitialTab = await waitForCount(tabRows, equals: 1, timeout: .seconds(30))
    XCTAssertTrue(didShowInitialTab)

    try clickMenuItem(.newTab)

    let didCreateTab = await waitForCount(tabRows, equals: 2, timeout: .seconds(30))
    XCTAssertTrue(didCreateTab)

    try closeSelectedTab()

    let didCloseTab = await waitForCount(tabRows, equals: 1, timeout: .seconds(30))
    XCTAssertTrue(didCloseTab)
  }

  @MainActor
  func testChangingTabTitleUpdatesSidebarRow() async throws {
    _ = mainWindow
    let didShowInitialTab = await waitForCount(tabRows, equals: 1, timeout: .seconds(30))
    XCTAssertTrue(didShowInitialTab)

    let title = "Renamed UI Tab"
    try await renameSelectedTab(to: title)

    XCTAssertTrue(tabRow(named: title).exists)
  }

  @MainActor
  func testPinAndUnpinMoveTabBetweenSidebarSections() async throws {
    _ = mainWindow
    let didShowInitialTab = await waitForCount(tabRows, equals: 1, timeout: .seconds(30))
    XCTAssertTrue(didShowInitialTab)

    let title = "Pinned UI Tab"
    try await renameSelectedTab(to: title)

    let didShowRegularTab = await waitForTab(named: title, in: regularSection)
    XCTAssertTrue(didShowRegularTab)

    try clickContextMenuItem("Pin Tab", on: tabRow(named: title))

    let didMoveToPinned = await waitForTab(named: title, in: pinnedSection)
    XCTAssertTrue(didMoveToPinned)
    XCTAssertFalse(tabRow(named: title, in: regularSection).exists)

    try clickContextMenuItem("Unpin Tab", on: tabRow(named: title, in: pinnedSection))

    let didMoveToRegular = await waitForTab(named: title, in: regularSection)
    XCTAssertTrue(didMoveToRegular)
    XCTAssertFalse(tabRow(named: title, in: pinnedSection).exists)
  }

  @MainActor
  func testCreateSwitchRenameAndDeleteSpace() async throws {
    _ = mainWindow
    let didShowInitialTab = await waitForCount(tabRows, equals: 1, timeout: .seconds(30))
    XCTAssertTrue(didShowInitialTab)
    XCTAssertEqual(spaceButtons.count, 0)

    try await enterFullScreen()

    try await createSpace(named: "UI Space")

    let didShowSpaceBar = await waitForCount(spaceButtons, equals: 2)
    XCTAssertTrue(didShowSpaceBar)

    let initialSpace = spaceButton(named: "1")
    let createdSpace = spaceButton(named: "UI Space")
    XCTAssertTrue(initialSpace.exists)
    XCTAssertTrue(createdSpace.isSelected)

    app.typeKey("1", modifierFlags: .control)

    let didSelectInitialSpace = await waitForSelection(initialSpace)
    XCTAssertTrue(didSelectInitialSpace)

    app.typeKey("2", modifierFlags: .control)

    let didSelectCreatedSpace = await waitForSelection(createdSpace)
    XCTAssertTrue(didSelectCreatedSpace)

    try clickContextMenuItem("Rename Space", on: createdSpace)

    let nameField = app.textFields[
      SupatermUITestIdentifier.Accessibility.dialogSpaceName
    ]
    XCTAssertTrue(nameField.waitForExistence(timeout: 10))
    nameField.click()
    nameField.typeKey("a", modifierFlags: .command)
    nameField.typeText("Renamed UI Space")

    let confirm = app.buttons[
      SupatermUITestIdentifier.Accessibility.dialogConfirm
    ]
    XCTAssertTrue(confirm.waitForExistence(timeout: 10))
    confirm.click()

    let renamedSpace = spaceButton(named: "Renamed UI Space")
    let didRenameSpace = await wait(for: renamedSpace) { $0.exists }
    XCTAssertTrue(didRenameSpace)
    XCTAssertFalse(spaceButton(named: "UI Space").exists)

    try clickContextMenuItem("Delete Space", on: renamedSpace)

    let deleteTitle = app.staticTexts["Delete Space \"Renamed UI Space\"?"]
    XCTAssertTrue(deleteTitle.waitForExistence(timeout: 10))
    let deleteButton = mainWindow.buttons["Delete"]
    XCTAssertTrue(deleteButton.waitForExistence(timeout: 10))
    deleteButton.click()

    let didDeleteSpace = await waitForCount(spaceButtons, equals: 0)
    XCTAssertTrue(didDeleteSpace)
  }

  @MainActor
  func testTabNavigationUpdatesSelectedSidebarRow() async throws {
    try await createNamedTabs(["First UI Tab", "Second UI Tab", "Third UI Tab"])

    let firstTab = tabRow(named: "First UI Tab")
    let secondTab = tabRow(named: "Second UI Tab")
    let thirdTab = tabRow(named: "Third UI Tab")
    XCTAssertTrue(thirdTab.isSelected)

    try clickMenuItem(.nextTab)

    let didSelectFirstTab = await waitForSelection(firstTab)
    XCTAssertTrue(didSelectFirstTab)

    try clickMenuItem(.selectLastTab)

    let didSelectLastTab = await waitForSelection(thirdTab)
    XCTAssertTrue(didSelectLastTab)

    try clickMenuItem(.previousTab)

    let didSelectPreviousTab = await waitForSelection(secondTab)
    XCTAssertTrue(didSelectPreviousTab)
  }

  @MainActor
  func testClosingSelectedTabSelectsNextTabThenPreviousWhenLast() async throws {
    try await createNamedTabs(["First UI Tab", "Second UI Tab", "Third UI Tab"])

    let firstTab = tabRow(named: "First UI Tab")
    let secondTab = tabRow(named: "Second UI Tab")
    let thirdTab = tabRow(named: "Third UI Tab")
    XCTAssertTrue(thirdTab.isSelected)

    try clickMenuItem(.previousTab)
    let didSelectSecondTab = await waitForSelection(secondTab)
    XCTAssertTrue(didSelectSecondTab)

    try closeSelectedTab()
    let didCloseSecondTab = await waitForCount(tabRows, equals: 2, timeout: .seconds(30))
    XCTAssertTrue(didCloseSecondTab)
    let didSelectThirdTab = await waitForSelection(thirdTab)
    XCTAssertTrue(didSelectThirdTab)
    XCTAssertFalse(firstTab.isSelected)

    try closeSelectedTab()
    let didCloseThirdTab = await waitForCount(tabRows, equals: 1, timeout: .seconds(30))
    XCTAssertTrue(didCloseThirdTab)
    let didSelectFirstTab = await waitForSelection(firstTab)
    XCTAssertTrue(didSelectFirstTab)
  }

  @MainActor
  func testSelectingTabFocusesLatestUnreadPane() async throws {
    let initialPanes = try await requireVisiblePanes(count: 1)
    let paneAIdentifier = initialPanes[0].identifier

    try clickMenuItem(.splitRight)
    let panes = try await requireVisiblePanes(count: 2)
    let paneA = try XCTUnwrap(panes.first { $0.identifier == paneAIdentifier })
    let paneB = try XCTUnwrap(panes.max { $0.frame.midX < $1.frame.midX })
    let paneBID = String(paneB.identifier.dropFirst(Self.paneIdentifierPrefix.count))

    try clickMenuItem(.selectSplitLeft)
    try await requireFocus(on: paneA)

    paneA.typeText(
      "\"$SUPATERM_CLI_PATH\" pane notify \(paneBID) --body unread-pane-marker"
        + " --socket \"$SUPATERM_SOCKET_PATH\""
    )
    paneA.typeKey(.return, modifierFlags: [])
    let didCompleteNotification = await wait(for: paneA, timeout: Self.coldStartTimeout) {
      ($0.value as? String)?.contains("window 1 space 1 tab 1 pane 2") == true
    }
    XCTAssertTrue(didCompleteNotification)

    let firstTab = tabRows.element(boundBy: 0)
    let didRegisterUnread = await wait(for: firstTab, timeout: Self.coldStartTimeout) {
      $0.label.contains("unread-pane-marker")
    }
    XCTAssertTrue(didRegisterUnread)

    try clickMenuItem(.newTab)
    let secondTab = tabRows.element(boundBy: 1)
    let didSelectSecondTab = await wait(for: secondTab, timeout: Self.coldStartTimeout) {
      $0.exists && $0.isHittable && $0.isSelected
    }
    XCTAssertTrue(didSelectSecondTab)

    firstTab.click()
    let didSelectFirstTab = await waitForSelection(firstTab)
    XCTAssertTrue(didSelectFirstTab)
    try await requireFocus(on: paneB)
    XCTAssertFalse(focusedTerminalPane(identifier: paneA.identifier).exists)

    let didClearUnread = await wait(for: firstTab, timeout: Self.coldStartTimeout) {
      !$0.label.contains("unread-pane-marker")
    }
    XCTAssertTrue(didClearUnread)
  }

  @MainActor
  func testPinnedTabShowsPinIndicatorUntilAgentActivityTakesTheSlot() async throws {
    _ = mainWindow
    let didShowInitialTab = await waitForCount(tabRows, equals: 1, timeout: .seconds(30))
    XCTAssertTrue(didShowInitialTab)
    try await renameSelectedTab(to: "Slot Lane Tab")

    let row = tabRow(named: "Slot Lane Tab")
    XCTAssertFalse(row.label.contains("Pinned"))

    try clickContextMenuItem("Pin Tab", on: row)
    let didMoveToPinned = await waitForTab(named: "Slot Lane Tab", in: pinnedSection)
    XCTAssertTrue(didMoveToPinned)

    mainTerminal.click()
    let didShowPinned = await wait(for: row) { $0.label.contains("Pinned") }
    XCTAssertTrue(didShowPinned)

    try await sendClaudeEvent("session-start")
    try await sendClaudeEvent("user-prompt-submit")

    let didShowRunning = await wait(for: row, timeout: Self.coldStartTimeout) {
      $0.label.contains("Agent activity: Running") && !$0.label.contains("Pinned")
    }
    XCTAssertTrue(didShowRunning)

    try await sendClaudeEvent("stop")
    let didBecomeIdle = await wait(for: row, timeout: Self.coldStartTimeout) {
      !$0.label.contains("Agent activity:")
    }
    XCTAssertTrue(didBecomeIdle)
    mainTerminal.click()
    let didRestorePinned = await wait(for: row, timeout: Self.coldStartTimeout) {
      $0.label.contains("Pinned") && !$0.label.contains("Agent activity:")
    }
    XCTAssertTrue(didRestorePinned)

    try await sendClaudeEvent("session-end")
  }

  @MainActor
  func testNewTabAppendsAtEndWhenMiddleTabSelected() async throws {
    try await createNamedTabs(["First UI Tab", "Second UI Tab", "Third UI Tab"])

    let secondTab = tabRow(named: "Second UI Tab")
    try clickMenuItem(.previousTab)
    let didSelectSecondTab = await waitForSelection(secondTab)
    XCTAssertTrue(didSelectSecondTab)

    try clickMenuItem(.newTab)
    let didCreateFourthTab = await waitForCount(tabRows, equals: 4, timeout: .seconds(30))
    XCTAssertTrue(didCreateFourthTab)
    try await renameSelectedTab(to: "Fourth UI Tab")

    let expectedOrder = ["First UI Tab", "Second UI Tab", "Third UI Tab", "Fourth UI Tab"]
    let didAppendAtEnd = await waitForTabOrder(expectedOrder)
    XCTAssertTrue(didAppendAtEnd)
    XCTAssertTrue(tabRow(named: "Fourth UI Tab").isSelected)
  }

  @MainActor
  func testDraggingTabReordersRegularSectionAndPinsAcrossSections() async throws {
    try await createNamedTabs(["First UI Tab", "Second UI Tab", "Third UI Tab"])

    let firstTab = tabRow(named: "First UI Tab", in: regularSection)
    let thirdTab = tabRow(named: "Third UI Tab", in: regularSection)
    firstTab.press(forDuration: 0.5, thenDragTo: thirdTab)

    let didReorder = await waitForTabOrder(["Second UI Tab", "Third UI Tab", "First UI Tab"])
    XCTAssertTrue(didReorder)

    let secondTab = tabRow(named: "Second UI Tab", in: regularSection)
    try clickContextMenuItem("Pin Tab", on: secondTab)
    let didPinSecondTab = await waitForTab(named: "Second UI Tab", in: pinnedSection)
    XCTAssertTrue(didPinSecondTab)

    let thirdTabInRegularSection = tabRow(named: "Third UI Tab", in: regularSection)
    let secondTabInPinnedSection = tabRow(named: "Second UI Tab", in: pinnedSection)
    thirdTabInRegularSection.press(forDuration: 0.5, thenDragTo: secondTabInPinnedSection)

    let didPinThirdTab = await waitForTab(named: "Third UI Tab", in: pinnedSection)
    XCTAssertTrue(didPinThirdTab)
    XCTAssertFalse(tabRow(named: "Third UI Tab", in: regularSection).exists)
  }

  @MainActor
  private var tabRows: XCUIElementQuery {
    app.buttons.matching(
      identifier: SupatermUITestIdentifier.Accessibility.sidebarTabRow
    )
  }

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
  private var spaceButtons: XCUIElementQuery {
    app.buttons.matching(
      identifier: SupatermUITestIdentifier.Accessibility.sidebarSpaceButton
    )
  }

  @MainActor
  private var pinnedSection: XCUIElement {
    app.descendants(matching: .any).matching(
      identifier: SupatermUITestIdentifier.Accessibility.sidebarPinnedSection
    ).firstMatch
  }

  @MainActor
  private var regularSection: XCUIElement {
    app.descendants(matching: .any).matching(
      identifier: SupatermUITestIdentifier.Accessibility.sidebarRegularSection
    ).firstMatch
  }

  @MainActor
  private func tabRow(named title: String, in container: XCUIElement? = nil) -> XCUIElement {
    let buttons = container?.descendants(matching: .button) ?? app.buttons
    return buttons.matching(
      identifier: SupatermUITestIdentifier.Accessibility.sidebarTabRow
    ).matching(
      NSPredicate(format: "label CONTAINS %@", title)
    ).firstMatch
  }

  @MainActor
  private func spaceButton(named name: String) -> XCUIElement {
    spaceButtons.matching(
      NSPredicate(format: "label == %@", "Space \(name)")
    ).firstMatch
  }

  @MainActor
  private func renameSelectedTab(to title: String) async throws {
    try clickMenuItem(.changeTabTitle)

    let sheet = mainWindow.sheets.firstMatch
    XCTAssertTrue(sheet.waitForExistence(timeout: 10))
    XCTAssertTrue(sheet.staticTexts["Change Tab Title"].exists)

    let titleField = sheet.textFields.firstMatch
    XCTAssertTrue(titleField.waitForExistence(timeout: 10))
    titleField.click()
    titleField.typeKey("a", modifierFlags: .command)
    titleField.typeText(title)
    sheet.buttons["OK"].click()

    let didDismissSheet = await wait(for: sheet) { !$0.exists }
    XCTAssertTrue(didDismissSheet)
    let didUpdateTitle = await wait(for: tabRow(named: title)) { $0.exists }
    XCTAssertTrue(didUpdateTitle)
  }

  @MainActor
  private func createNamedTabs(_ titles: [String]) async throws {
    precondition(!titles.isEmpty)
    _ = mainWindow
    let didShowInitialTab = await waitForCount(tabRows, equals: 1, timeout: .seconds(30))
    XCTAssertTrue(didShowInitialTab)

    for (index, title) in titles.enumerated() {
      if index > 0 {
        try clickMenuItem(.newTab)
        let didCreateTab = await waitForCount(
          tabRows,
          equals: index + 1,
          timeout: .seconds(30)
        )
        XCTAssertTrue(didCreateTab)
      }
      try await renameSelectedTab(to: title)
    }
  }

  @MainActor
  private func closeSelectedTab() throws {
    try clickMenuItem(.closeTab)

    let closeSheet = mainWindow.sheets.firstMatch
    XCTAssertTrue(closeSheet.waitForExistence(timeout: 10))
    let closeButton = closeSheet.buttons["Close"]
    XCTAssertTrue(closeButton.waitForExistence(timeout: 10))
    closeButton.click()
  }

  @MainActor
  private func sendClaudeEvent(_ event: String) async throws {
    let terminal = mainTerminal
    let didBecomeHittable = await wait(for: terminal, timeout: Self.coldStartTimeout) {
      $0.exists && $0.isHittable
    }
    XCTAssertTrue(didBecomeHittable)

    terminal.click()
    terminal.typeText(
      "\"$SUPATERM_CLI_PATH\" internal dev claude \(event)"
        + " --socket \"$SUPATERM_SOCKET_PATH\" --session-id \(Self.pinnedStatusSessionID)"
    )
    terminal.typeKey(.return, modifierFlags: [])

    let expectedOutput = "sent \(event) for session \(Self.pinnedStatusSessionID)"
    let didSend = await wait(for: terminal, timeout: Self.coldStartTimeout) {
      ($0.value as? String)?.contains(expectedOutput) == true
    }
    XCTAssertTrue(didSend)
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
    let focusedPane = focusedTerminalPane(identifier: pane.identifier)
    let didFocus = await wait(for: focusedPane) { $0.exists }
    XCTAssertTrue(didFocus, "Expected pane \(pane.identifier) to have keyboard focus")
  }

  @MainActor
  private func focusedTerminalPane(identifier: String) -> XCUIElement {
    focusedTerminalPanes.matching(identifier: identifier).firstMatch
  }

  @MainActor
  private func createSpace(named name: String) async throws {
    let createButtonCandidate = app.buttons[
      SupatermUITestIdentifier.Accessibility.sidebarCreateSpaceButton
    ]
    let createButton = try XCTUnwrap(
      createButtonCandidate.waitForExistence(timeout: 10) ? createButtonCandidate : nil
    )
    createButton.coordinate(
      withNormalizedOffset: CGVector(dx: 0.5, dy: 0.1)
    ).click()

    let nameFieldCandidate = app.textFields[
      SupatermUITestIdentifier.Accessibility.dialogSpaceName
    ]
    let nameField = try XCTUnwrap(
      nameFieldCandidate.waitForExistence(timeout: 10) ? nameFieldCandidate : nil
    )
    nameField.typeText(name)

    let confirmCandidate = app.buttons[
      SupatermUITestIdentifier.Accessibility.dialogConfirm
    ]
    let confirm = try XCTUnwrap(
      confirmCandidate.waitForExistence(timeout: 10) ? confirmCandidate : nil
    )
    confirm.click()

    let didDismissEditor = await wait(for: nameField) { !$0.exists }
    XCTAssertTrue(didDismissEditor)
  }

  @MainActor
  private func enterFullScreen() async throws {
    let buttonCandidate = mainWindow.buttons["Enter full screen"]
    let button = try XCTUnwrap(
      buttonCandidate.waitForExistence(timeout: 10) ? buttonCandidate : nil
    )
    button.click()

    let createButton = app.buttons[
      SupatermUITestIdentifier.Accessibility.sidebarCreateSpaceButton
    ]
    let didMoveAboveDock = await wait(for: createButton) {
      $0.frame.maxY <= self.app.frame.maxY - 20
    }
    XCTAssertTrue(didMoveAboveDock)
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
  private func waitForTab(
    named title: String,
    in container: XCUIElement
  ) async -> Bool {
    await wait(for: tabRow(named: title, in: container)) { $0.exists }
  }

  @MainActor
  private func waitForSelection(_ element: XCUIElement) async -> Bool {
    await wait(for: element) { $0.isSelected }
  }

  @MainActor
  private func waitForTabOrder(
    _ titles: [String],
    timeout: Duration = .seconds(10)
  ) async -> Bool {
    precondition(!titles.isEmpty)
    return await wait(for: tabRows.element(boundBy: titles.count - 1), timeout: timeout) { _ in
      guard self.tabRows.count == titles.count else { return false }
      return titles.indices.allSatisfy {
        self.tabRows.element(boundBy: $0).label.contains(titles[$0])
      }
    }
  }
}

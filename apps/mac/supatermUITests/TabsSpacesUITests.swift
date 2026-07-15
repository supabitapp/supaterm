import XCTest

final class TabsSpacesUITests: SupatermUITestCase {
  @MainActor
  func testNewAndCloseTabUpdateSidebarRows() async throws {
    _ = mainWindow
    let didShowInitialTab = await waitForCount(tabRows, equals: 1, timeout: .seconds(30))
    XCTAssertTrue(didShowInitialTab)

    try clickMenuItem(.newTab)

    let didCreateTab = await waitForCount(tabRows, equals: 2, timeout: .seconds(30))
    XCTAssertTrue(didCreateTab)

    try clickMenuItem(.closeTab)

    let closeSheet = mainWindow.sheets.firstMatch
    XCTAssertTrue(closeSheet.waitForExistence(timeout: 10))
    let closeButton = closeSheet.buttons["Close"]
    XCTAssertTrue(closeButton.waitForExistence(timeout: 10))
    closeButton.click()

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
    _ = mainWindow
    let didShowInitialTab = await waitForCount(tabRows, equals: 1, timeout: .seconds(30))
    XCTAssertTrue(didShowInitialTab)

    try await renameSelectedTab(to: "First UI Tab")
    try clickMenuItem(.newTab)
    let didCreateSecondTab = await waitForCount(tabRows, equals: 2, timeout: .seconds(30))
    XCTAssertTrue(didCreateSecondTab)
    try await renameSelectedTab(to: "Second UI Tab")
    try clickMenuItem(.newTab)
    let didCreateThirdTab = await waitForCount(tabRows, equals: 3, timeout: .seconds(30))
    XCTAssertTrue(didCreateThirdTab)
    try await renameSelectedTab(to: "Third UI Tab")

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
  private var tabRows: XCUIElementQuery {
    app.buttons.matching(
      identifier: SupatermUITestIdentifier.Accessibility.sidebarTabRow
    )
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
}

import XCTest

final class SpaceLifecycleUITests: SupatermUITestCase {
  @MainActor
  func testCreateSwitchRenameAndDeleteSpace() async throws {
    await requireInitialSidebarTab()
    XCTAssertEqual(spaceDots.count, 1)

    try await createSpace(named: "UI Space")

    let didDisplayCreatedSpace = await waitForDisplayedSpace(named: "UI Space")
    XCTAssertTrue(didDisplayCreatedSpace)
    let didAddSpaceDot = await waitForSidebarElementCount(spaceDots, equals: 2)
    XCTAssertTrue(didAddSpaceDot)
    XCTAssertEqual(app.windows.count, 1)

    app.typeKey("1", modifierFlags: .control)

    let didDisplayInitialSpace = await waitForDisplayedSpace(named: "Space 1")
    XCTAssertTrue(didDisplayInitialSpace)

    app.typeKey("2", modifierFlags: .control)

    let didReturnToCreatedSpace = await waitForDisplayedSpace(named: "UI Space")
    XCTAssertTrue(didReturnToCreatedSpace)

    let nameField = try await openSpaceEditor("Edit Space", titled: "Edit Space")
    nameField.click()
    nameField.typeKey("a", modifierFlags: .command)
    nameField.typeText("Renamed UI Space")

    let greenSwatch = app.buttons[
      SupatermUITestIdentifier.Accessibility.dialogSpaceColorPrefix + "green"
    ]
    XCTAssertTrue(greenSwatch.waitForExistence(timeout: 10))
    greenSwatch.click()

    try await saveSpaceEditor()

    let didRenameSpace = await waitForDisplayedSpace(named: "Renamed UI Space")
    XCTAssertTrue(didRenameSpace)
    let didDropOldSpaceDot = await wait { !self.spaceDot(named: "UI Space").exists }
    XCTAssertTrue(didDropOldSpaceDot)

    displayedSpace.click()
    let deleteSpace = app.menuItems["Delete Space"]
    XCTAssertTrue(deleteSpace.waitForExistence(timeout: 10))
    deleteSpace.click()

    let deleteSheet = app.sheets.firstMatch
    XCTAssertTrue(deleteSheet.waitForExistence(timeout: 10))
    let deleteTitle = deleteSheet.staticTexts["Delete Space \"Renamed UI Space\"?"]
    XCTAssertTrue(deleteTitle.waitForExistence(timeout: 10))
    let deleteButton = deleteSheet.buttons["Delete"]
    XCTAssertTrue(deleteButton.waitForExistence(timeout: 10))
    deleteButton.click()

    let didDisplayNeighborSpace = await waitForDisplayedSpace(named: "Space 1")
    XCTAssertTrue(didDisplayNeighborSpace)
    let didRemoveSpaceDot = await waitForSidebarElementCount(spaceDots, equals: 1)
    XCTAssertTrue(didRemoveSpaceDot)
    XCTAssertFalse(spaceDot(named: "Renamed UI Space").exists)
    XCTAssertEqual(app.windows.count, 1)
  }

  @MainActor
  private func createSpace(named name: String) async throws {
    let nameField = try await openSpaceEditor("New Space", titled: "Create Space")
    nameField.typeText(name)

    try await saveSpaceEditor()
  }

  @MainActor
  private func openSpaceEditor(
    _ menuTitle: String,
    titled title: String
  ) async throws -> XCUIElement {
    let nameField = app.textFields[SupatermUITestIdentifier.Accessibility.dialogSpaceName]
    for _ in 0..<3 {
      try require(displayedSpace).click()
      try require(app.menuItems[menuTitle]).click()
      let didOpenEditor = await wait(timeout: .seconds(5)) {
        self.app.staticTexts[title].exists && nameField.exists
      }
      if didOpenEditor { return nameField }
      app.typeKey(.escape, modifierFlags: [])
    }
    XCTFail("\(menuTitle) never opened \(title)")
    return try require(nameField)
  }

  @MainActor
  private func saveSpaceEditor() async throws {
    let editor = try require(element(SupatermUITestIdentifier.Accessibility.dialogSurface))
    try require(app.buttons[SupatermUITestIdentifier.Accessibility.dialogConfirm]).click()
    let didDismissEditor = await wait(for: editor) { !$0.exists }
    XCTAssertTrue(didDismissEditor)
  }
}

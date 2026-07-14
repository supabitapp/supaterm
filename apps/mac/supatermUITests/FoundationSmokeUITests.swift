import XCTest

final class FoundationSmokeUITests: SupatermUITestCase {
  @MainActor
  func testFoundationStack() async {
    _ = mainWindow

    let tabRows = app.buttons.matching(
      identifier: SupatermUITestIdentifier.Accessibility.sidebarTabRow
    )
    XCTAssertTrue(tabRows.firstMatch.waitForExistence(timeout: 30))

    clickMenuItem(.newTab)

    let didCreateSecondTab = await wait(
      for: tabRows.element(boundBy: 1),
      timeout: .seconds(30)
    ) { $0.exists }
    XCTAssertTrue(didCreateSecondTab)
    XCTAssertEqual(tabRows.count, 2)

    clickMenuItem(.openCommandPalette)

    let paletteInput = app.textFields[
      SupatermUITestIdentifier.Accessibility.paletteInput
    ]
    XCTAssertTrue(paletteInput.waitForExistence(timeout: 10))

    app.typeKey(.escape, modifierFlags: [])

    let didDismissPalette = await wait(for: paletteInput) { !$0.exists }
    XCTAssertTrue(didDismissPalette)
  }
}

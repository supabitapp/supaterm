import XCTest

final class SidebarHoverCardUITests: SupatermUITestCase {
  @MainActor
  func testOrdinaryTabHoverShowsItsWorkingDirectory() async throws {
    try await createNamedTabs(["Plain Tab"])
    let tab = try require(sidebarTabRow(named: "Plain Tab"))

    mainTerminal.click()
    mainTerminal.typeText("printf '\\033]7;file://localhost/tmp\\007'")
    mainTerminal.typeKey(.return, modifierFlags: [])
    tab.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.5)).hover()

    let workingDirectory = app.buttons["Copy working directory"].firstMatch
    let didShowWorkingDirectory = await wait(for: workingDirectory) {
      $0.exists && $0.value as? String == "/tmp"
    }
    XCTAssertTrue(didShowWorkingDirectory)
  }
}

import XCTest

final class SidebarHoverCardUITests: SupatermUITestCase {
  @MainActor
  func testOrdinaryTabHoverShowsItsWorkingDirectory() async throws {
    try await createNamedTabs(["Plain Tab"])
    let tab = try require(sidebarTabRow(named: "Plain Tab"))

    tab.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.5)).hover()

    let workingDirectory = app.buttons["Copy working directory"].firstMatch
    let didShowWorkingDirectory = await wait(for: workingDirectory) {
      guard $0.exists, let path = $0.value as? String else { return false }
      return !path.isEmpty
    }
    XCTAssertTrue(didShowWorkingDirectory)
  }
}

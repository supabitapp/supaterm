import XCTest

final class PaneZoomUITests: SupatermUITestCase {
  @MainActor
  func testDoubleClickingPaneHeaderTogglesZoom() async throws {
    let leftPane = try await requireVisiblePanes(count: 1)[0]
    leftPane.click()
    try await requireFocus(on: leftPane)

    let leftTitle = "pane-header-\(UUID().uuidString.prefix(8))"
    leftPane.typeText("printf '\\033]0;\(leftTitle)\\007'; sleep 600\n")
    let didSetTitle = await wait(for: leftPane, timeout: .seconds(30)) {
      $0.label == leftTitle
    }
    XCTAssertTrue(didSetTitle)

    let splitRightButton = try require(app.buttons["Split right"])
    splitRightButton.click()
    _ = try await requireVisiblePanes(count: 2)

    try clickMenuItem(.selectSplitLeft)
    try await requireFocus(on: leftPane)

    let title = try require(app.staticTexts[leftTitle])
    title.doubleClick()

    let zoomedPanes = try await requireVisiblePanes(count: 1)
    XCTAssertEqual(zoomedPanes[0].identifier, leftPane.identifier)

    let emptyHeaderWidth = splitRightButton.frame.minX - title.frame.maxX
    XCTAssertGreaterThan(emptyHeaderWidth, 8)
    title
      .coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 0.5))
      .withOffset(CGVector(dx: emptyHeaderWidth / 2, dy: 0))
      .doubleClick()

    _ = try await requireVisiblePanes(count: 2)
    leftPane.click()
    app.typeKey("c", modifierFlags: .control)
  }

  @MainActor
  func testToggleSplitZoomFocusesTargetPane() async throws {
    _ = try await requireVisiblePanes(count: 1)
    try clickMenuItem(.splitRight)
    let panes = try await requireVisiblePanes(count: 2)
    let leftPane = try XCTUnwrap(panes.min { $0.frame.midX < $1.frame.midX })
    let paneIdentifiers = Set(panes.map(\.identifier))

    try clickMenuItem(.selectSplitLeft)
    try await requireFocus(on: leftPane)

    try clickMenuItem(.zoomSplit)
    let zoomedPanes = try await requireVisiblePanes(count: 1)
    XCTAssertEqual(zoomedPanes[0].identifier, leftPane.identifier)
    try await requireFocus(on: leftPane)

    try clickMenuItem(.zoomSplit)
    let restoredPanes = try await requireVisiblePanes(count: 2)
    XCTAssertEqual(Set(restoredPanes.map(\.identifier)), paneIdentifiers)
    try await requireFocus(on: leftPane)
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
}

import XCTest

final class TabSelectionUITests: SupatermUITestCase {
  private static let coldStartTimeout: Duration = .seconds(60)

  @MainActor
  func testSelectingTabFocusesLatestUnreadPane() async throws {
    let initialPanes = try await requireVisiblePanes(count: 1)
    let paneAIdentifier = initialPanes[0].identifier

    try clickMenuItem(.splitRight)
    let panes = try await requireVisiblePanes(count: 2)
    let paneA = try XCTUnwrap(panes.first { $0.identifier == paneAIdentifier })
    let paneB = try XCTUnwrap(panes.max { $0.frame.midX < $1.frame.midX })
    let panePrefix = SupatermUITestIdentifier.Accessibility.terminalPanePrefix
    let paneBID = String(paneB.identifier.dropFirst(panePrefix.count))

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

    let firstTab = sidebarTabRows.element(boundBy: 0)
    let didRegisterUnread = await wait(for: firstTab, timeout: Self.coldStartTimeout) {
      $0.label.contains("1 unread notification")
    }
    XCTAssertTrue(didRegisterUnread)

    try clickMenuItem(.newTab)
    let secondTab = sidebarTabRows.element(boundBy: 1)
    let didSelectSecondTab = await wait(for: secondTab, timeout: Self.coldStartTimeout) {
      $0.exists && $0.isHittable && $0.isSelected
    }
    XCTAssertTrue(didSelectSecondTab)

    firstTab.click()
    let didSelectFirstTab = await waitForSidebarSelection(firstTab)
    XCTAssertTrue(didSelectFirstTab)
    try await requireFocus(on: paneB)

    let didClearUnread = await wait(for: firstTab, timeout: Self.coldStartTimeout) {
      !$0.label.contains("unread notification")
    }
    XCTAssertTrue(didClearUnread)
  }
}

import XCTest

final class SidebarIndicatorTooltipUITests: SupatermUITestCase {
  @MainActor
  func testAgentIndicatorHelpOverridesTabTitleHelp() async throws {
    let tab = await requireFirstTab()

    try await startClaudeSession()
    let didShowAgentStatus = await wait(for: tab, timeout: AgentUITest.coldStartTimeout) {
      $0.label.contains("Agent working")
    }
    XCTAssertTrue(didShowAgentStatus)

    hoverTrailingIndicator(in: tab)
    try require(helpTag(labeled: "Agent working"), timeout: 5)
  }

  @MainActor
  func testAttentionIndicatorHelpOverridesTabTitleHelp() async throws {
    let panes = try await requireVisiblePanes(count: 1)
    let firstPane = panes[0]

    try clickMenuItem(.splitRight)
    let splitPanes = try await requireVisiblePanes(count: 2)
    let secondPane = try XCTUnwrap(splitPanes.first { $0.identifier != firstPane.identifier })
    let paneID = String(
      secondPane.identifier.dropFirst(
        SupatermUITestIdentifier.Accessibility.terminalPanePrefix.count
      )
    )

    firstPane.click()
    firstPane.typeText(
      "\"$SUPATERM_CLI_PATH\" pane notify \(paneID) --body indicator-help"
        + " --socket \"$SUPATERM_SOCKET_PATH\""
    )
    firstPane.typeKey(.return, modifierFlags: [])

    let tab = sidebarTabRows.firstMatch
    let didShowAttention = await wait(for: tab, timeout: AgentUITest.coldStartTimeout) {
      $0.label.contains("Terminal attention")
    }
    XCTAssertTrue(didShowAttention)

    hoverTrailingIndicator(in: tab)
    try require(helpTag(labeled: "Terminal attention"), timeout: 5)
  }

  @MainActor
  private func hoverTrailingIndicator(in tab: XCUIElement) {
    tab.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 0.5))
      .withOffset(CGVector(dx: -22, dy: 0))
      .hover()
  }

  @MainActor
  private func helpTag(labeled label: String) -> XCUIElement {
    app.descendants(matching: .helpTag)
      .matching(NSPredicate(format: "label == %@", label))
      .firstMatch
  }
}

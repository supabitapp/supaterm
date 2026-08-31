import XCTest

final class SidebarIndicatorTooltipUITests: SupatermUITestCase {
  @MainActor
  func testAgentIndicatorHelpOverridesTabTitleHelp() async throws {
    let tab = await requireFirstTab()

    startAgentTurn()
    let didShowAgentStatus = await wait(for: tab, timeout: AgentUITest.coldStartTimeout) {
      $0.label.contains("Agent working")
    }
    XCTAssertTrue(didShowAgentStatus)

    hoverTitle(in: tab)
    XCTAssertTrue(tab.label.contains("Agent working"))
    hoverTrailingIndicator(in: tab)
    try require(helpTag(labeled: "Agent working"), timeout: 5)
  }

  @MainActor
  func testAttentionIndicatorHelpOverridesTabTitleHelp() async throws {
    let firstPaneIdentifier = try await requireVisiblePanes(count: 1)[0].identifier

    try clickMenuItem(.splitRight)
    let splitPanes = try await requireVisiblePanes(count: 2)
    let firstPane = try XCTUnwrap(
      splitPanes.first { $0.identifier == firstPaneIdentifier }
    )
    let secondPane = try XCTUnwrap(
      splitPanes.first { $0.identifier != firstPaneIdentifier }
    )
    let paneID = String(
      secondPane.identifier.dropFirst(
        SupatermUITestIdentifier.Accessibility.terminalPanePrefix.count
      )
    )

    firstPane.click()
    try await requireFocus(on: firstPane)
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

    hoverTitle(in: tab, lineIndex: 1, lineCount: 2)
    XCTAssertTrue(tab.label.contains("Terminal attention"))
    hoverTrailingIndicator(in: tab, lineIndex: 1, lineCount: 2)
    try require(helpTag(labeled: "Terminal attention"), timeout: 5)
  }

  @MainActor
  private func startAgentTurn() {
    let sessionStart = #"{"session_id":"indicator-tooltip","hook_event_name":"session_start"}"#
    let agentStart = #"{"session_id":"indicator-tooltip","hook_event_name":"agent_start"}"#
    let receiveHook =
      "\"$SUPATERM_CLI_PATH\" agent receive-agent-hook --agent pi"
      + " --socket \"$SUPATERM_SOCKET_PATH\""
    let terminal = mainTerminal

    terminal.click()
    terminal.typeText(
      "printf '%s' '\(sessionStart)' | \(receiveHook)"
        + " && printf '%s' '\(agentStart)' | \(receiveHook)"
    )
    terminal.typeKey(.return, modifierFlags: [])
  }

  @MainActor
  private func hoverTitle(
    in tab: XCUIElement,
    lineIndex: Int = 0,
    lineCount: Int = 1
  ) {
    coordinate(
      in: tab,
      horizontalPosition: 0.25,
      lineIndex: lineIndex,
      lineCount: lineCount
    ).hover()
  }

  @MainActor
  private func hoverTrailingIndicator(
    in tab: XCUIElement,
    lineIndex: Int = 0,
    lineCount: Int = 1
  ) {
    coordinate(
      in: tab,
      horizontalPosition: 1,
      lineIndex: lineIndex,
      lineCount: lineCount
    )
    .withOffset(CGVector(dx: -22, dy: 0))
    .hover()
  }

  @MainActor
  private func coordinate(
    in tab: XCUIElement,
    horizontalPosition: CGFloat,
    lineIndex: Int,
    lineCount: Int
  ) -> XCUICoordinate {
    let lineMidpoint = (CGFloat(lineIndex) + 0.5) / CGFloat(lineCount)
    return tab.coordinate(
      withNormalizedOffset: CGVector(dx: horizontalPosition, dy: lineMidpoint)
    )
  }

  @MainActor
  private func helpTag(labeled label: String) -> XCUIElement {
    app.descendants(matching: .helpTag)
      .matching(NSPredicate(format: "label == %@", label))
      .firstMatch
  }
}

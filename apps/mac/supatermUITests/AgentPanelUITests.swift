import XCTest

final class AgentPanelUITests: SupatermUITestCase {
  private static let coldStartTimeout: Duration = .seconds(60)
  private static let sessionID = "agent-panel-ui-tests"

  @MainActor
  func testCommandIAndMenuItemToggleAgentPanel() async throws {
    _ = mainWindow
    try await sendClaudeEvent("session-start")
    try await assertAgentPanelMenuItem(isEnabled: true)

    let panel = agentPanel
    await assertEventually(panel, timeout: Self.coldStartTimeout) { $0.exists }

    app.typeKey("i", modifierFlags: .command)
    await assertEventually(panel, timeout: Self.coldStartTimeout) { !$0.exists }

    app.typeKey("i", modifierFlags: .command)
    await assertEventually(panel, timeout: Self.coldStartTimeout) { $0.exists }

    try clickMenuItem(.toggleAgentPanel)
    await assertEventually(panel, timeout: Self.coldStartTimeout) { !$0.exists }
  }

  @MainActor
  func testCopySessionIDShowsTemporaryCopiedFeedback() async throws {
    _ = mainWindow
    try await sendClaudeEvent("session-start")
    try await sendClaudeEvent("user-prompt-submit")

    let copyButton = agentPanel.buttons.matching(
      NSPredicate(format: "label IN %@", ["Copy session ID", "Copied"])
    ).firstMatch
    await assertEventually(copyButton, timeout: Self.coldStartTimeout) {
      $0.exists
    }

    copyButton.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).click()

    await assertEventually(copyButton) { $0.label == "Copied" }
    await assertEventually(copyButton) { $0.label == "Copy session ID" }
  }

  @MainActor
  func testClaudeLifecycleUpdatesSidebarAndPanel() async throws {
    let tabRows = sidebarTabRows
    let firstTab = await requireFirstTab()

    try await sendClaudeEvent("session-start")
    try await sendClaudeEvent("user-prompt-submit")

    await assertEventually(firstTab, timeout: Self.coldStartTimeout) {
      $0.label.contains("Agent activity: Running")
    }
    try await assertAgentPanelMenuItem(isEnabled: true)

    try await sendClaudeEvent("notification")
    try clickMenuItem(.newTab, timeout: 60)

    let secondTab = tabRows.element(boundBy: 1)
    await assertEventually(secondTab, timeout: Self.coldStartTimeout) {
      $0.exists && $0.isHittable && $0.isSelected
    }
    await selectTab(firstTab)
    await selectTab(secondTab)
    await assertEventually(firstTab, timeout: Self.coldStartTimeout) {
      $0.label.contains("Agent activity: Needs input")
    }

    await selectTab(firstTab)
    try await sendClaudeEvent("stop")

    await assertEventually(firstTab, timeout: Self.coldStartTimeout) {
      $0.label.contains("Done.") && !$0.label.contains("Agent activity:")
    }
    try await sendClaudeEvent("session-end")
    try await assertAgentPanelMenuItem(isEnabled: false)
  }

  @MainActor
  func testNewSessionInSamePaneReplacesForegroundAgentSession() async throws {
    let firstTab = await requireFirstTab()

    try await sendClaudeEvent("session-start", sessionID: "fork-parent-session")
    try await sendClaudeEvent("user-prompt-submit", sessionID: "fork-parent-session")
    await assertEventually(firstTab, timeout: Self.coldStartTimeout) {
      $0.label.contains("Agent activity: Running")
    }

    try await sendClaudeEvent("session-start", sessionID: "fork-child-session")
    await assertEventually(firstTab, timeout: Self.coldStartTimeout) {
      !$0.label.contains("Agent activity:")
    }

    try await sendClaudeEvent("user-prompt-submit", sessionID: "fork-child-session")
    await assertEventually(firstTab, timeout: Self.coldStartTimeout) {
      $0.label.contains("Agent activity: Running")
    }

    try await sendClaudeEvent("stop", sessionID: "fork-child-session")
    await assertEventually(firstTab, timeout: Self.coldStartTimeout) {
      $0.label.contains("Done.") && !$0.label.contains("Agent activity:")
    }

    try await sendClaudeEvent("session-end", sessionID: "fork-child-session")
    try await sendClaudeEvent("session-end", sessionID: "fork-parent-session")
    try await assertAgentPanelMenuItem(isEnabled: false)
  }

  @MainActor
  func testSessionStartKeepsAgentIdleUntilPromptSubmit() async throws {
    let firstTab = await requireFirstTab()

    try await sendClaudeEvent("session-start")
    try await assertAgentPanelMenuItem(isEnabled: true)
    XCTAssertFalse(firstTab.label.contains("Agent activity:"))

    try await sendClaudeEvent("user-prompt-submit")
    await assertEventually(firstTab, timeout: Self.coldStartTimeout) {
      $0.label.contains("Agent activity: Running")
    }

    try await sendClaudeEvent("stop")
    try await sendClaudeEvent("session-end")
    try await assertAgentPanelMenuItem(isEnabled: false)
  }

  @MainActor
  func testForkedClaudeSessionRecoversSidebarActivityWithoutSessionStart() async throws {
    let firstTab = await requireFirstTab()

    try await sendClaudeEvent("session-start", sessionID: "parent-session")
    try await sendClaudeEvent("user-prompt-submit", sessionID: "forked-session")
    await assertEventually(firstTab, timeout: Self.coldStartTimeout) {
      $0.label.contains("Agent activity: Running")
    }

    try await sendClaudeEvent("stop", sessionID: "forked-session")
    await assertEventually(firstTab, timeout: Self.coldStartTimeout) {
      $0.label.contains("Done.") && !$0.label.contains("Agent activity:")
    }
  }

  @MainActor
  private func requireFirstTab() async -> XCUIElement {
    let terminal = mainTerminal
    await assertEventually(terminal, timeout: Self.coldStartTimeout) {
      $0.exists && $0.isHittable
    }

    let firstTab = sidebarTabRows.element(boundBy: 0)
    await assertEventually(firstTab, timeout: Self.coldStartTimeout) {
      $0.exists && $0.isHittable
    }
    return firstTab
  }

  @MainActor
  private var agentPanel: XCUIElement {
    element("agent-panel")
  }

  @MainActor
  private func selectTab(_ tab: XCUIElement) async {
    tab.click()
    await assertEventually(tab, timeout: Self.coldStartTimeout) { $0.isSelected }
  }

  @MainActor
  private func assertAgentPanelMenuItem(isEnabled: Bool) async throws {
    let identifier = SupatermUITestIdentifier.MenuItemIdentifier.toggleAgentPanel
    let topLevelMenu = app.menuBars.menuBarItems[identifier.menuTitle]
    await assertEventually(topLevelMenu, timeout: Self.coldStartTimeout) {
      $0.exists && $0.isHittable
    }
    topLevelMenu.click()

    let item = menuItem(identifier)
    await assertEventually(item, timeout: Self.coldStartTimeout) { $0.exists }
    await assertEventually(item, timeout: Self.coldStartTimeout) { $0.isEnabled == isEnabled }
    app.typeKey(.escape, modifierFlags: [])
  }

  @MainActor
  private func sendClaudeEvent(
    _ event: String,
    sessionID: String = AgentPanelUITests.sessionID
  ) async throws {
    let terminal = mainTerminal
    await assertEventually(terminal, timeout: Self.coldStartTimeout) {
      $0.exists && $0.isHittable
    }

    terminal.click()
    terminal.typeText(
      "\"$SUPATERM_CLI_PATH\" internal dev claude \(event)"
        + " --socket \"$SUPATERM_SOCKET_PATH\" --session-id \(sessionID)"
    )
    terminal.typeKey(.return, modifierFlags: [])

    let expectedOutput = "sent \(event) for session \(sessionID)"
    await assertEventually(terminal, timeout: Self.coldStartTimeout) {
      ($0.value as? String)?.contains(expectedOutput) == true
    }
  }

  @MainActor
  private func assertEventually(
    _ element: XCUIElement,
    timeout: Duration = .seconds(10),
    file: StaticString = #filePath,
    line: UInt = #line,
    until condition: (XCUIElement) -> Bool
  ) async {
    let didMatch = await wait(for: element, timeout: timeout, until: condition)
    XCTAssertTrue(didMatch, file: file, line: line)
  }

}

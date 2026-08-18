import XCTest

final class AgentPanelUITests: SupatermUITestCase {
  @MainActor
  func testCommandIAndMenuItemToggleAgentPanel() async throws {
    _ = mainWindow
    try await startClaudeSession()
    try await assertAgentPanelMenuItem(isEnabled: true)

    let panel = agentPanel
    await assertEventually(panel, timeout: AgentUITest.coldStartTimeout) { $0.exists }

    app.typeKey("i", modifierFlags: .command)
    await assertEventually(panel, timeout: AgentUITest.coldStartTimeout) { !$0.exists }

    app.typeKey("i", modifierFlags: .command)
    await assertEventually(panel, timeout: AgentUITest.coldStartTimeout) { $0.exists }

    try clickMenuItem(.toggleAgentPanel)
    await assertEventually(panel, timeout: AgentUITest.coldStartTimeout) { !$0.exists }
  }

  @MainActor
  func testCopySessionIDShowsTemporaryInlineFeedback() async throws {
    _ = mainWindow
    try await startClaudeSession()

    let panel = agentPanel
    let copyButton = panel.buttons.matching(
      NSPredicate(format: "label IN %@", ["Copy session ID", "Copied"])
    ).firstMatch
    await assertEventually(copyButton, timeout: AgentUITest.coldStartTimeout) {
      $0.exists
    }

    copyButton.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).click()

    await assertEventually(copyButton) { $0.label == "Copied" }
    XCTAssertFalse(
      panel.descendants(matching: .any).matching(identifier: "toast.surface").firstMatch.exists
    )
    await assertEventually(copyButton) { $0.label == "Copy session ID" }
  }
}

import XCTest

enum AgentUITest {
  static let coldStartTimeout: Duration = .seconds(60)
  static let sessionID = "agent-panel-ui-tests"
}

extension SupatermUITestCase {
  @MainActor
  var agentPanel: XCUIElement {
    element("agent-panel")
  }

  @MainActor
  func requireFirstTab() async -> XCUIElement {
    let terminal = mainTerminal
    await assertEventually(terminal, timeout: AgentUITest.coldStartTimeout) {
      $0.exists && $0.isHittable
    }

    let firstTab = sidebarTabRows.element(boundBy: 0)
    await assertEventually(firstTab, timeout: AgentUITest.coldStartTimeout) {
      $0.exists && $0.isHittable
    }
    return firstTab
  }

  @MainActor
  func selectTab(_ tab: XCUIElement) async {
    tab.click()
    await assertEventually(tab, timeout: AgentUITest.coldStartTimeout) { $0.isSelected }
  }

  @MainActor
  func assertAgentPanelMenuItem(isEnabled: Bool) async throws {
    let identifier = SupatermUITestIdentifier.MenuItemIdentifier.toggleAgentPanel
    let topLevelMenu = app.menuBars.menuBarItems[identifier.menuTitle]
    await assertEventually(topLevelMenu, timeout: AgentUITest.coldStartTimeout) {
      $0.exists && $0.isHittable
    }
    topLevelMenu.click()

    let item = menuItem(identifier)
    await assertEventually(item, timeout: AgentUITest.coldStartTimeout) { $0.exists }
    await assertEventually(item, timeout: AgentUITest.coldStartTimeout) {
      $0.isEnabled == isEnabled
    }
    app.typeKey(.escape, modifierFlags: [])
  }

  @MainActor
  func startClaudeSession(
    sessionID: String = AgentUITest.sessionID
  ) async throws {
    let terminal = mainTerminal
    await assertEventually(terminal, timeout: AgentUITest.coldStartTimeout) {
      $0.exists && $0.isHittable
    }

    terminal.click()
    terminal.typeText(
      "\"$SUPATERM_CLI_PATH\" internal dev claude session-start"
        + " --socket \"$SUPATERM_SOCKET_PATH\" --session-id \(sessionID)"
    )
    terminal.typeKey(.return, modifierFlags: [])

    let expectedOutput = "sent session-start for session \(sessionID)"
    await assertEventually(terminal, timeout: AgentUITest.coldStartTimeout) {
      ($0.value as? String)?.contains(expectedOutput) == true
    }
  }
}

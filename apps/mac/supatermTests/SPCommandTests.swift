import ArgumentParser
import Foundation
import Testing

@testable import SPCLI

struct SPCommandTests {
  @Test
  func newPaneHelpShowsScriptOptionAndExample() {
    let help = SP.helpMessage(for: SP.NewPane.self, columns: 100)

    #expect(help.contains("--script <script>"))
    #expect(help.contains("sp new-pane down --script"))
  }

  @Test
  func newPaneEqualizeDefaultsToTrueAndCanBeDisabled() throws {
    let defaultCommand = try #require(
      try SP.NewPane.parseAsRoot(["right", "--space", "1", "--tab", "1"]) as? SP.NewPane
    )
    let noEqualizeCommand = try #require(
      try SP.NewPane.parseAsRoot(["right", "--space", "1", "--tab", "1", "--no-equalize"]) as? SP.NewPane
    )

    #expect(defaultCommand.equalize)
    #expect(!noEqualizeCommand.equalize)
  }

  @Test
  func newTabParserAcceptsUUIDSpaceTarget() throws {
    let spaceID = UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!
    let command = try #require(
      try SP.NewTab.parseAsRoot(["--space", spaceID.uuidString]) as? SP.NewTab
    )

    #expect(command.space == .id(spaceID))
  }

  @Test
  func newPaneParserAcceptsUUIDTargets() throws {
    let paneID = UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
    let command = try #require(
      try SP.NewPane.parseAsRoot(["right", "--pane", paneID.uuidString]) as? SP.NewPane
    )

    #expect(command.pane == .id(paneID))
  }

  @Test
  func focusPaneAndSelectTabParsersAcceptUUIDTargets() throws {
    let paneID = UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
    let tabID = UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!

    let focusPane = try #require(
      try SP.FocusPane.parseAsRoot(["--pane", paneID.uuidString]) as? SP.FocusPane
    )
    let selectTab = try #require(
      try SP.SelectTab.parseAsRoot(["--tab", tabID.uuidString]) as? SP.SelectTab
    )

    #expect(focusPane.pane == .id(paneID))
    #expect(selectTab.tab == .id(tabID))
  }

  @Test
  func tmuxParserAcceptsPassThroughCommandName() throws {
    let tmux = try #require(
      try SP.Tmux.parseAsRoot(["display-message"]) as? SP.Tmux
    )

    #expect(tmux.arguments == ["display-message"])
  }

  @Test
  func newTabHelpShowsScriptOptionAndExample() {
    let help = SP.helpMessage(for: SP.NewTab.self, columns: 100)

    #expect(help.contains("--script <script>"))
    #expect(help.contains("sp new-tab --script"))
  }

  @Test
  func installAgentHooksParserAcceptsClaudeAndCodexSubcommands() throws {
    let claudeCommand = try #require(
      try SP.parseAsRoot(["install-agent-hooks", "claude"]) as? SP.InstallAgentHooks.Claude
    )
    let codexCommand = try #require(
      try SP.parseAsRoot(["install-agent-hooks", "codex"]) as? SP.InstallAgentHooks.Codex
    )

    #expect(type(of: claudeCommand) == SP.InstallAgentHooks.Claude.self)
    #expect(type(of: codexCommand) == SP.InstallAgentHooks.Codex.self)
  }

  @Test(arguments: [
    ["new-pane", "right", "--script", "echo 1", "echo", "2"],
    ["new-tab", "--script", "echo 1", "echo", "2"],
  ])
  func parserRejectsScriptWithTrailingCommand(arguments: [String]) {
    do {
      _ = try SP.parseAsRoot(arguments)
      Issue.record("Expected parsing to reject combining --script with a trailing command.")
    } catch {
      let message = String(describing: error)
      #expect(message.contains("--script cannot be used with a trailing command."))
    }
  }

  @Test
  func shellInputRejectsEmptyScript() {
    do {
      _ = try shellInput(script: "", tokens: [])
      Issue.record("Expected shellInput to reject an empty --script.")
    } catch {
      let message = String(describing: error)
      #expect(message.contains("--script must not be empty."))
    }
  }

  @Test(arguments: [
    ["new-tab", "--space", "0"],
    ["new-pane", "right", "--tab", "bad-target"],
    ["notify", "--pane", " "],
  ])
  func parserRejectsInvalidIndexOrUUIDTargets(arguments: [String]) {
    do {
      _ = try SP.parseAsRoot(arguments)
      Issue.record("Expected parsing to reject an invalid target.")
    } catch {
      let message = String(describing: error)
      #expect(message.contains("1-based index or UUID") || message.contains("1 or greater"))
    }
  }
}

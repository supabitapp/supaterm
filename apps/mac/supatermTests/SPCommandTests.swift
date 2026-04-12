import ArgumentParser
import Foundation
import SupatermCLIShared
import Testing

@testable import SPCLI

struct SPCommandTests {
  @Test
  func newPaneHelpShowsScriptOptionAndExample() {
    let help = SP.helpMessage(for: SP.NewPane.self, columns: 100)

    #expect(help.contains("--script <script>"))
    #expect(help.contains("sp pane split down --script 'echo hi; pwd'"))
  }

  @Test
  func newPaneLayoutDefaultsToEqualizeAndCanKeepLayout() throws {
    let defaultCommand = try #require(
      try SP.parseAsRoot(["pane", "split", "right"]) as? SP.NewPane
    )
    let keepLayoutCommand = try #require(
      try SP.parseAsRoot(["pane", "split", "--layout", "keep", "right"]) as? SP.NewPane
    )

    #expect(defaultCommand.layout == .equalize)
    #expect(keepLayoutCommand.layout == .keep)
  }

  @Test
  func newTabParserAcceptsUUIDSpaceTarget() throws {
    let spaceID = UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!
    let command = try #require(
      try SP.parseAsRoot(["tab", "new", "--in", spaceID.uuidString]) as? SP.NewTab
    )

    #expect(command.space == .id(spaceID))
  }

  @Test
  func newPaneParserAcceptsTabAndPaneTargets() throws {
    let paneID = UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
    let tabCommand = try #require(
      try SP.parseAsRoot(["pane", "split", "right", "--in", "1/2"]) as? SP.NewPane
    )
    let paneCommand = try #require(
      try SP.parseAsRoot(["pane", "split", "right", "--in", paneID.uuidString]) as? SP.NewPane
    )

    #expect(tabCommand.container == .tab(.path(spaceIndex: 1, tabIndex: 2)))
    #expect(paneCommand.container == .id(paneID))
  }

  @Test
  func focusPaneAndSelectTabParsersAcceptSelectorTargets() throws {
    let paneID = UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
    let focusPane = try #require(
      try SP.parseAsRoot(["pane", "focus", paneID.uuidString]) as? SP.FocusPane
    )
    let selectTab = try #require(
      try SP.parseAsRoot(["tab", "focus", "1/2"]) as? SP.SelectTab
    )

    #expect(focusPane.pane == .id(paneID))
    #expect(selectTab.tab == .path(spaceIndex: 1, tabIndex: 2))
  }

  @Test
  func notifyParserAcceptsMissingBody() throws {
    let command = try #require(
      try SP.parseAsRoot(["pane", "notify", "--title", "Deploy complete"]) as? SP.Notify
    )

    #expect(command.body == nil)
  }

  @Test
  func notifyParserAcceptsEmptyBody() throws {
    let command = try #require(
      try SP.parseAsRoot(["pane", "notify", "--body", ""]) as? SP.Notify
    )

    #expect(command.body == "")
  }

  @Test
  func tmuxParserAcceptsPassThroughCommandName() throws {
    let tmux = try #require(
      try SP.Tmux.parseAsRoot(["display-message"]) as? SP.Tmux
    )

    #expect(tmux.arguments == ["display-message"])
  }

  @Test
  func runParserAcceptsPassThroughCommandName() throws {
    let run = try #require(
      try SP.Run.parseAsRoot(["--", "claude", "--resume"]) as? SP.Run
    )

    #expect(run.arguments == ["claude", "--resume"])
  }

  @Test
  func newTabHelpShowsScriptOptionAndExample() {
    let help = SP.helpMessage(for: SP.NewTab.self, columns: 100)

    #expect(help.contains("--script <script>"))
    #expect(help.contains("sp tab new --script 'echo hi; pwd'"))
  }

  @Test
  func onboardRendererShowsWelcomeShortcutsAndSetupCommands() {
    let rendered = SPOnboardingRenderer.render(
      .init(
        items: [
          .init(shortcut: "⌘S", title: "Toggle sidebar"),
          .init(shortcut: "⌘T", title: "New tab"),
          .init(shortcut: "⌘1-8", title: "Go to tabs 1-8"),
          .init(shortcut: "⌘9", title: "Last tab"),
          .init(shortcut: "⌘W", title: "Close pane"),
          .init(shortcut: "⌘⌥W", title: "Close tab"),
          .init(shortcut: "⌃1-0", title: "Go to space 1-10"),
          .init(shortcut: "⌘D", title: "Split right"),
          .init(shortcut: "⌘⇧D", title: "Split down"),
          .init(shortcut: "⌘F", title: "Find"),
        ]
      )
    ).replacingOccurrences(
      of: "\u{001B}\\[[0-9;]*m",
      with: "",
      options: .regularExpression
    )

    #expect(
      rendered
        == """
        Welcome to Supaterm!

        Common Shortcuts

        ⌘S    Toggle sidebar
        ⌘T    New tab
        ⌘1-8  Go to tabs 1-8
        ⌘9    Last tab
        ⌘W    Close pane
        ⌘⌥W   Close tab
        ⌃1-0  Go to space 1-10
        ⌘D    Split right
        ⌘⇧D   Split down
        ⌘F    Find

        Coding Agents Integrations Setup:

        Install the Supaterm skill:

        npx skills add supabitapp/supaterm-skills --skill supaterm -g

        Run the commands that match your setup:

        sp agent install-hook claude
        sp agent install-hook codex
        pi install git:github.com/supabitapp/supaterm-skills

        Run "sp" for the list of available commands.
        """
    )
  }

  @Test
  func agentParserAcceptsInstallRemoveHookAndReceiveAgentHookSubcommands() throws {
    let claudeCommand = try #require(
      try SP.parseAsRoot(["agent", "install-hook", "claude"]) as? SP.InstallAgentHook.Claude
    )
    let codexCommand = try #require(
      try SP.parseAsRoot(["agent", "install-hook", "codex"]) as? SP.InstallAgentHook.Codex
    )
    let removeClaudeCommand = try #require(
      try SP.parseAsRoot(["agent", "remove-hook", "claude"]) as? SP.RemoveAgentHook.Claude
    )
    let removeCodexCommand = try #require(
      try SP.parseAsRoot(["agent", "remove-hook", "codex"]) as? SP.RemoveAgentHook.Codex
    )
    let receiveClaudeCommand = try #require(
      try SP.parseAsRoot(["agent", "receive-agent-hook", "--agent", "claude"]) as? SP.ReceiveAgentHook
    )
    let receivePiCommand = try #require(
      try SP.parseAsRoot(["agent", "receive-agent-hook", "--agent", "pi"]) as? SP.ReceiveAgentHook
    )

    #expect(type(of: claudeCommand) == SP.InstallAgentHook.Claude.self)
    #expect(type(of: codexCommand) == SP.InstallAgentHook.Codex.self)
    #expect(type(of: removeClaudeCommand) == SP.RemoveAgentHook.Claude.self)
    #expect(type(of: removeCodexCommand) == SP.RemoveAgentHook.Codex.self)
    #expect(receiveClaudeCommand.agent == .claude)
    #expect(receivePiCommand.agent == .pi)
  }

  @Test
  func internalParserAcceptsGenerateSettingsSchemaSubcommand() throws {
    let command = try #require(
      try SP.parseAsRoot(["internal", "generate-settings-schema"]) as? SP.GenerateSettingsSchema
    )

    #expect(type(of: command) == SP.GenerateSettingsSchema.self)
  }

  @Test
  func tabFocusAndPaneSendParsersAcceptPublicShape() throws {
    let focusCommand = try #require(
      try SP.parseAsRoot(["tab", "focus", "1/2"]) as? SP.SelectTab
    )
    let sendCommand = try #require(
      try SP.parseAsRoot(["pane", "send", "1/2/3", "pwd"]) as? SP.SendText
    )

    #expect(focusCommand.tab == .path(spaceIndex: 1, tabIndex: 2))
    #expect(sendCommand.arguments == ["1/2/3", "pwd"])
  }

  @Test(arguments: [
    ["pane", "split", "right", "--script", "echo 1", "echo", "2"],
    ["tab", "new", "--script", "echo 1", "echo", "2"],
  ])
  func parserRejectsShellWithTrailingCommand(arguments: [String]) {
    do {
      _ = try SP.parseAsRoot(arguments)
      Issue.record("Expected parsing to reject combining --script with a trailing command.")
    } catch {
      let message = String(describing: error)
      #expect(message.contains("--script cannot be used with a trailing command."))
    }
  }

  @Test
  func startupInputRejectsEmptyShell() {
    do {
      _ = try startupInput(script: "", tokens: [])
      Issue.record("Expected startupInput to reject an empty --script.")
    } catch {
      let message = String(describing: error)
      #expect(message.contains("--script must not be empty."))
    }
  }

  @Test
  func startupInputNormalizesTrailingNewline() throws {
    #expect(try startupInput(script: "echo 1\necho 2", tokens: []) == "echo 1\necho 2\n")
    #expect(try startupInput(script: "echo 1\necho 2\n", tokens: []) == "echo 1\necho 2\n")
  }

  @Test
  func startupInputEscapesTokenCommandsAndAppendsNewline() throws {
    #expect(try startupInput(script: nil, tokens: ["pwd"]) == "pwd\n")
    #expect(try startupInput(script: nil, tokens: ["echo", "hello world"]) == "echo 'hello world'\n")
  }

  @Test(arguments: [
    ["tab", "new", "--in", "0"],
    ["pane", "split", "right", "--in", "bad-target"],
  ])
  func parserRejectsInvalidSelectorTargets(arguments: [String]) {
    do {
      _ = try SP.parseAsRoot(arguments)
      Issue.record("Expected parsing to reject an invalid target.")
    } catch {
      let message = String(describing: error)
      #expect(
        message.contains("1 or greater")
          || message.contains("space selector")
          || message.contains("tab selector")
          || message.contains("space/tab")
          || message.contains("space/tab/pane")
          || message.localizedCaseInsensitiveContains("invalid")
      )
    }
  }
}

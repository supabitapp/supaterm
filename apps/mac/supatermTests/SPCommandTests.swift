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
  func spaceDestroyParserAcceptsYesFlag() throws {
    let command = try #require(
      try SP.parseAsRoot(["space", "destroy", "-y", "1"]) as? SP.SpaceDestroy
    )

    #expect(command.yes)
    #expect(command.space == .index(1))
  }

  @Test
  func spaceCloseParserIsRemoved() throws {
    do {
      _ = try SP.parseAsRoot(["space", "close", "1"])
      Issue.record("Expected space close to be removed.")
    } catch {
      #expect(String(describing: error).contains("close"))
    }
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
  func pinAndUnpinParsersAcceptSelectorTargets() throws {
    let tabID = UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!
    let pinTab = try #require(
      try SP.parseAsRoot(["tab", "pin", "1/2"]) as? SP.PinTab
    )
    let unpinTab = try #require(
      try SP.parseAsRoot(["tab", "unpin", tabID.uuidString]) as? SP.UnpinTab
    )

    #expect(pinTab.tab == .path(spaceIndex: 1, tabIndex: 2))
    #expect(unpinTab.tab == .id(tabID))
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

    #expect(command.body?.isEmpty == true)
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
  func internalPingDecodesSocketResultAsJson() throws {
    let response = try SupatermSocketResponse.ok(
      id: "ping-1",
      encodableResult: SP.SPPingResult(pong: true)
    )

    let result = try SP.Ping.result(from: response)

    #expect(result == SP.SPPingResult(pong: true))
    #expect(
      try JSONDecoder().decode(SP.SPPingResult.self, from: Data(try jsonString(result).utf8))
        == result)
  }

  @Test
  func socketResolutionStrategyUsesDiscoveryOnlyWhenNeeded() {
    let environmentPath = "/tmp/environment.sock"
    let endpoint = spCommandTestSocketEndpoint(path: "/tmp/live.sock")

    #expect(
      SPSocketResolutionStrategy.make(
        explicitSocketPath: nil,
        environmentSocketPath: environmentPath,
        environmentPathStatus: .reachable(endpoint),
        discoveryPolicy: .whenNeeded
      )
        == SPSocketResolutionStrategy(
          environmentPath: environmentPath,
          discoversManagedSockets: false
        )
    )
    #expect(
      SPSocketResolutionStrategy.make(
        explicitSocketPath: nil,
        environmentSocketPath: environmentPath,
        environmentPathStatus: .stale,
        discoveryPolicy: .whenNeeded
      ) == SPSocketResolutionStrategy(environmentPath: nil, discoversManagedSockets: true)
    )
    #expect(
      SPSocketResolutionStrategy.make(
        explicitSocketPath: nil,
        environmentSocketPath: environmentPath,
        environmentPathStatus: .ignored,
        discoveryPolicy: .whenNeeded
      ) == SPSocketResolutionStrategy(environmentPath: nil, discoversManagedSockets: true)
    )
    #expect(
      SPSocketResolutionStrategy.make(
        explicitSocketPath: "/tmp/explicit.sock",
        environmentSocketPath: environmentPath,
        environmentPathStatus: nil,
        discoveryPolicy: .whenNeeded
      ) == SPSocketResolutionStrategy(environmentPath: nil, discoversManagedSockets: false)
    )
  }

  @Test
  func socketResolutionStrategyAlwaysDiscoversWithoutChangingPrecedence() {
    let environmentPath = "/tmp/environment.sock"
    let endpoint = spCommandTestSocketEndpoint(path: "/tmp/live.sock")

    #expect(
      SPSocketResolutionStrategy.make(
        explicitSocketPath: nil,
        environmentSocketPath: environmentPath,
        environmentPathStatus: .reachable(endpoint),
        discoveryPolicy: .always
      )
        == SPSocketResolutionStrategy(
          environmentPath: environmentPath,
          discoversManagedSockets: true
        )
    )
    #expect(
      SPSocketResolutionStrategy.make(
        explicitSocketPath: nil,
        environmentSocketPath: environmentPath,
        environmentPathStatus: .stale,
        discoveryPolicy: .always
      ) == SPSocketResolutionStrategy(environmentPath: nil, discoversManagedSockets: true)
    )
    #expect(
      SPSocketResolutionStrategy.make(
        explicitSocketPath: "/tmp/explicit.sock",
        environmentSocketPath: environmentPath,
        environmentPathStatus: nil,
        discoveryPolicy: .always
      ) == SPSocketResolutionStrategy(environmentPath: nil, discoversManagedSockets: true)
    )
  }

  @Test
  func diagnosticSocketProbeReportsResolutionFailure() {
    let result = SPDiagnosticSocketProbe.probe(
      target: nil,
      resolutionErrorMessage: "No reachable Supaterm instance was found.",
      context: nil,
      sendDebugRequest: { _, _ in
        Issue.record("Expected diagnostic probe to skip socket request.")
        return .error(code: "unexpected", message: "unexpected")
      }
    )

    #expect(result.socket.path == nil)
    #expect(!result.socket.isReachable)
    #expect(!result.socket.requestSucceeded)
    #expect(result.socket.error == "No reachable Supaterm instance was found.")
    #expect(result.appSnapshot == nil)
    #expect(result.problems == ["No reachable Supaterm instance was found."])
  }

  @Test
  func diagnosticSocketProbeDecodesSuccessfulDebugResponse() throws {
    let endpoint = spCommandTestSocketEndpoint(path: "/tmp/live.sock")
    let target = SupatermResolvedSocketTarget(
      path: endpoint.path,
      source: .discoveredSingleton
    )
    let snapshot = spCommandTestDebugSnapshot()

    let result = SPDiagnosticSocketProbe.probe(
      target: target,
      resolutionErrorMessage: nil,
      context: nil,
      sendDebugRequest: { requestedTarget, context in
        #expect(requestedTarget == target)
        #expect(context == nil)
        return try SupatermSocketResponse.ok(id: "debug-1", encodableResult: snapshot)
      }
    )

    #expect(result.socket.path == endpoint.path)
    #expect(result.socket.isReachable)
    #expect(result.socket.requestSucceeded)
    #expect(result.socket.error == nil)
    #expect(result.appSnapshot == snapshot)
    #expect(result.problems.isEmpty)
  }

  @Test
  func diagnosticSocketProbeReportsSocketErrorResponse() {
    let endpoint = spCommandTestSocketEndpoint(path: "/tmp/live.sock")
    let target = SupatermResolvedSocketTarget(
      path: endpoint.path,
      source: .discoveredSingleton
    )

    let result = SPDiagnosticSocketProbe.probe(
      target: target,
      resolutionErrorMessage: nil,
      context: nil,
      sendDebugRequest: { _, _ in
        .error(id: "debug-1", code: "failed", message: "Debug failed.")
      }
    )

    #expect(result.socket.path == endpoint.path)
    #expect(result.socket.isReachable)
    #expect(!result.socket.requestSucceeded)
    #expect(result.socket.error == "Debug failed.")
    #expect(result.appSnapshot == nil)
    #expect(result.problems == ["Debug failed."])
  }

  @Test
  func diagnosticSocketProbeReportsThrownSocketRequestError() {
    let endpoint = spCommandTestSocketEndpoint(path: "/tmp/live.sock")
    let target = SupatermResolvedSocketTarget(
      path: endpoint.path,
      source: .discoveredSingleton
    )

    let result = SPDiagnosticSocketProbe.probe(
      target: target,
      resolutionErrorMessage: nil,
      context: nil,
      sendDebugRequest: { _, _ in
        throw SPCommandTestDiagnosticError.failed
      }
    )

    #expect(result.socket.path == endpoint.path)
    #expect(!result.socket.isReachable)
    #expect(!result.socket.requestSucceeded)
    #expect(result.socket.error == "socket failed")
    #expect(result.appSnapshot == nil)
    #expect(result.problems == ["socket failed"])
  }

  @Test
  func onboardRendererShowsWelcomeShortcutsAndSetupCommands() {
    let rendered = SPOnboardingRenderer.render(
      SupatermOnboardingSnapshot(
        items: [
          SupatermOnboardingShortcut(shortcut: "⌘S", title: "Toggle sidebar"),
          SupatermOnboardingShortcut(shortcut: "⌘T", title: "New tab"),
          SupatermOnboardingShortcut(shortcut: "⌘1-8", title: "Go to tabs 1-8"),
          SupatermOnboardingShortcut(shortcut: "⌘9", title: "Last tab"),
          SupatermOnboardingShortcut(shortcut: "⌘W", title: "Close pane"),
          SupatermOnboardingShortcut(shortcut: "⌘⌥W", title: "Close tab"),
          SupatermOnboardingShortcut(shortcut: "⌃1-0", title: "Go to space 1-10"),
          SupatermOnboardingShortcut(shortcut: "⌘D", title: "Split right"),
          SupatermOnboardingShortcut(shortcut: "⌘⇧D", title: "Split down"),
          SupatermOnboardingShortcut(shortcut: "⌘F", title: "Find"),
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

        sp skills install

        Run the commands that match your setup:

        sp agent install-hook claude
        sp agent install-hook codex
        pi install git:github.com/supabitapp/supaterm-skills

        Run "sp" for the list of available commands.
        """
    )
  }

  @Test
  func treeRendererShowsPaneDisplayTitles() {
    let snapshot = SupatermAppDebugSnapshot(
      build: SupatermAppDebugSnapshot.Build(
        version: "1.0.0",
        buildNumber: "1",
        isDevelopmentBuild: true,
        usesStubUpdateChecks: false
      ),
      update: SupatermAppDebugSnapshot.Update(
        canCheckForUpdates: true,
        phase: "idle",
        detail: ""
      ),
      summary: SupatermAppDebugSnapshot.Summary(
        windowCount: 1,
        spaceCount: 1,
        tabCount: 1,
        paneCount: 1,
        keyWindowIndex: 1
      ),
      currentTarget: nil,
      windows: [
        SupatermAppDebugSnapshot.Window(
          index: 1,
          isKey: true,
          isVisible: true,
          spaces: [
            SupatermAppDebugSnapshot.Space(
              index: 1,
              id: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
              name: "A",
              isSelected: true,
              tabs: [
                SupatermAppDebugSnapshot.Tab(
                  index: 1,
                  id: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
                  title: "fish",
                  isSelected: true,
                  isPinned: false,
                  isDirty: false,
                  isTitleLocked: false,
                  hasRunningActivity: false,
                  hasBell: false,
                  hasReadOnly: false,
                  hasSecureInput: false,
                  panes: [
                    SupatermAppDebugSnapshot.Pane(
                      index: 1,
                      id: UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!,
                      isFocused: true,
                      displayTitle: "build",
                      pwd: nil,
                      isReadOnly: false,
                      hasSecureInput: false,
                      bellCount: 0,
                      isRunning: false,
                      progressState: nil,
                      progressValue: nil,
                      needsCloseConfirmation: false,
                      lastCommandExitCode: nil,
                      lastCommandDurationMs: nil,
                      lastChildExitCode: nil,
                      lastChildExitTimeMs: nil
                    )
                  ]
                )
              ]
            )
          ]
        )
      ],
      problems: []
    )

    #expect(
      SPTreeRenderer.render(snapshot)
        == """
        window 1 [key]
        └─ space 1 "A" [selected]
           └─ tab 1 "fish" [selected]
              └─ pane 1 "build" [focused]
        """
    )
    #expect(
      SPTreeRenderer.renderPlain(snapshot)
        == """
        1\tspace\tA\tselected
        1/1\ttab\tfish\tselected
        1/1/1\tpane\tbuild\tfocused
        """
    )
  }

  @Test
  func skillsParserAcceptsCatalogGetAndInstallCommands() throws {
    let defaultCommand = try #require(
      try SP.parseAsRoot(["skills"]) as? SP.ListSkills
    )
    let listCommand = try #require(
      try SP.parseAsRoot(["skills", "list", "--json"]) as? SP.ListSkills
    )
    let getCommand = try #require(
      try SP.parseAsRoot(["skills", "get", "core", "--full", "--json"]) as? SP.GetSkill
    )
    let installCommand = try #require(
      try SP.parseAsRoot(["skills", "install", "--json"]) as? SP.InstallSkill
    )

    #expect(!defaultCommand.json)
    #expect(listCommand.json)
    #expect(getCommand.name == "core")
    #expect(getCommand.full)
    #expect(getCommand.json)
    #expect(installCommand.json)
  }

  @Test
  func agentInstallSkillCommandIsRemoved() {
    do {
      _ = try SP.parseAsRoot(["agent", "install-skill"])
      Issue.record("Expected agent install-skill to be removed.")
    } catch {
      #expect(String(describing: error).contains("install-skill"))
    }
  }

  @Test
  func agentParserAcceptsInstallRemoveHookAndReceiveAgentHookSubcommands() throws {
    let installAllCommand = try #require(
      try SP.parseAsRoot(["agent", "install-hooks"]) as? SP.InstallAgentHooks
    )
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
      try SP.parseAsRoot(["agent", "receive-agent-hook", "--agent", "claude"])
        as? SP.ReceiveAgentHook
    )
    let receivePiCommand = try #require(
      try SP.parseAsRoot(["agent", "receive-agent-hook", "--agent", "pi", "--pid", "123"])
        as? SP.ReceiveAgentHook
    )

    #expect(type(of: installAllCommand) == SP.InstallAgentHooks.self)
    #expect(type(of: claudeCommand) == SP.InstallAgentHook.Claude.self)
    #expect(type(of: codexCommand) == SP.InstallAgentHook.Codex.self)
    #expect(type(of: removeClaudeCommand) == SP.RemoveAgentHook.Claude.self)
    #expect(type(of: removeCodexCommand) == SP.RemoveAgentHook.Codex.self)
    #expect(receiveClaudeCommand.agent == .claude)
    #expect(receiveClaudeCommand.pid == nil)
    #expect(receivePiCommand.agent == .pi)
    #expect(receivePiCommand.pid == 123)
  }

  @Test
  func configParserAcceptsValidateSubcommand() throws {
    let command = try #require(
      try SP.parseAsRoot(["config", "validate", "--path", "./settings.toml"]) as? SP.ValidateConfig
    )

    #expect(command.path == "./settings.toml")
  }

  @Test
  func configParserAcceptsSettingsSubcommands() throws {
    let pathCommand = try #require(
      try SP.parseAsRoot(["config", "path"]) as? SP.PathConfig
    )
    let listCommand = try #require(
      try SP.parseAsRoot(["config", "list", "--changed"]) as? SP.ListConfig
    )
    let getCommand = try #require(
      try SP.parseAsRoot(["config", "get", "updates.channel"]) as? SP.GetConfig
    )
    let setCommand = try #require(
      try SP.parseAsRoot(["config", "set", "appearance.mode", "system"]) as? SP.SetConfig
    )
    let resetCommand = try #require(
      try SP.parseAsRoot(["config", "reset", "privacy.analytics_enabled"]) as? SP.ResetConfig
    )

    #expect(type(of: pathCommand) == SP.PathConfig.self)
    #expect(listCommand.changed)
    #expect(getCommand.key == "updates.channel")
    #expect(setCommand.key == "appearance.mode")
    #expect(setCommand.value == "system")
    #expect(resetCommand.key == "privacy.analytics_enabled")
  }

  @Test
  func tabFocusAndPaneSendParsersAcceptPublicShape() throws {
    let focusCommand = try #require(
      try SP.parseAsRoot(["tab", "focus", "1/2"]) as? SP.SelectTab
    )
    let sendCommand = try #require(
      try SP.parseAsRoot(["pane", "send", "1/2/3", "pwd"]) as? SP.SendText
    )
    let submitCommand = try #require(
      try SP.parseAsRoot(["pane", "send", "--submit", "1/2/3", "first\nsecond"])
        as? SP.SendText
    )

    #expect(focusCommand.tab == .path(spaceIndex: 1, tabIndex: 2))
    #expect(sendCommand.arguments == ["1/2/3", "pwd"])
    #expect(submitCommand.submit)
    #expect(submitCommand.arguments == ["1/2/3", "first\nsecond"])
  }

  @Test
  func paneSendRejectsNewlineWithSubmit() {
    do {
      _ = try SP.parseAsRoot(["pane", "send", "--newline", "--submit", "prompt"])
      Issue.record("Expected pane send to reject --newline with --submit.")
    } catch {
      #expect(String(describing: error).contains("--newline and --submit cannot be used together."))
    }
  }

  @Test(arguments: [
    ["pane", "split", "right", "--script", "echo 1", "echo", "2"],
    ["tab", "new", "--script", "echo 1", "echo", "2"],
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
  func startupCommandRejectsEmptyScript() {
    do {
      _ = try startupCommand(script: "", tokens: [])
      Issue.record("Expected startupCommand to reject an empty --script.")
    } catch {
      let message = String(describing: error)
      #expect(message.contains("--script must not be empty."))
    }
  }

  @Test
  func startupCommandPreservesScriptText() throws {
    #expect(try startupCommand(script: "echo 1\necho 2", tokens: []) == "echo 1\necho 2")
    #expect(try startupCommand(script: "echo 1\necho 2\n", tokens: []) == "echo 1\necho 2\n")
  }

  @Test
  func startupCommandEscapesTokenCommands() throws {
    #expect(try startupCommand(script: nil, tokens: ["pwd"]) == "pwd")
    #expect(
      try startupCommand(script: nil, tokens: ["echo", "hello world"]) == "echo 'hello world'")
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

private enum SPCommandTestDiagnosticError: LocalizedError {
  case failed

  var errorDescription: String? {
    "socket failed"
  }
}

private func spCommandTestSocketEndpoint(path: String) -> SupatermSocketEndpoint {
  SupatermSocketEndpoint(
    id: UUID(uuidString: "3F6B51E0-F214-456C-93F4-D87AEACCC292")!,
    name: "default",
    path: path,
    pid: 1,
    startedAt: Date(timeIntervalSince1970: 1)
  )
}

private func spCommandTestDebugSnapshot() -> SupatermAppDebugSnapshot {
  SupatermAppDebugSnapshot(
    build: SupatermAppDebugSnapshot.Build(
      version: "1.0.0",
      buildNumber: "1",
      isDevelopmentBuild: true,
      usesStubUpdateChecks: false
    ),
    update: SupatermAppDebugSnapshot.Update(
      canCheckForUpdates: true,
      phase: "idle",
      detail: ""
    ),
    summary: SupatermAppDebugSnapshot.Summary(
      windowCount: 0,
      spaceCount: 0,
      tabCount: 0,
      paneCount: 0,
      keyWindowIndex: nil
    ),
    currentTarget: nil,
    windows: [],
    problems: []
  )
}

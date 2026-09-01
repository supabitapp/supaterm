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
  func newPaneDefaultsAndOptions() throws {
    let defaultCommand = try #require(
      try SP.parseAsRoot(["pane", "split", "right"]) as? SP.NewPane
    )
    let keepLayoutCommand = try #require(
      try SP.parseAsRoot(["pane", "split", "--layout", "keep", "right"]) as? SP.NewPane
    )
    let focusedCommand = try #require(
      try SP.parseAsRoot(["pane", "split", "--focus", "right"]) as? SP.NewPane
    )

    #expect(defaultCommand.layout == .equalize)
    #expect(!defaultCommand.focus)
    #expect(keepLayoutCommand.layout == .keep)
    #expect(focusedCommand.focus)
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
  func groupParsersAcceptPublicCommandShapes() throws {
    let groupID = UUID(uuidString: "5A52445E-E42A-48B7-A5DD-C6C7C978B139")!
    let create = try #require(
      try SP.parseAsRoot([
        "group", "new", "Work", "--color", "blue", "--pin", "--in", "2",
      ]) as? SP.GroupNew
    )
    let rename = try #require(
      try SP.parseAsRoot(["group", "rename", "Build", groupID.uuidString]) as? SP.GroupRename
    )
    let move = try #require(
      try SP.parseAsRoot(["group", "move", "Work", "--index", "2"]) as? SP.GroupMove
    )
    let close = try #require(
      try SP.parseAsRoot(["group", "close", "Work", "-y"]) as? SP.GroupClose
    )
    let collapse = try #require(
      try SP.parseAsRoot(["group", "collapse"]) as? SP.GroupCollapse
    )

    #expect(create.title == "Work")
    #expect(create.color == .blue)
    #expect(create.pin)
    #expect(create.space == .index(2))
    #expect(rename.title == "Build")
    #expect(rename.group == .id(groupID))
    #expect(move.group == .title("Work"))
    #expect(move.index == 2)
    #expect(close.group == .title("Work"))
    #expect(close.yes)
    #expect(collapse.group == nil)
  }

  @Test
  func moveTabParsesExclusiveGroupAndRootDestinations() throws {
    let grouped = try #require(
      try SP.parseAsRoot(["tab", "move", "1/2", "--group", "Work", "--index", "1"])
        as? SP.MoveTab
    )
    let rooted = try #require(
      try SP.parseAsRoot(["tab", "move", "1/2", "--root", "--index", "2", "--pin"])
        as? SP.MoveTab
    )

    #expect(try grouped.destinationReference() == .group(.title("Work")))
    #expect(grouped.index == 1)
    #expect(try rooted.destinationReference() == .root)
    #expect(rooted.index == 2)
    #expect(rooted.pin)
  }

  @Test
  func moveTabRejectsMissingConflictingAndPinnedGroupDestinations() throws {
    let missing = try #require(
      try SP.parseAsRoot(["tab", "move", "1/2"]) as? SP.MoveTab
    )
    let conflicting = try #require(
      try SP.parseAsRoot(["tab", "move", "1/2", "--group", "Work", "--root"])
        as? SP.MoveTab
    )
    let pinnedGroup = try #require(
      try SP.parseAsRoot(["tab", "move", "1/2", "--group", "Work", "--pin"])
        as? SP.MoveTab
    )

    #expect(throws: ValidationError.self) { try missing.destinationReference() }
    #expect(throws: ValidationError.self) { try conflicting.destinationReference() }
    #expect(throws: ValidationError.self) { try pinnedGroup.destinationReference() }
  }

  @Test
  func newTabRejectsGroupAndRootTogether() throws {
    #expect(throws: (any Error).self) {
      try SP.parseAsRoot(["tab", "new", "--group", "Work", "--root"])
    }
  }

  @Test
  func spaceListParserTakesNoTarget() throws {
    _ = try #require(try SP.parseAsRoot(["space", "ls"]) as? SP.SpaceList)

    #expect(throws: (any Error).self) {
      _ = try SP.parseAsRoot(["space", "ls", "1"])
    }
  }

  @Test
  func spaceNewParserRejectsTheRemovedFocusFlag() throws {
    let command = try #require(
      try SP.parseAsRoot(["space", "new", "--color", "green", "Work"]) as? SP.SpaceNew
    )

    #expect(command.name == "Work")
    #expect(command.color == .green)
    #expect(throws: (any Error).self) {
      _ = try SP.parseAsRoot(["space", "new", "--focus", "Work"])
    }
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
  func movePaneToNewTabParserAcceptsPaneTarget() throws {
    let paneID = UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
    let command = try #require(
      try SP.parseAsRoot(["pane", "move-to-new-tab", paneID.uuidString])
        as? SP.MovePaneToNewTab
    )

    #expect(command.pane == .id(paneID))
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
  func renameTabParserAcceptsEmptyTitle() throws {
    let command = try #require(
      try SP.parseAsRoot(["tab", "rename", ""]) as? SP.RenameTab
    )

    #expect(command.title.isEmpty)
  }

  @Test
  func tabTitleParserAcceptsOptionalTarget() throws {
    let current = try #require(
      try SP.parseAsRoot(["tab", "title"]) as? SP.TabTitle
    )
    let targeted = try #require(
      try SP.parseAsRoot(["tab", "title", "1/2"]) as? SP.TabTitle
    )

    #expect(current.tab == nil)
    #expect(targeted.tab == .path(spaceIndex: 1, tabIndex: 2))
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
  func tmuxAndRunCommandsAreRemoved() {
    #expect(throws: (any Error).self) {
      _ = try SP.parseAsRoot(["tmux", "list-panes"])
    }
    #expect(throws: (any Error).self) {
      _ = try SP.parseAsRoot(["run", "env"])
    }
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
  func onboardRendererShowsLogoWelcomeShortcutsAndSetupCommands() {
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
               ##
             ####
            #####
           ##########
         ############
        ############
            ######
            #####
            ###
            ##

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

        Set up Claude and Codex hooks:

        sp agent setup

        Run "sp" for the list of available commands.
        """
    )
  }

  @Test
  func skillsParserAcceptsCatalogGetPathAndInstallCommands() throws {
    let defaultCommand = try #require(
      try SP.parseAsRoot(["skills"]) as? SP.ListSkills
    )
    let listCommand = try #require(
      try SP.parseAsRoot(["skills", "list", "--json"]) as? SP.ListSkills
    )
    let getCommand = try #require(
      try SP.parseAsRoot(["skills", "get", "core", "--full"]) as? SP.GetSkill
    )
    let pathCommand = try #require(
      try SP.parseAsRoot(["skills", "path", "core"]) as? SP.PathSkill
    )
    let installCommand = try #require(
      try SP.parseAsRoot(["skills", "install", "--json"]) as? SP.InstallSkill
    )

    #expect(!defaultCommand.json)
    #expect(listCommand.json)
    #expect(getCommand.name == "core")
    #expect(getCommand.full)
    #expect(pathCommand.name == "core")
    #expect(installCommand.json)
  }

  @Test
  func skillsGetRejectsJSONOutput() {
    #expect(throws: (any Error).self) {
      try SP.parseAsRoot(["skills", "get", "core", "--json"])
    }
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
  func agentExplainCommandIsRemoved() {
    do {
      _ = try SP.parseAsRoot(["agent", "explain"])
      Issue.record("Expected agent explain to be removed.")
    } catch {
      #expect(String(describing: error).contains("explain"))
    }
  }

  @Test
  func agentInstallAndRemoveHookCommandsAreRemoved() {
    for command in ["install-hook", "remove-hook"] {
      do {
        _ = try SP.parseAsRoot(["agent", command, "claude"])
        Issue.record("Expected agent \(command) to be removed.")
      } catch {
        #expect(String(describing: error).contains(command))
      }
    }
  }

  @Test
  func agentInstallHooksCommandIsRemoved() {
    do {
      _ = try SP.parseAsRoot(["agent", "install-hooks"])
      Issue.record("Expected agent install-hooks to be removed.")
    } catch {
      #expect(String(describing: error).contains("install-hooks"))
    }
  }

  @Test
  func agentParserAcceptsAggregateAndHiddenHookSubcommands() throws {
    let reloadCommand = try #require(
      try SP.parseAsRoot(["agent", "reload-rules", "--plain"])
        as? SP.ReloadAgentDetectionRules
    )
    let setupCommand = try #require(
      try SP.parseAsRoot(["agent", "setup"]) as? SP.SetupAgentIntegrations
    )
    let removeAllCommand = try #require(
      try SP.parseAsRoot(["agent", "remove-hooks"]) as? SP.RemoveAgentHooks
    )
    let receiveClaudeCommand = try #require(
      try SP.parseAsRoot(["agent", "receive-agent-hook", "--agent", "claude"])
        as? SP.ReceiveAgentHook
    )
    #expect(reloadCommand.options.output.plain)
    #expect(type(of: setupCommand) == SP.SetupAgentIntegrations.self)
    #expect(type(of: removeAllCommand) == SP.RemoveAgentHooks.self)
    #expect(receiveClaudeCommand.agent == .claude)
    #expect(receiveClaudeCommand.pid == nil)
    #expect(throws: (any Error).self) {
      try SP.parseAsRoot(["agent", "receive-agent-hook", "--agent", "pi", "--pid", "123"])
    }
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
  func paneKeyParserAcceptsPublicKeysAndOptionalTarget() throws {
    let mappings: [(String, SupatermInputKey)] = [
      ("backspace", .backspace),
      ("ctrl-c", .ctrlC),
      ("ctrl-d", .ctrlD),
      ("ctrl-l", .ctrlL),
      ("ctrl-z", .ctrlZ),
      ("enter", .enter),
      ("escape", .escape),
      ("tab", .tab),
    ]

    for (argument, inputKey) in mappings {
      let command = try #require(
        try SP.parseAsRoot(["pane", "key", argument]) as? SP.SendKey
      )
      #expect(command.key.inputKey == inputKey)
      #expect(command.pane == nil)
    }

    let selectedPane = try #require(
      try SP.parseAsRoot(["pane", "key", "enter", "1/2/3"]) as? SP.SendKey
    )

    #expect(selectedPane.key == .enter)
    #expect(selectedPane.pane == .path(spaceIndex: 1, tabIndex: 2, paneIndex: 3))
  }

  @Test
  func paneKeyParserRejectsSocketKeyNames() {
    #expect(throws: (any Error).self) {
      _ = try SP.parseAsRoot(["pane", "key", "ctrl_c"])
    }
  }

  @Test
  func paneScreenshotParserRequiresAnOutputPath() throws {
    let command = try #require(
      try SP.parseAsRoot([
        "pane", "screenshot", "1/2/3", "--output", "pane.png", "--json",
      ]) as? SP.ScreenshotPane
    )

    #expect(command.pane == .path(spaceIndex: 1, tabIndex: 2, paneIndex: 3))
    #expect(command.outputPath == "pane.png")
    #expect(command.options.output.json)
    #expect(throws: (any Error).self) {
      _ = try SP.parseAsRoot(["pane", "screenshot", "1/2/3"])
    }
  }

  @Test
  func paneScreenshotRejectsAnEmptyOutputPath() {
    #expect(throws: ValidationError.self) {
      _ = try resolvedCLIOutputFileURL("   ")
    }
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

  @Test(arguments: [
    ["pane", "split", "right", "--", ""],
    ["tab", "new", "--", ""],
  ])
  func parserRejectsAnEmptyExecutable(arguments: [String]) {
    #expect(throws: (any Error).self) {
      try SP.parseAsRoot(arguments)
    }
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
          || message.contains("tab target")
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

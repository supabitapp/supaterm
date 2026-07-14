import Foundation
import SupatermCLIShared
import Testing

extension SupatermE2ESuite {
  @Suite struct SPBinaryTests {
    @Test(.timeLimit(.minutes(5)))
    func parentReadOnlyAndConfigCommandsRoundTripThroughEmbeddedBinary() async throws {
      try await withTestSpace { app, space in
        try await app.waitForShellPrompt(space.pane)
        let runner = spRunner(app, tabID: space.tab.tabID, paneID: space.tab.paneID)

        for arguments in parentHelpCommands {
          let result = try requireSuccessfulSPResult(try runner.run(arguments, cwd: space.directory))
          #expect(result.stdout.contains("USAGE:"))
        }

        let onboard = try requireSuccessfulSPResult(
          try runner.run(["onboard", "--socket", app.socketPath, "--json"], cwd: space.directory)
        )
        #expect(try decodeSPJSON(SupatermOnboardingSnapshot.self, from: onboard).items.isEmpty == false)

        let quietOnboard = try requireSuccessfulSPResult(
          try runner.run(["onboard", "--socket", app.socketPath, "--quiet"], cwd: space.directory)
        )
        #expect(quietOnboard.stdout.isEmpty)

        let diagnostic = try requireSuccessfulSPResult(
          try runner.run(["diagnostic", "--socket", app.socketPath, "--json"], cwd: space.directory)
        )
        let diagnosticReport = try decodeSPJSON(DiagnosticReport.self, from: diagnostic)
        #expect(diagnosticReport.socket.path == app.socketPath)
        #expect(diagnosticReport.socket.requestSucceeded)
        #expect(diagnosticReport.app?.summary.paneCount ?? 0 > 0)

        let diagnosticPlain = try requireSuccessfulSPResult(
          try runner.run(["diagnostic", "--socket", app.socketPath, "--plain"], cwd: space.directory)
        )
        #expect(diagnosticPlain.stdout.contains("request succeeded: yes"))

        let instances = try requireSuccessfulSPResult(
          try runner.run(["instance", "ls", "--json"], cwd: space.directory)
        )
        #expect(
          try decodeSPJSON([SupatermSocketEndpoint].self, from: instances)
            .contains { $0.path == app.socketPath })

        let ping = try requireSuccessfulSPResult(
          try runner.run(["internal", "ping", "--socket", app.socketPath], cwd: space.directory)
        )
        #expect(try decodeSPJSON(PingResult.self, from: ping).pong)

        let tree = try requireSuccessfulSPResult(
          try runner.run(["ls", "--socket", app.socketPath, "--plain"], cwd: space.directory)
        )
        #expect(tree.stdout.contains("\tspace\t"))

        let defaultConfig = try requireSuccessfulSPResult(
          try runner.run(["config", "validate", "--json"], cwd: space.directory)
        )
        let defaultValidation = try decodeSPJSON(SupatermSettingsValidationResult.self, from: defaultConfig)
        #expect(defaultValidation.status != .invalid)
        #expect(defaultValidation.errors.isEmpty)
        #expect(defaultValidation.path.hasPrefix(app.stateHome.path))

        let validConfigURL = space.directory.appendingPathComponent("settings.toml")
        try Data().write(to: validConfigURL)
        let validConfig = try requireSuccessfulSPResult(
          try runner.run(
            ["config", "validate", "--path", validConfigURL.path, "--json"],
            cwd: space.directory
          )
        )
        #expect(try decodeSPJSON(SupatermSettingsValidationResult.self, from: validConfig).status == .valid)

        let invalidConfigURL = space.directory.appendingPathComponent("invalid.toml")
        try "appearance = [".write(to: invalidConfigURL, atomically: true, encoding: .utf8)
        let invalidConfig = try requireFailedSPResult(
          try runner.run(
            ["config", "validate", "--path", invalidConfigURL.path, "--json"],
            cwd: space.directory
          )
        )
        #expect(try decodeSPJSON(SupatermSettingsValidationResult.self, from: invalidConfig).status == .invalid)

        let missingConfig = try requireFailedSPResult(
          try runner.run(
            ["config", "validate", "--path", "missing.toml", "--plain"],
            cwd: space.directory
          )
        )
        #expect(missingConfig.stdout.contains("missing"))
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func runInjectsSupatermAndTmuxEnvironment() async throws {
      try await withTestSpace { app, space in
        try await app.waitForShellPrompt(space.pane)
        let runner = spRunner(app, tabID: space.tab.tabID, paneID: space.tab.paneID)
        let result = try requireSuccessfulSPResult(
          try runner.run(
            ["run", "--socket", app.socketPath, "--", "/usr/bin/env"],
            cwd: space.directory
          )
        )
        let environment = parseEnvironment(result.stdout)

        #expect(environment[SupatermCLIEnvironment.socketPathKey] == app.socketPath)
        #expect(environment[SupatermCLIEnvironment.surfaceIDKey] == space.tab.paneID.uuidString)
        #expect(environment[SupatermCLIEnvironment.tabIDKey] == space.tab.tabID.uuidString)
        #expect(environment["TERM_PROGRAM"] == "ghostty")
        #expect(environment["TMUX_PANE"] == "%\(space.tab.paneID.uuidString.lowercased())")
        #expect(environment["TMUX"]?.contains(space.spaceID.uuidString.lowercased()) == true)
        #expect(environment["PATH"]?.contains(app.cliHome.path) == true)
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func spaceTabAndPaneCommandsMutateLiveAppState() async throws {
      try await withTestSpace { app, space in
        try await app.waitForShellPrompt(space.pane)
        let runner = spRunner(app, tabID: space.tab.tabID, paneID: space.tab.paneID)
        let cliSpace = try await exerciseSpaceCommands(app: app, space: space, runner: runner)
        let cliTab = try await exerciseTabCommands(app: app, space: space, cliSpace: cliSpace)
        try await exercisePaneCommands(app: app, space: space, cliSpace: cliSpace, cliTab: cliTab)
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func tmuxCompatibilityCommandsUseTheLiveSocketTree() async throws {
      try await withTestSpace { app, space in
        try await app.waitForShellPrompt(space.pane)
        let runner = spRunner(app, tabID: space.tab.tabID, paneID: space.tab.paneID)
        let split = try requireSuccessfulSPResult(
          try runner.run(
            [
              "tmux", "--socket", app.socketPath, "--", "split-window", "-h", "-P", "-F",
              "#{pane_id}",
            ],
            cwd: space.directory
          )
        )
        let splitPaneID = try tmuxPaneID(split.stdout)
        let splitPane = SupatermPaneTargetRequest(contextPaneID: splitPaneID)
        try await app.waitForShellPrompt(splitPane)

        let panes = try requireSuccessfulSPResult(
          try runner.run(
            ["tmux", "--socket", app.socketPath, "--", "list-panes", "-F", "#{pane_id}"],
            cwd: space.directory
          )
        )
        #expect(
          Set(outputLines(panes.stdout)) == [
            "%\(space.tab.paneID.uuidString.lowercased())",
            "%\(splitPaneID.uuidString.lowercased())",
          ])

        let displayed = try requireSuccessfulSPResult(
          try runner.run(
            [
              "tmux", "--socket", app.socketPath, "--", "display-message", "-p", "-t",
              "%\(splitPaneID.uuidString.lowercased())", "#{pane_id}:#{pane_index}",
            ],
            cwd: space.directory
          )
        )
        #expect(
          displayed.stdout.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix(
            "%\(splitPaneID.uuidString.lowercased()):"))

        let marker = "tmux-\(space.token)"
        _ = try requireSuccessfulSPResult(
          try runner.run(
            [
              "tmux", "--socket", app.socketPath, "--", "send-keys", "-t",
              "%\(splitPaneID.uuidString.lowercased())", "echo \(marker) > tmux.txt", "Enter",
            ],
            cwd: space.directory
          )
        )
        let file = space.directory.appendingPathComponent("tmux.txt", isDirectory: false)
        try await app.waitUntil("tmux send-keys writes tmux.txt") {
          (try? String(contentsOf: file, encoding: .utf8))?.contains(marker) == true
        }
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func paneWaitReadyReturnsExpectedExitCodes() async throws {
      try await withTestSpace { app, space in
        try await app.waitForShellPrompt(space.pane)
        let runner = spRunner(app, tabID: space.tab.tabID, paneID: space.tab.paneID)
        let ready = try requireSuccessfulSPResult(
          try runner.run(
            [
              "pane", "wait-ready", "--socket", app.socketPath, space.tab.paneID.uuidString,
              "--timeout", "5", "--plain",
            ],
            cwd: space.directory
          )
        )
        #expect(ready.stdout.contains("ready"))

        let missing = try runner.run(
          [
            "pane", "wait-ready", "--socket", app.socketPath,
            "00000000-0000-0000-0000-000000000000", "--timeout", "0.1", "--plain",
          ],
          cwd: space.directory
        )
        #expect(missing.exitCode != 0)
        #expect(missing.stderr.contains("No pane exists with UUID"))
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func jsonTreeMatchesSocketSnapshot() async throws {
      try await withTestSpace { app, space in
        try await app.waitForShellPrompt(space.pane)
        let runner = spRunner(app, tabID: space.tab.tabID, paneID: space.tab.paneID)
        let result = try requireSuccessfulSPResult(
          try runner.run(["ls", "--socket", app.socketPath, "--json"], cwd: space.directory)
        )
        let decoded = try decodeSPJSON(SupatermTreeSnapshot.self, from: result)
        let socket = try app.send(.tree(), as: SupatermTreeSnapshot.self)
        #expect(stableTreeRows(decoded) == stableTreeRows(socket))
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func developmentHookRoundTripsThroughEmbeddedBinary() async throws {
      try await withTestSpace { app, space in
        try await app.waitForShellPrompt(space.pane)
        let runner = spRunner(app, tabID: space.tab.tabID, paneID: space.tab.paneID)
        let sessionID = "e2e-\(space.token)"
        for command in [
          "session-start",
          "pre-tool-use",
          "notification",
          "user-prompt-submit",
          "stop",
          "session-end",
        ] {
          let result = try requireSuccessfulSPResult(
            try runner.run(
              [
                "internal", "dev", "claude", command, "--socket", app.socketPath,
                "--session-id", sessionID,
              ],
              cwd: space.directory
            )
          )
          #expect(result.stdout.contains("sent \(command) for session \(sessionID)"))
        }
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func bundledSkillsCatalogAndInstallRoundTripThroughEmbeddedBinary() async throws {
      try await withTestSpace { app, space in
        try await app.waitForShellPrompt(space.pane)
        let runner = spRunner(app, tabID: space.tab.tabID, paneID: space.tab.paneID)

        let list = try requireSuccessfulSPResult(
          try runner.run(["skills", "--json"], cwd: space.directory)
        )
        let listResponse = try decodeSPJSON(
          SkillsResponse<SupatermSkillSummary>.self,
          from: list
        )
        #expect(listResponse.success)
        #expect(listResponse.data.map(\.name) == ["coding-agents", "core"])

        let core = try requireSuccessfulSPResult(
          try runner.run(["skills", "get", "core", "--json"], cwd: space.directory)
        )
        let coreResponse = try decodeSPJSON(
          SkillsResponse<SupatermSkillContent>.self,
          from: core
        )
        let coreSkill = try #require(coreResponse.data.first)
        #expect(coreSkill.content.contains("# Supaterm core"))
        #expect(coreSkill.files == nil)

        let codingAgents = try requireSuccessfulSPResult(
          try runner.run(
            ["skills", "get", "coding-agents", "--full", "--json"], cwd: space.directory)
        )
        let codingAgentResponse = try decodeSPJSON(
          SkillsResponse<SupatermSkillContent>.self,
          from: codingAgents
        )
        let codingAgentSkill = try #require(codingAgentResponse.data.first)
        #expect(codingAgentSkill.content.contains("sp pane send --submit"))
        let codingAgentFiles = try #require(codingAgentSkill.files)
        #expect(codingAgentFiles.isEmpty)

        let missing = try requireFailedSPResult(
          try runner.run(
            ["skills", "get", "missing", "--json"], cwd: space.directory)
        )
        let missingResponse = try decodeSPJSON(SkillsErrorResponse.self, from: missing)
        #expect(!missingResponse.success)
        #expect(missingResponse.error.contains("Skill not found: missing"))
        #expect(missing.stderr.isEmpty)

        let install = try requireSuccessfulSPResult(
          try runner.run(["skills", "install", "--json"], cwd: space.directory)
        )
        let installResponse = try decodeSPJSON(
          SkillsResponse<SupatermSkillInstallResult>.self,
          from: install
        )
        let installResult = try #require(installResponse.data.first)
        let skillDirectoryURL = SupatermSkills.skillDirectoryURL(homeDirectoryURL: app.cliHome)
        #expect(installResult.path == skillDirectoryURL.path)
        #expect(
          FileManager.default.fileExists(
            atPath: SupatermSkills.skillDefinitionURL(skillDirectoryURL: skillDirectoryURL).path
          )
        )
        #expect((try? FileManager.default.destinationOfSymbolicLink(atPath: skillDirectoryURL.path)) == nil)
        #expect(
          try String(
            contentsOf: SupatermSkills.skillDefinitionURL(
              skillDirectoryURL: skillDirectoryURL
            ),
            encoding: .utf8
          ).contains("sp skills get core")
        )
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func agentSettingsAndInternalHookCommandsStayHermetic() async throws {
      try await withTestSpace { app, space in
        try await app.waitForShellPrompt(space.pane)
        let runner = spRunner(app, tabID: space.tab.tabID, paneID: space.tab.paneID)

        let claudeSettings = try requireSuccessfulSPResult(
          try runner.run(["internal", "agent-settings", "claude"], cwd: space.directory)
        )
        #expect(try jsonObject(from: claudeSettings.stdout)["hooks"] != nil)

        let codexSettings = try requireSuccessfulSPResult(
          try runner.run(["internal", "agent-settings", "codex"], cwd: space.directory)
        )
        #expect(try jsonObject(from: codexSettings.stdout)["hooks"] != nil)

        _ = try requireSuccessfulSPResult(
          try runner.run(["agent", "install-hook", "claude"], cwd: space.directory)
        )
        let claudeURL = ClaudeSettingsInstaller.settingsURL(homeDirectoryURL: app.cliHome)
        #expect(try String(contentsOf: claudeURL, encoding: .utf8).contains("receive-agent-hook --agent claude"))

        let event = SupatermAgentHookEvent(
          cwd: space.directory.path,
          hookEventName: .sessionStart,
          model: "e2e",
          sessionID: "agent-\(space.token)",
          source: "e2e"
        )
        _ = try requireSuccessfulSPResult(
          try runner.run(
            ["agent", "receive-agent-hook", "--agent", "claude", "--socket", app.socketPath],
            cwd: space.directory,
            stdin: try JSONEncoder().encode(event)
          )
        )

        let invalidHook = try requireFailedSPResult(
          try runner.run(
            ["agent", "receive-agent-hook", "--agent", "claude", "--socket", app.socketPath],
            cwd: space.directory,
            stdin: Data()
          )
        )
        #expect(invalidHook.stderr.contains("Agent hook input must be valid hook JSON"))

        _ = try requireSuccessfulSPResult(
          try runner.run(["agent", "remove-hook", "claude"], cwd: space.directory)
        )
        #expect(!fileContents(at: claudeURL).contains("receive-agent-hook --agent claude"))

        #expect(claudeURL.path.hasPrefix(app.cliHome.path))
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func tmuxCompatibilityCoversEveryDispatcherFamily() async throws {
      try await withTestSpace { app, space in
        try await app.waitForShellPrompt(space.pane)
        let runner = spRunner(app, tabID: space.tab.tabID, paneID: space.tab.paneID)
        try await exerciseTmuxCompatibility(app: app, space: space, runner: runner)
      }
    }
  }
}

private func spRunner(_ app: SupatermE2EApp, tabID: UUID, paneID: UUID) -> SPBinaryRunner {
  SPBinaryRunner(
    executable: app.spExecutable,
    environment: app.cliEnvironment(context: app.context(tabID: tabID, paneID: paneID))
  )
}

private func parseEnvironment(_ output: String) -> [String: String] {
  output.split(whereSeparator: \.isNewline).reduce(into: [:]) { result, line in
    let entry = String(line)
    guard let separator = entry.firstIndex(of: "=") else { return }
    result[String(entry[..<separator])] = String(entry[entry.index(after: separator)...])
  }
}

private func outputLines(_ output: String) -> [String] {
  output.split(whereSeparator: \.isNewline).map(String.init)
}

private struct CLISpaceE2E {
  let result: SupatermCreateSpaceResult
  let runner: SPBinaryRunner
}

private struct CLITabE2E {
  let result: SupatermNewTabResult
  let runner: SPBinaryRunner
}

private func exerciseSpaceCommands(
  app: SupatermE2EApp,
  space: TestSpace,
  runner: SPBinaryRunner
) async throws -> CLISpaceE2E {
  let created = try decodeSPJSON(
    SupatermCreateSpaceResult.self,
    from: try requireSuccessfulSPResult(
      try runner.run(
        [
          "space", "new", "--socket", app.socketPath, "--json", "--focus",
          "cli-space-\(space.token)",
        ],
        cwd: space.directory
      )
    )
  )
  let createdRunner = spRunner(app, tabID: created.tabID, paneID: created.paneID)
  try await app.waitForShellPrompt(SupatermPaneTargetRequest(contextPaneID: created.paneID))

  let renamed = try decodeSPJSON(
    SupatermSpaceTarget.self,
    from: try requireSuccessfulSPResult(
      try createdRunner.run(
        [
          "space", "rename", "--socket", app.socketPath, "--json",
          "renamed-\(space.token)", created.target.spaceID.uuidString,
        ],
        cwd: space.directory
      )
    )
  )
  #expect(renamed.name == "renamed-\(space.token)")

  let focusedBase = try decodeSPJSON(
    SupatermSelectSpaceResult.self,
    from: try requireSuccessfulSPResult(
      try createdRunner.run(
        ["space", "focus", "--socket", app.socketPath, "--json", space.spaceID.uuidString],
        cwd: space.directory
      )
    )
  )
  #expect(focusedBase.target.spaceID == space.spaceID)

  _ = try requireSuccessfulSPResult(
    try runner.run(["space", "next", "--socket", app.socketPath, "--plain"], cwd: space.directory)
  )
  _ = try requireSuccessfulSPResult(
    try runner.run(["space", "prev", "--socket", app.socketPath, "--plain"], cwd: space.directory)
  )
  _ = try requireSuccessfulSPResult(
    try runner.run(["space", "last", "--socket", app.socketPath, "--plain"], cwd: space.directory)
  )
  return CLISpaceE2E(result: created, runner: createdRunner)
}

private func exerciseTabCommands(
  app: SupatermE2EApp,
  space: TestSpace,
  cliSpace: CLISpaceE2E
) async throws -> CLITabE2E {
  let created = try decodeSPJSON(
    SupatermNewTabResult.self,
    from: try requireSuccessfulSPResult(
      try cliSpace.runner.run(
        [
          "tab", "new", "--socket", app.socketPath, "--json", "--focus",
          "--cwd", space.directory.path, "--script", hermeticShellStartupCommand,
          "--in", cliSpace.result.target.spaceID.uuidString,
        ],
        cwd: space.directory
      )
    )
  )
  try await app.waitForShellPrompt(SupatermPaneTargetRequest(contextPaneID: created.paneID))
  let runner = spRunner(app, tabID: created.tabID, paneID: created.paneID)

  let renamed = try decodeSPJSON(
    SupatermRenameTabResult.self,
    from: try requireSuccessfulSPResult(
      try runner.run(
        [
          "tab", "rename", "--socket", app.socketPath, "--json",
          "cli-tab-\(space.token)", created.tabID.uuidString,
        ],
        cwd: space.directory
      )
    )
  )
  #expect(renamed.isTitleLocked)
  #expect(renamed.target.title == "cli-tab-\(space.token)")

  let pinned = try decodeSPJSON(
    SupatermPinTabResult.self,
    from: try requireSuccessfulSPResult(
      try runner.run(
        ["tab", "pin", "--socket", app.socketPath, "--json", created.tabID.uuidString], cwd: space.directory)
    )
  )
  #expect(pinned.isPinned)

  let unpinned = try decodeSPJSON(
    SupatermPinTabResult.self,
    from: try requireSuccessfulSPResult(
      try runner.run(
        ["tab", "unpin", "--socket", app.socketPath, "--json", created.tabID.uuidString], cwd: space.directory)
    )
  )
  #expect(!unpinned.isPinned)

  try exerciseTabNavigation(app: app, space: space, cliSpace: cliSpace, runner: runner)
  return CLITabE2E(result: created, runner: runner)
}

private func exerciseTabNavigation(
  app: SupatermE2EApp,
  space: TestSpace,
  cliSpace: CLISpaceE2E,
  runner: SPBinaryRunner
) throws {
  let focusedOriginalTab = try decodeSPJSON(
    SupatermSelectTabResult.self,
    from: try requireSuccessfulSPResult(
      try runner.run(
        ["tab", "focus", "--socket", app.socketPath, "--json", cliSpace.result.tabID.uuidString],
        cwd: space.directory
      )
    )
  )
  #expect(focusedOriginalTab.target.tabID == cliSpace.result.tabID)

  for command in ["next", "prev", "last"] {
    _ = try requireSuccessfulSPResult(
      try cliSpace.runner.run(
        ["tab", command, "--socket", app.socketPath, "--plain", cliSpace.result.target.spaceID.uuidString],
        cwd: space.directory
      )
    )
  }
}

private func exercisePaneCommands(
  app: SupatermE2EApp,
  space: TestSpace,
  cliSpace: CLISpaceE2E,
  cliTab: CLITabE2E
) async throws {
  let created = cliTab.result
  let split = try decodeSPJSON(
    SupatermNewPaneResult.self,
    from: try requireSuccessfulSPResult(
      try cliTab.runner.run(
        [
          "pane", "split", "--socket", app.socketPath, "--json", "right",
          "--in", created.paneID.uuidString, "--cwd", space.directory.path,
          "--script", hermeticShellStartupCommand, "--layout", "keep",
        ],
        cwd: space.directory
      )
    )
  )
  #expect(split.direction == .right)
  try await app.waitForShellPrompt(SupatermPaneTargetRequest(contextPaneID: split.paneID))
  try await exercisePaneIO(app: app, space: space, cliTab: cliTab)
  try await closeCLIResources(app: app, space: space, cliSpace: cliSpace, cliTab: cliTab, splitPaneID: split.paneID)
}

private func exercisePaneIO(
  app: SupatermE2EApp,
  space: TestSpace,
  cliTab: CLITabE2E
) async throws {
  let created = cliTab.result
  let focusedPane = try decodeSPJSON(
    SupatermFocusPaneResult.self,
    from: try requireSuccessfulSPResult(
      try cliTab.runner.run(
        ["pane", "focus", "--socket", app.socketPath, "--json", created.paneID.uuidString],
        cwd: space.directory
      )
    )
  )
  #expect(focusedPane.target.paneID == created.paneID)

  let marker = "pane-cli-\(space.token)"
  _ = try requireSuccessfulSPResult(
    try cliTab.runner.run(
      [
        "pane", "send", "--socket", app.socketPath, "--newline", "--plain",
        created.paneID.uuidString, "printf '\(marker)\\n'",
      ],
      cwd: space.directory
    )
  )
  try await app.waitForCapture(SupatermPaneTargetRequest(contextPaneID: created.paneID), contains: marker)

  let submittedMarker = "pane-submit-\(space.token)"
  _ = try requireSuccessfulSPResult(
    try cliTab.runner.run(
      [
        "pane", "send", "--socket", app.socketPath, "--submit", "--plain",
        created.paneID.uuidString, "-",
      ],
      cwd: space.directory,
      stdin: Data("printf '\(submittedMarker)-one\\n'\nprintf '\(submittedMarker)-two\\n'".utf8)
    )
  )
  try await app.waitForCapture(
    SupatermPaneTargetRequest(contextPaneID: created.paneID),
    contains: "\(submittedMarker)-two"
  )

  let capture = try decodeSPJSON(
    SupatermCapturePaneResult.self,
    from: try requireSuccessfulSPResult(
      try cliTab.runner.run(
        [
          "pane", "capture", "--socket", app.socketPath, "--json",
          "--scope", "scrollback", "--lines", "12", created.paneID.uuidString,
        ],
        cwd: space.directory
      )
    )
  )
  #expect(capture.text.contains(marker))
  #expect(capture.text.contains("\(submittedMarker)-one"))
  #expect(capture.text.contains("\(submittedMarker)-two"))
  try exercisePaneStatusAndActions(app: app, space: space, cliTab: cliTab)
}

private func exercisePaneStatusAndActions(
  app: SupatermE2EApp,
  space: TestSpace,
  cliTab: CLITabE2E
) throws {
  let created = cliTab.result
  let health = try decodeSPJSON(
    SupatermPaneHealthResult.self,
    from: try requireSuccessfulSPResult(
      try cliTab.runner.run(
        ["pane", "health", "--socket", app.socketPath, "--json", created.paneID.uuidString], cwd: space.directory)
    )
  )
  #expect(health.isReady)

  _ = try requireSuccessfulSPResult(
    try cliTab.runner.run(
      ["pane", "wait-ready", "--socket", app.socketPath, "--plain", created.paneID.uuidString, "--timeout", "5"],
      cwd: space.directory
    )
  )
  _ = try requireSuccessfulSPResult(
    try cliTab.runner.run(
      ["pane", "resize", "--socket", app.socketPath, "--plain", "right", "1", created.paneID.uuidString],
      cwd: space.directory
    )
  )
  for layout in ["equalize", "tile", "main-vertical"] {
    _ = try requireSuccessfulSPResult(
      try cliTab.runner.run(
        ["pane", "layout", "--socket", app.socketPath, "--plain", layout, created.tabID.uuidString],
        cwd: space.directory)
    )
  }

  let notification = try decodeSPJSON(
    SupatermNotifyResult.self,
    from: try requireSuccessfulSPResult(
      try cliTab.runner.run(
        [
          "pane", "notify", "--socket", app.socketPath, "--json",
          "--title", "CLI \(space.token)", "--body", "body", created.paneID.uuidString,
        ],
        cwd: space.directory
      )
    )
  )
  #expect(notification.resolvedTitle == "CLI \(space.token)")
  let invalidCapture = try requireFailedSPResult(
    try cliTab.runner.run(
      ["pane", "capture", "--socket", app.socketPath, "--lines", "0", created.paneID.uuidString], cwd: space.directory)
  )
  #expect(invalidCapture.stderr.contains("--lines must be 1 or greater"))
}

private func closeCLIResources(
  app: SupatermE2EApp,
  space: TestSpace,
  cliSpace: CLISpaceE2E,
  cliTab: CLITabE2E,
  splitPaneID: UUID
) async throws {
  _ = try requireSuccessfulSPResult(
    try cliTab.runner.run(
      ["pane", "close", "--socket", app.socketPath, "--json", splitPaneID.uuidString], cwd: space.directory)
  )
  _ = try requireSuccessfulSPResult(
    try cliTab.runner.run(
      ["tab", "close", "--socket", app.socketPath, "--json", cliTab.result.tabID.uuidString], cwd: space.directory)
  )
  _ = try requireSuccessfulSPResult(
    try cliSpace.runner.run(
      ["space", "destroy", "--socket", app.socketPath, "--json", "-y", cliSpace.result.target.spaceID.uuidString],
      cwd: space.directory)
  )
  try await app.waitForDebugSnapshot("CLI-created space closes") { snapshot in
    !snapshot.windows.flatMap(\.spaces).contains { $0.id == cliSpace.result.target.spaceID }
  }
}

private struct TmuxE2E {
  let app: SupatermE2EApp
  let space: TestSpace
  let runner: SPBinaryRunner

  func run(_ arguments: [String], timeout: TimeInterval = 10) throws -> SPBinaryResult {
    try requireSuccessfulSPResult(
      try runner.run(
        ["tmux", "--socket", app.socketPath, "--"] + arguments,
        cwd: space.directory,
        timeout: timeout
      )
    )
  }
}

private struct TmuxFixture {
  let newSession: UUID
  let createdWindow: UUID
  let originalPane: UUID
  let splitPane: UUID
}

private func exerciseTmuxCompatibility(
  app: SupatermE2EApp,
  space: TestSpace,
  runner: SPBinaryRunner
) async throws {
  let tmux = TmuxE2E(app: app, space: space, runner: runner)
  _ = try tmux.run(["has-session", "-t", tmuxSpaceSelector(space.spaceID)])
  let fixture = try await createTmuxFixture(tmux)
  try await exerciseTmuxPaneIO(tmux, fixture: fixture)
  try exerciseTmuxControls(tmux, fixture: fixture)
  try exerciseTmuxCloseAndFailures(tmux, fixture: fixture)
}

private func createTmuxFixture(_ tmux: TmuxE2E) async throws -> TmuxFixture {
  let newSession = try tmuxSpaceID(
    tmux.run(["new-session", "-d", "-n", "tmux-space-\(tmux.space.token)", "-P", "-F", "#{session_id}"]).stdout
  )
  let createdWindow = try tmuxTabID(
    tmux.run(
      [
        "new-window", "-t", tmuxSpaceSelector(tmux.space.spaceID), "-n",
        "tmux-window-\(tmux.space.token)", "-P", "-F", "#{window_id}",
      ]
    ).stdout
  )
  _ = try tmux.run(["select-window", "-t", tmuxTabSelector(createdWindow)])
  _ = try tmux.run(["rename-window", "-t", tmuxTabSelector(createdWindow), "tmux-renamed-\(tmux.space.token)"])

  let originalPane = try tmuxPaneID(
    tmux.run(["list-panes", "-t", tmuxTabSelector(createdWindow), "-F", "#{pane_id}"]).stdout
  )
  try await tmux.app.waitForShellPrompt(SupatermPaneTargetRequest(contextPaneID: originalPane))
  let splitPane = try tmuxPaneID(
    tmux.run(["split-window", "-h", "-P", "-F", "#{pane_id}", "-t", tmuxPaneSelector(originalPane)]).stdout
  )
  try await tmux.app.waitForShellPrompt(SupatermPaneTargetRequest(contextPaneID: splitPane))
  return TmuxFixture(
    newSession: newSession,
    createdWindow: createdWindow,
    originalPane: originalPane,
    splitPane: splitPane
  )
}

private func exerciseTmuxPaneIO(_ tmux: TmuxE2E, fixture: TmuxFixture) async throws {
  _ = try tmux.run(["select-pane", "-t", tmuxPaneSelector(fixture.splitPane)])
  _ = try tmux.run(["select-pane", "-P", "fg=green", "-t", tmuxPaneSelector(fixture.splitPane)])
  let displayed = try tmux.run(
    ["display-message", "-p", "-t", tmuxPaneSelector(fixture.splitPane), "#{pane_id}:#{window_name}"]
  )
  #expect(displayed.stdout.contains(tmuxPaneSelector(fixture.splitPane)))

  let marker = "tmux-live-\(tmux.space.token)"
  _ = try tmux.run(
    ["send-keys", "-t", tmuxPaneSelector(fixture.splitPane), "echo \(marker) > tmux-live.txt", "Enter"]
  )
  try await tmux.app.waitUntil("tmux send-keys writes a file") {
    fileContents(at: tmux.space.directory.appendingPathComponent("tmux-live.txt")).contains(marker)
  }

  _ = try tmux.run(["capture-pane", "-t", tmuxPaneSelector(fixture.splitPane), "-p", "-S", "-5"])
  _ = try tmux.run(["capture-pane", "-t", tmuxPaneSelector(fixture.splitPane), "-S", "-5"])
  let shownBuffer = try tmux.run(["show-buffer"])
  #expect(shownBuffer.stdout.contains(marker) || shownBuffer.stdout.contains("echo \(marker)"))
  _ = try tmux.run(["save-buffer", "saved-buffer.txt"])
  #expect(FileManager.default.fileExists(atPath: tmux.space.directory.appendingPathComponent("saved-buffer.txt").path))
  try await exerciseTmuxBuffers(tmux, splitPane: fixture.splitPane)
}

private func exerciseTmuxBuffers(_ tmux: TmuxE2E, splitPane: UUID) async throws {
  let bufferText = "tmux-buffer-\(tmux.space.token)"
  _ = try tmux.run(["set-buffer", "-b", "custom", bufferText])
  #expect(try tmux.run(["list-buffers"]).stdout.contains("custom"))
  #expect(try tmux.run(["show-buffer", "-b", "custom"]).stdout.contains(bufferText))
  _ = try tmux.run(["paste-buffer", "-b", "custom", "-t", tmuxPaneSelector(splitPane)])
  try await tmux.app.waitForCapture(SupatermPaneTargetRequest(contextPaneID: splitPane), contains: bufferText)
}

private func exerciseTmuxControls(_ tmux: TmuxE2E, fixture: TmuxFixture) throws {
  let waitName = "wait-\(tmux.space.token)"
  _ = try tmux.run(["wait-for", "-S", waitName])
  #expect(try tmux.run(["wait-for", "--timeout", "0.5", waitName]).stdout.contains("OK"))
  let timedOutWait = try requireFailedSPResult(
    try tmux.runner.run(
      ["tmux", "--socket", tmux.app.socketPath, "--", "wait-for", "--timeout", "0.1", "missing-\(tmux.space.token)"],
      cwd: tmux.space.directory
    )
  )
  #expect(timedOutWait.stderr.contains("wait-for timed out"))

  _ = try tmux.run(["last-pane", "-t", tmuxTabSelector(fixture.createdWindow)])
  _ = try tmux.run(["resize-pane", "-t", tmuxPaneSelector(fixture.splitPane), "-x", "40"])
  _ = try tmux.run(["resize-pane", "-t", tmuxPaneSelector(fixture.splitPane), "-R"])
  for layout in ["tiled", "main-vertical", "even-horizontal"] {
    _ = try tmux.run(["select-layout", "-t", tmuxTabSelector(fixture.createdWindow), layout])
  }
  let windows = try tmux.run(["list-windows", "-t", tmuxSpaceSelector(tmux.space.spaceID), "-F", "#{window_id}"])
  #expect(windows.stdout.contains(tmuxTabSelector(fixture.createdWindow)))
  let panes = try tmux.run(["list-panes", "-t", tmuxTabSelector(fixture.createdWindow), "-F", "#{pane_id}"])
  #expect(panes.stdout.contains(tmuxPaneSelector(fixture.splitPane)))
}

private func exerciseTmuxCloseAndFailures(_ tmux: TmuxE2E, fixture: TmuxFixture) throws {
  _ = try tmux.run(["set-hook", "pane-focus-in", "display-message focused"])
  #expect(try tmux.run(["set-hook", "--list"]).stdout.contains("pane-focus-in"))
  _ = try tmux.run(["set-hook", "--unset", "pane-focus-in"])
  for arguments in tmuxNoopCommands {
    _ = try tmux.run(arguments)
  }
  _ = try tmux.run(["next-window", "-t", tmuxSpaceSelector(tmux.space.spaceID)])
  _ = try tmux.run(["previous-window", "-t", tmuxSpaceSelector(tmux.space.spaceID)])
  _ = try tmux.run(["last-window", "-t", tmuxSpaceSelector(tmux.space.spaceID)])
  _ = try tmux.run(["select-window", "-t", "!"])
  _ = try tmux.run(["kill-pane", "-t", tmuxPaneSelector(fixture.splitPane)])
  _ = try tmux.run(["kill-window", "-t", tmuxTabSelector(fixture.createdWindow)])
  _ = try requireSuccessfulSPResult(
    try tmux.runner.run(
      ["space", "destroy", "--socket", tmux.app.socketPath, "--json", "-y", fixture.newSession.uuidString],
      cwd: tmux.space.directory)
  )
  let unsupported = try requireFailedSPResult(
    try tmux.runner.run(
      ["tmux", "--socket", tmux.app.socketPath, "--", "unsupported-command"], cwd: tmux.space.directory)
  )
  #expect(unsupported.stderr.contains("Unsupported tmux compatibility command"))
  let unsupportedNewSessionFlag = try requireFailedSPResult(
    try tmux.runner.run(
      ["tmux", "--socket", tmux.app.socketPath, "--", "new-session", "-A", "-n", "bad"], cwd: tmux.space.directory)
  )
  #expect(unsupportedNewSessionFlag.stderr.contains("new-session -A is not supported"))
}

private let parentHelpCommands = [
  ["space"],
  ["tab"],
  ["pane"],
  ["agent"],
  ["agent", "install-hook"],
  ["agent", "remove-hook"],
  ["config"],
  ["instance"],
  ["internal"],
  ["internal", "agent-settings"],
  ["internal", "dev"],
  ["internal", "dev", "claude"],
  ["tmux"],
  ["run"],
]

private let tmuxNoopCommands = [
  ["set-option", "-g", "status", "off"],
  ["set", "-g", "mouse", "on"],
  ["set-window-option", "-g", "automatic-rename", "off"],
  ["source-file", ".tmux.conf"],
  ["refresh-client"],
  ["attach-session"],
  ["detach-client"],
]

private struct PingResult: Decodable {
  let pong: Bool
}

private struct SkillsResponse<Value: Decodable>: Decodable {
  let success: Bool
  let data: [Value]
}

private struct SkillsErrorResponse: Decodable {
  let success: Bool
  let error: String
}

private struct DiagnosticReport: Decodable {
  struct Socket: Decodable {
    let path: String?
    let requestSucceeded: Bool
  }

  let socket: Socket
  let app: SupatermAppDebugSnapshot?
}

private func jsonObject(from output: String) throws -> [String: Any] {
  let data = try #require(output.data(using: .utf8))
  let value = try JSONSerialization.jsonObject(with: data)
  guard let object = value as? [String: Any] else {
    throw SupatermE2EError("Expected JSON object.")
  }
  return object
}

private func fileContents(at url: URL) -> String {
  (try? String(contentsOf: url, encoding: .utf8)) ?? ""
}

private func tmuxSpaceSelector(_ id: UUID) -> String {
  "$\(id.uuidString.lowercased())"
}

private func tmuxTabSelector(_ id: UUID) -> String {
  "@\(id.uuidString.lowercased())"
}

private func tmuxPaneSelector(_ id: UUID) -> String {
  "%\(id.uuidString.lowercased())"
}

private func tmuxSpaceID(_ output: String) throws -> UUID {
  try tmuxIdentifier(output, prefix: "$", name: "space")
}

private func tmuxTabID(_ output: String) throws -> UUID {
  try tmuxIdentifier(output, prefix: "@", name: "tab")
}

private func stableTreeRows(_ tree: SupatermTreeSnapshot) -> [String] {
  tree.windows.flatMap { window in
    window.spaces.flatMap { space in
      space.tabs.flatMap { tab in
        tab.panes.map { pane in
          [
            "window:\(window.index):\(window.isKey)",
            "space:\(space.index):\(space.id):\(space.isSelected)",
            "tab:\(tab.index):\(tab.id):\(tab.isSelected)",
            "pane:\(pane.index):\(pane.id):\(pane.isFocused)",
          ].joined(separator: "|")
        }
      }
    }
  }
}

private func tmuxPaneID(_ output: String) throws -> UUID {
  try tmuxIdentifier(output, prefix: "%", name: "pane")
}

private func tmuxIdentifier(_ output: String, prefix: Character, name: String) throws -> UUID {
  let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
  guard trimmed.first == prefix else {
    throw SupatermE2EError("Expected tmux \(name) id, got \(trimmed).")
  }
  guard let id = UUID(uuidString: String(trimmed.dropFirst())) else {
    throw SupatermE2EError("Invalid tmux \(name) id: \(trimmed).")
  }
  return id
}

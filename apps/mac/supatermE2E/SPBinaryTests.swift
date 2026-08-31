import Foundation
import SupatermCLIShared
import Testing

extension SupatermE2ESuite {
  @Suite struct SPBinaryTests {
    @Test(.timeLimit(.minutes(5)))
    func parentReadOnlyAndConfigCommandsRoundTripThroughEmbeddedBinary() async throws {
      try await withTestSpace { app, space in
        try await app.waitForShellPrompt(space.pane)
        let runner = SPBinaryRunner(app: app, tabID: space.tab.tabID, paneID: space.tab.paneID)

        for arguments in parentHelpCommands {
          let result = try requireSuccessfulSPResult(
            try runner.run(arguments, cwd: space.directory))
          #expect(result.stdout.contains("USAGE:"))
        }

        try expectOnboardingCommands(app: app, space: space, runner: runner)

        let diagnostic = try requireSuccessfulSPResult(
          try runner.run(
            ["diagnostic", "--socket", app.socketPath, "--json"],
            cwd: space.directory,
            timeout: 30
          )
        )
        let diagnosticReport = try decodeSPJSON(DiagnosticReport.self, from: diagnostic)
        #expect(diagnosticReport.socket.path == app.socketPath)
        #expect(diagnosticReport.socket.requestSucceeded)
        #expect(diagnosticReport.app?.summary.paneCount ?? 0 > 0)
        let debugPane = try #require(try app.debugPane(space.tab.paneID))
        let spPane = try #require(
          diagnosticReport.app?.windows
            .flatMap(\.spaces)
            .flatMap(\.flattenedTabs)
            .flatMap(\.panes)
            .first { $0.id == space.tab.paneID }
        )
        #expect(debugPane.foregroundProcessGroupID != nil)
        #expect(debugPane.ttyName?.hasPrefix("/dev/") == true)
        #expect(spPane.foregroundProcessGroupID == debugPane.foregroundProcessGroupID)
        #expect(spPane.ttyName == debugPane.ttyName)
        let debugProcessGroupID = try #require(debugPane.foregroundProcessGroupID)
        let debugTTYName = try #require(debugPane.ttyName)

        let diagnosticPlain = try requireSuccessfulSPResult(
          try runner.run(
            ["diagnostic", "--socket", app.socketPath, "--plain"],
            cwd: space.directory,
            timeout: 30
          )
        )
        #expect(diagnosticPlain.stdout.contains("request succeeded: yes"))
        let processGroupLine = "foreground process group: \(debugProcessGroupID)"
        #expect(diagnosticPlain.stdout.contains(processGroupLine))
        #expect(diagnosticPlain.stdout.contains("tty: \(debugTTYName)"))

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
        let defaultValidation = try decodeSPJSON(
          SupatermSettingsValidationResult.self, from: defaultConfig)
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
        #expect(
          try decodeSPJSON(SupatermSettingsValidationResult.self, from: validConfig).status
            == .valid)

        let invalidConfigURL = space.directory.appendingPathComponent("invalid.toml")
        try "appearance = [".write(to: invalidConfigURL, atomically: true, encoding: .utf8)
        let invalidConfig = try requireFailedSPResult(
          try runner.run(
            ["config", "validate", "--path", invalidConfigURL.path, "--json"],
            cwd: space.directory
          )
        )
        #expect(
          try decodeSPJSON(SupatermSettingsValidationResult.self, from: invalidConfig).status
            == .invalid)

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
    func configSetGetAndSkillsListResolveThroughTheAppSocket() async throws {
      try await withTestSpace { app, space in
        try await app.waitForShellPrompt(space.pane)
        let runner = SPBinaryRunner(app: app, tabID: space.tab.tabID, paneID: space.tab.paneID)

        let set = try decodeSPJSON(
          SupatermSettingsMutationResult.self,
          from: try requireSuccessfulSPResult(
            try runner.run(
              ["config", "set", "coding_agents.show_panel", "false", "--json"],
              cwd: space.directory
            )
          )
        )
        #expect(set.key == "coding_agents.show_panel")
        #expect(set.oldValue == "true")
        #expect(set.value == "false")
        #expect(!set.isDefault)
        #expect(set.path.hasPrefix(app.stateHome.path))

        let get = try decodeSPJSON(
          SupatermSettingsGetResult.self,
          from: try requireSuccessfulSPResult(
            try runner.run(
              ["config", "get", "coding_agents.show_panel", "--json"],
              cwd: space.directory
            )
          )
        )
        #expect(get.entry.value == "false")
        #expect(get.path == set.path)

        let changed = try requireSuccessfulSPResult(
          try runner.run(["config", "list", "--changed", "--plain"], cwd: space.directory)
        )
        #expect(changed.stdout.contains("coding_agents.show_panel\tfalse"))

        let reset = try decodeSPJSON(
          SupatermSettingsMutationResult.self,
          from: try requireSuccessfulSPResult(
            try runner.run(
              ["config", "reset", "coding_agents.show_panel", "--json"],
              cwd: space.directory
            )
          )
        )
        #expect(reset.value == "true")
        #expect(reset.isDefault)

        let unknown = try requireFailedSPResult(
          try runner.run(["config", "get", "terminal.confirm_quit"], cwd: space.directory)
        )
        #expect(unknown.stderr.contains("Unknown config key `terminal.confirm_quit`."))

        let skills = try requireSuccessfulSPResult(
          try runner.run(["skills", "list"], cwd: space.directory)
        )
        #expect(
          skills.stdout.split(separator: "\n").compactMap { $0.split(separator: "\t").first }
            == ["coding-agents", "core"]
        )
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func jsonListIsACompactAgentSnapshot() async throws {
      try await withTestSpace { app, space in
        try await app.waitForShellPrompt(space.pane)
        let runner = SPBinaryRunner(app: app, tabID: space.tab.tabID, paneID: space.tab.paneID)
        let result = try requireSuccessfulSPResult(
          try runner.run(["ls", "--socket", app.socketPath, "--json"], cwd: space.directory)
        )
        let plain = try requireSuccessfulSPResult(
          try runner.run(["ls", "--socket", app.socketPath, "--plain"], cwd: space.directory)
        )
        let list = try decodeSPJSON(ListSnapshot.self, from: result)
        let pane = try #require(list.items.first { $0.id == space.tab.paneID })
        let paneRef = try listedRef(.pane, id: space.tab.paneID, output: plain.stdout)
        let capture = try requireSuccessfulSPResult(
          try runner.run(
            ["pane", "capture", "--socket", app.socketPath, "--plain", paneRef],
            cwd: space.directory
          )
        )

        #expect(list.revision.count == 16)
        #expect(list.current?.spaceID == space.spaceID)
        #expect(list.current?.tabID == space.tab.tabID)
        #expect(list.current?.paneID == space.tab.paneID)
        #expect(pane.kind == .pane)
        #expect(pane.parentID == space.tab.tabID)
        #expect(
          pane.cwd.map { URL(fileURLWithPath: $0).standardizedFileURL.path }
            == space.directory.standardizedFileURL.path
        )
        #expect(capture.stdout.isEmpty == false)
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func bundledSkillsCatalogResolvesThroughTheAppSocket() async throws {
      try await withTestSpace { app, space in
        try await app.waitForShellPrompt(space.pane)
        let runner = SPBinaryRunner(app: app, tabID: space.tab.tabID, paneID: space.tab.paneID)

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
          try runner.run(["skills", "get", "core"], cwd: space.directory)
        )
        #expect(core.stdout.contains("# Supaterm core"))
        #expect(!core.stdout.contains("--- references/"))

        let fullCore = try requireSuccessfulSPResult(
          try runner.run(
            ["skills", "get", "core", "--full"], cwd: space.directory)
        )
        #expect(fullCore.stdout.contains("--- references/pane.md ---"))
        #expect(fullCore.stdout.contains("--- references/group.md ---"))

        let path = try requireSuccessfulSPResult(
          try runner.run(["skills", "path", "core"], cwd: space.directory)
        )
        let coreDirectory = path.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
        #expect(coreDirectory.hasSuffix("/skill-data/core"))
        #expect(FileManager.default.fileExists(atPath: coreDirectory + "/SKILL.md"))

        let missing = try requireFailedSPResult(
          try runner.run(["skills", "get", "missing"], cwd: space.directory)
        )
        #expect(missing.stdout.isEmpty)
        #expect(missing.stderr.contains("Skill not found: missing"))
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func agentSettingsAndInternalHookCommandsStayHermetic() async throws {
      try await withTestSpace { app, space in
        try await app.waitForShellPrompt(space.pane)
        let runner = SPBinaryRunner(app: app, tabID: space.tab.tabID, paneID: space.tab.paneID)

        let claudeSettings = try requireSuccessfulSPResult(
          try runner.run(["internal", "agent-settings", "claude"], cwd: space.directory)
        )
        #expect(try jsonObject(from: claudeSettings.stdout)["hooks"] != nil)

        let codexSettings = try requireSuccessfulSPResult(
          try runner.run(["internal", "agent-settings", "codex"], cwd: space.directory)
        )
        #expect(try jsonObject(from: codexSettings.stdout)["hooks"] != nil)

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
      }
    }

  }
}

private func expectOnboardingCommands(
  app: SupatermE2EApp,
  space: TestSpace,
  runner: SPBinaryRunner
) throws {
  let onboard = try requireSuccessfulSPResult(
    try runner.run(["onboard", "--socket", app.socketPath, "--json"], cwd: space.directory)
  )
  #expect(try decodeSPJSON(SupatermOnboardingSnapshot.self, from: onboard).items.isEmpty == false)

  let quietOnboard = try requireSuccessfulSPResult(
    try runner.run(["onboard", "--socket", app.socketPath, "--quiet"], cwd: space.directory)
  )
  #expect(quietOnboard.stdout.isEmpty)
}

private let parentHelpCommands = [
  ["space"],
  ["tab"],
  ["pane"],
  ["agent"],
  ["agent", "setup", "--help"],
  ["agent", "remove-hooks", "--help"],
  ["config"],
  ["instance"],
  ["internal"],
  ["internal", "agent-settings"],
  ["internal", "dev"],
  ["internal", "dev", "claude"],
]

private struct PingResult: Decodable {
  let pong: Bool
}

private struct SkillsResponse<Value: Decodable>: Decodable {
  let success: Bool
  let data: [Value]
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

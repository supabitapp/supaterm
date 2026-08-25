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
    func spaceTabAndPaneCommandsMutateLiveAppState() async throws {
      try await withTestSpace { app, space in
        try await app.waitForShellPrompt(space.pane)
        let runner = SPBinaryRunner(app: app, tabID: space.tab.tabID, paneID: space.tab.paneID)
        let cliSpace = try await exerciseSpaceCommands(app: app, space: space, runner: runner)
        let cliTab = try await exerciseTabCommands(app: app, space: space, cliSpace: cliSpace)
        try await exercisePaneCommands(app: app, space: space, cliSpace: cliSpace, cliTab: cliTab)
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func projectCommandsMutateCatalogAndFlatSocketTree() async throws {
      try await withTestSpace { app, space in
        let runner = SPBinaryRunner(app: app, tabID: space.tab.tabID, paneID: space.tab.paneID)
        try exerciseProjectCommands(app: app, space: space, runner: runner)
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func paneWaitReadyReturnsExpectedExitCodes() async throws {
      try await withTestSpace { app, space in
        try await app.waitForShellPrompt(space.pane)
        let runner = SPBinaryRunner(app: app, tabID: space.tab.tabID, paneID: space.tab.paneID)
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
        #expect(fullCore.stdout.contains("--- references/project.md ---"))

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

private struct CLISpaceE2E {
  let result: SupatermCreateSpaceResult
  let runner: SPBinaryRunner
}

private struct CLITabE2E {
  let result: SupatermNewTabResult
  let runner: SPBinaryRunner
}

private struct CLIProjectsE2E {
  let work: SupatermSnapshotProject
  let later: SupatermSnapshotProject
}

private struct CLIProjectTabsE2E {
  let created: SupatermNewTabResult
  let untouchedTabIDs: [UUID]
  let untouchedPinStates: [Bool]
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

private func exerciseProjectCommands(
  app: SupatermE2EApp,
  space: TestSpace,
  runner: SPBinaryRunner
) throws {
  let projects = try addAndOrderProjects(app: app, space: space, runner: runner)
  try exerciseProjectPinning(projects.work, app: app, space: space, runner: runner)
  try expectProjectCatalog(projects, app: app, space: space, runner: runner)
  try expectProjectIcon(space: space, runner: runner)
  let tabs = try exerciseProjectTabPlacement(
    projects,
    app: app,
    space: space,
    runner: runner
  )
  try exerciseProjectRemoval(projects, tabs: tabs, app: app, space: space, runner: runner)
}

private func addAndOrderProjects(
  app: SupatermE2EApp,
  space: TestSpace,
  runner: SPBinaryRunner
) throws -> CLIProjectsE2E {
  let work: SupatermProjectMutationResult = try runSPJSON(
    ["project", "add", "Work", "--root", space.directory.path, "--color", "blue"],
    app: app,
    runner: runner,
    cwd: space.directory
  )
  let later: SupatermProjectMutationResult = try runSPJSON(
    ["project", "add", "Later", "--color", "purple"],
    app: app,
    runner: runner,
    cwd: space.directory
  )
  #expect(work.project.name == "Work")
  #expect(work.project.rootPath == space.directory.path)
  #expect(work.project.color == .blue)
  #expect(!work.project.isPinned)
  #expect(later.project.name == "Later")
  let reordered: SupatermProjectMutationResult = try runSPJSON(
    ["project", "reorder", later.project.id.uuidString, "--index", "1"],
    app: app,
    runner: runner,
    cwd: space.directory
  )
  #expect(reordered.project.id == later.project.id)
  return CLIProjectsE2E(work: work.project, later: later.project)
}

private func exerciseProjectPinning(
  _ work: SupatermSnapshotProject,
  app: SupatermE2EApp,
  space: TestSpace,
  runner: SPBinaryRunner
) throws {
  let pinned: SupatermProjectMutationResult = try runSPJSON(
    ["project", "pin", work.id.uuidString],
    app: app,
    runner: runner,
    cwd: space.directory
  )
  #expect(pinned.project.isPinned)
  let pinnedAgain: SupatermProjectMutationResult = try runSPJSON(
    ["project", "pin", work.id.uuidString],
    app: app,
    runner: runner,
    cwd: space.directory
  )
  #expect(pinnedAgain.project.isPinned)
  let unpinned: SupatermProjectMutationResult = try runSPJSON(
    ["project", "unpin", work.id.uuidString],
    app: app,
    runner: runner,
    cwd: space.directory
  )
  #expect(!unpinned.project.isPinned)
  let unpinnedAgain: SupatermProjectMutationResult = try runSPJSON(
    ["project", "unpin", work.id.uuidString],
    app: app,
    runner: runner,
    cwd: space.directory
  )
  #expect(!unpinnedAgain.project.isPinned)
}

private func expectProjectCatalog(
  _ projects: CLIProjectsE2E,
  app: SupatermE2EApp,
  space: TestSpace,
  runner: SPBinaryRunner
) throws {
  _ =
    try runSPJSON(
      ["project", "reorder", projects.work.id.uuidString, "--index", "1"],
      app: app,
      runner: runner,
      cwd: space.directory
    ) as SupatermProjectMutationResult
  let listed: [SupatermSnapshotProject] = try runSPJSON(
    ["project", "list"],
    app: app,
    runner: runner,
    cwd: space.directory
  )
  #expect(listed.map(\.id) == [projects.work.id, projects.later.id])
}

private func expectProjectIcon(space: TestSpace, runner: SPBinaryRunner) throws {
  let icon = try requireSuccessfulSPResult(
    try runner.run(
      ["project", "icon", space.directory.path, "--json"],
      cwd: space.directory
    )
  )
  #expect(icon.stdout.contains(#""path":null"#))
}

private func exerciseProjectTabPlacement(
  _ projects: CLIProjectsE2E,
  app: SupatermE2EApp,
  space: TestSpace,
  runner: SPBinaryRunner
) throws -> CLIProjectTabsE2E {
  let work = projects.work
  let initialTree = try app.send(.tree(), as: SupatermTreeSnapshot.self)
  let initialSpace = try #require(
    initialTree.windows.flatMap(\.spaces).first { $0.id == space.spaceID }
  )
  let untouchedTabs = initialSpace.tabs.filter { $0.id != space.tab.tabID }
  let tab: SupatermNewTabResult = try runSPJSON(
    [
      "tab", "new", "--project", work.id.uuidString,
      "--in", space.spaceID.uuidString,
    ],
    app: app,
    runner: runner,
    cwd: space.directory
  )
  let movedIntoProject: SupatermMoveTabResult = try runSPJSON(
    [
      "tab", "move", space.tab.tabID.uuidString,
      "--project", work.id.uuidString, "--pin", "--index", "1",
    ],
    app: app,
    runner: runner,
    cwd: space.directory
  )
  #expect(movedIntoProject.target.tabID == space.tab.tabID)
  let assignedTree = try app.send(.tree(), as: SupatermTreeSnapshot.self)
  let assignedSpace = try #require(
    assignedTree.windows.flatMap(\.spaces).first { $0.id == space.spaceID }
  )
  #expect(assignedTree.projects.map(\.id) == [work.id, projects.later.id])
  #expect(assignedSpace.tabs.map(\.id) == [space.tab.tabID, tab.tabID] + untouchedTabs.map(\.id))
  #expect(
    assignedSpace.tabs.map(\.projectID)
      == [work.id, work.id] + Array(repeating: nil, count: untouchedTabs.count)
  )
  #expect(assignedSpace.tabs.map(\.isPinned) == [true, false] + untouchedTabs.map(\.isPinned))
  let moved: SupatermMoveTabResult = try runSPJSON(
    ["tab", "move", tab.tabID.uuidString, "--unassigned", "--unpin", "--index", "1"],
    app: app,
    runner: runner,
    cwd: space.directory
  )
  #expect(moved.target.tabID == tab.tabID)
  let movedTree = try app.send(.tree(), as: SupatermTreeSnapshot.self)
  let movedSpace = try #require(
    movedTree.windows.flatMap(\.spaces).first { $0.id == space.spaceID })
  #expect(movedSpace.tabs.map(\.id) == [space.tab.tabID, tab.tabID] + untouchedTabs.map(\.id))
  #expect(
    movedSpace.tabs.map(\.projectID)
      == [work.id, nil] + Array(repeating: nil, count: untouchedTabs.count)
  )
  #expect(movedSpace.tabs.map(\.isPinned) == [true, false] + untouchedTabs.map(\.isPinned))
  return CLIProjectTabsE2E(
    created: tab,
    untouchedTabIDs: untouchedTabs.map(\.id),
    untouchedPinStates: untouchedTabs.map(\.isPinned)
  )
}

private func exerciseProjectRemoval(
  _ projects: CLIProjectsE2E,
  tabs: CLIProjectTabsE2E,
  app: SupatermE2EApp,
  space: TestSpace,
  runner: SPBinaryRunner
) throws {
  let removedEmpty: SupatermRemoveProjectResult = try runSPJSON(
    ["project", "remove", projects.later.id.uuidString],
    app: app,
    runner: runner,
    cwd: space.directory
  )
  #expect(removedEmpty.removedProjectID == projects.later.id)
  #expect(removedEmpty.removedTabIDs.isEmpty)
  let removed: SupatermRemoveProjectResult = try runSPJSON(
    ["project", "remove", projects.work.id.uuidString, "--yes"],
    app: app,
    runner: runner,
    cwd: space.directory
  )
  #expect(removed.removedProjectID == projects.work.id)
  #expect(removed.removedTabIDs == [space.tab.tabID])
  let finalTree = try app.send(.tree(), as: SupatermTreeSnapshot.self)
  let finalSpace = try #require(
    finalTree.windows.flatMap(\.spaces).first { $0.id == space.spaceID }
  )
  #expect(finalTree.projects.isEmpty)
  #expect(finalSpace.tabs.map(\.id) == [tabs.created.tabID] + tabs.untouchedTabIDs)
  #expect(finalSpace.tabs.allSatisfy { $0.projectID == nil })
  #expect(finalSpace.tabs.map(\.isPinned) == [false] + tabs.untouchedPinStates)
}

private func runSPJSON<Result: Decodable>(
  _ arguments: [String],
  app: SupatermE2EApp,
  runner: SPBinaryRunner,
  cwd: URL
) throws -> Result {
  try decodeSPJSON(
    Result.self,
    from: try requireSuccessfulSPResult(
      try runner.run(arguments + ["--socket", app.socketPath, "--json"], cwd: cwd)
    )
  )
}

private func exerciseSpaceCommands(
  app: SupatermE2EApp,
  space: TestSpace,
  runner: SPBinaryRunner
) async throws -> CLISpaceE2E {
  try exerciseSpaceCreationAndListing(app: app, space: space, runner: runner)

  let created = try decodeSPJSON(
    SupatermCreateSpaceResult.self,
    from: try requireSuccessfulSPResult(
      try runner.run(
        [
          "space", "new", "--socket", app.socketPath, "--json",
          "cli-space-\(space.token)",
        ],
        cwd: space.directory
      )
    )
  )
  #expect(created.isSelectedSpace)
  let createdRunner = SPBinaryRunner(app: app, tabID: created.tabID, paneID: created.paneID)
  try await app.waitForShellOutput(SupatermPaneTargetRequest(paneID: created.paneID))

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

  let duplicateRename = try requireFailedSPResult(
    try createdRunner.run(
      [
        "space", "rename", "e2e-\(space.token)", created.target.spaceID.uuidString,
        "--socket", app.socketPath, "--plain",
      ],
      cwd: space.directory
    )
  )
  #expect(duplicateRename.stderr.contains("already in use"))
  let afterDuplicateRename = try app.send(.tree(), as: SupatermTreeSnapshot.self)
  #expect(
    afterDuplicateRename.windows.flatMap(\.spaces)
      .first { $0.id == created.target.spaceID }?.name == "renamed-\(space.token)"
  )

  let focusedBase = try decodeSPJSON(
    SupatermSelectSpaceResult.self,
    from: try requireSuccessfulSPResult(
      try createdRunner.run(
        [
          "space", "focus", "--socket", app.socketPath, "--json",
          try listedRef(
            .space,
            id: space.spaceID,
            app: app,
            runner: createdRunner,
            cwd: space.directory
          ),
        ],
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

private func exerciseSpaceCreationAndListing(
  app: SupatermE2EApp,
  space: TestSpace,
  runner: SPBinaryRunner
) throws {
  let backgroundName = "background-\(space.token)"
  let background: SupatermCreateSpaceResult = try runSPJSON(
    ["space", "new", backgroundName],
    app: app,
    runner: runner,
    cwd: space.directory
  )
  #expect(background.isSelectedSpace)
  #expect(background.isSelectedTab)
  let backgroundTree = try app.send(.tree(), as: SupatermTreeSnapshot.self)
  let backgroundWindow = try #require(
    backgroundTree.windows.first { $0.displayedSpaceID == background.target.spaceID }
  )
  let backgroundSpace = try #require(
    backgroundWindow.spaces.first { $0.id == background.target.spaceID }
  )
  #expect(backgroundSpace.isWarm)
  #expect(backgroundSpace.flattenedTabs.count == 1)
  let listed = try requireSuccessfulSPResult(
    try runner.run(
      ["space", "ls", "--socket", app.socketPath, "--plain"],
      cwd: space.directory
    )
  )
  #expect(listed.stdout.contains(background.target.spaceID.uuidString.lowercased()))
  #expect(listed.stdout.contains("displayed"))
  let duplicateCreate = try requireFailedSPResult(
    try runner.run(
      ["space", "new", backgroundName, "--socket", app.socketPath, "--plain"],
      cwd: space.directory
    )
  )
  #expect(duplicateCreate.stderr.contains("already in use"))
  _ =
    try runSPJSON(
      ["space", "destroy", "--yes", background.target.spaceID.uuidString],
      app: app,
      runner: runner,
      cwd: space.directory
    ) as SupatermCloseSpaceResult
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
          "--cwd", space.directory.path, "--in", cliSpace.result.target.spaceID.uuidString,
          "--",
        ] + hermeticShellArguments,
        cwd: space.directory
      )
    )
  )
  try await app.waitForShellPrompt(SupatermPaneTargetRequest(paneID: created.paneID))
  let runner = SPBinaryRunner(app: app, tabID: created.tabID, paneID: created.paneID)
  let tabRef = try listedRef(
    .tab,
    id: created.tabID,
    app: app,
    runner: runner,
    cwd: space.directory
  )

  let renamed = try decodeSPJSON(
    SupatermRenameTabResult.self,
    from: try requireSuccessfulSPResult(
      try runner.run(
        [
          "tab", "rename", "--socket", app.socketPath, "--json",
          "cli-tab-\(space.token)", tabRef,
        ],
        cwd: space.directory
      )
    )
  )
  #expect(renamed.isTitleLocked)
  #expect(renamed.target.title == "cli-tab-\(space.token)")

  let title = try requireSuccessfulSPResult(
    try runner.run(
      ["tab", "title", "--socket", app.socketPath, "--plain"],
      cwd: space.directory
    )
  )
  #expect(title.stdout == "cli-tab-\(space.token)\n")

  let cleared = try decodeSPJSON(
    SupatermRenameTabResult.self,
    from: try requireSuccessfulSPResult(
      try runner.run(
        ["tab", "rename", "--socket", app.socketPath, "--json", "", tabRef],
        cwd: space.directory
      )
    )
  )
  #expect(!cleared.isTitleLocked)

  let pinned = try decodeSPJSON(
    SupatermPinTabResult.self,
    from: try requireSuccessfulSPResult(
      try runner.run(
        ["tab", "pin", "--socket", app.socketPath, "--json", created.tabID.uuidString],
        cwd: space.directory)
    )
  )
  #expect(pinned.isPinned)

  let unpinned = try decodeSPJSON(
    SupatermPinTabResult.self,
    from: try requireSuccessfulSPResult(
      try runner.run(
        ["tab", "unpin", "--socket", app.socketPath, "--json", created.tabID.uuidString],
        cwd: space.directory)
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
        [
          "tab", command, "--socket", app.socketPath, "--plain",
          cliSpace.result.target.spaceID.uuidString,
        ],
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
          "--layout", "keep", "--",
        ] + hermeticShellArguments,
        cwd: space.directory
      )
    )
  )
  #expect(split.direction == .right)
  try await app.waitForShellPrompt(SupatermPaneTargetRequest(paneID: split.paneID))
  try await exercisePaneIO(app: app, space: space, cliTab: cliTab)
  try await closeCLIResources(
    app: app, space: space, cliSpace: cliSpace, cliTab: cliTab, splitPaneID: split.paneID)
}

private func exercisePaneIO(
  app: SupatermE2EApp,
  space: TestSpace,
  cliTab: CLITabE2E
) async throws {
  let created = cliTab.result
  let paneRef = try listedRef(
    .pane,
    id: created.paneID,
    app: app,
    runner: cliTab.runner,
    cwd: space.directory
  )
  let focusedPane = try decodeSPJSON(
    SupatermFocusPaneResult.self,
    from: try requireSuccessfulSPResult(
      try cliTab.runner.run(
        ["pane", "focus", "--socket", app.socketPath, "--json", paneRef],
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
        paneRef, "printf '\(marker)\\n'",
      ],
      cwd: space.directory
    )
  )
  try await app.waitForCapture(SupatermPaneTargetRequest(paneID: created.paneID), contains: marker)

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
    SupatermPaneTargetRequest(paneID: created.paneID),
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
        ["pane", "health", "--socket", app.socketPath, "--json", created.paneID.uuidString],
        cwd: space.directory)
    )
  )
  #expect(health.isReady)

  _ = try requireSuccessfulSPResult(
    try cliTab.runner.run(
      [
        "pane", "wait-ready", "--socket", app.socketPath, "--plain", created.paneID.uuidString,
        "--timeout", "5",
      ],
      cwd: space.directory
    )
  )
  _ = try requireSuccessfulSPResult(
    try cliTab.runner.run(
      [
        "pane", "resize", "--socket", app.socketPath, "--plain", "right", "1",
        created.paneID.uuidString,
      ],
      cwd: space.directory
    )
  )
  for layout in ["equalize", "tile", "main-vertical"] {
    _ = try requireSuccessfulSPResult(
      try cliTab.runner.run(
        [
          "pane", "layout", "--socket", app.socketPath, "--plain", layout, created.tabID.uuidString,
        ],
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
      ["pane", "capture", "--socket", app.socketPath, "--lines", "0", created.paneID.uuidString],
      cwd: space.directory)
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
      ["pane", "close", "--socket", app.socketPath, "--json", splitPaneID.uuidString],
      cwd: space.directory)
  )
  _ = try requireSuccessfulSPResult(
    try cliTab.runner.run(
      ["tab", "close", "--socket", app.socketPath, "--json", cliTab.result.tabID.uuidString],
      cwd: space.directory)
  )
  _ = try requireSuccessfulSPResult(
    try cliSpace.runner.run(
      [
        "space", "destroy", "--socket", app.socketPath, "--json", "-y",
        cliSpace.result.target.spaceID.uuidString,
      ],
      cwd: space.directory)
  )
  try await app.waitForDebugSnapshot("CLI-created space closes") { snapshot in
    !snapshot.windows.flatMap(\.spaces).contains { $0.id == cliSpace.result.target.spaceID }
  }
}

private let parentHelpCommands = [
  ["project"],
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

private struct ListSnapshot: Decodable {
  enum Kind: String, Decodable {
    case space
    case tab
    case pane
  }

  struct Current: Decodable {
    let spaceID: UUID
    let tabID: UUID
    let paneID: UUID?
  }

  struct Item: Decodable {
    let kind: Kind
    let id: UUID
    let parentID: UUID?
    let cwd: String?
  }

  let revision: String
  let current: Current?
  let items: [Item]
}

private func jsonObject(from output: String) throws -> [String: Any] {
  let data = try #require(output.data(using: .utf8))
  let value = try JSONSerialization.jsonObject(with: data)
  guard let object = value as? [String: Any] else {
    throw SupatermE2EError("Expected JSON object.")
  }
  return object
}

private func listedRef(
  _ kind: ListSnapshot.Kind,
  id: UUID,
  app: SupatermE2EApp,
  runner: SPBinaryRunner,
  cwd: URL
) throws -> String {
  let list = try requireSuccessfulSPResult(
    try runner.run(["ls", "--socket", app.socketPath, "--plain"], cwd: cwd)
  )
  return try listedRef(kind, id: id, output: list.stdout)
}

private func listedRef(
  _ kind: ListSnapshot.Kind,
  id: UUID,
  output: String
) throws -> String {
  let canonicalID = id.uuidString.replacingOccurrences(of: "-", with: "").lowercased()
  for line in output.split(whereSeparator: \.isNewline) {
    let columns = line.split(separator: "\t", omittingEmptySubsequences: false)
    guard columns.count == 11 else {
      throw SupatermE2EError("Expected eleven plain list columns.")
    }
    guard columns[1] == Substring(kind.rawValue) else { continue }
    let reference = String(columns[0])
    let prefix =
      switch kind {
      case .space: "s:"
      case .tab: "t:"
      case .pane: "p:"
      }
    guard reference.hasPrefix(prefix) else {
      throw SupatermE2EError("Expected a typed \(kind.rawValue) ref, got \(reference).")
    }
    let body = reference.dropFirst(prefix.count)
    guard (8...32).contains(body.count) else {
      throw SupatermE2EError("Expected a typed \(kind.rawValue) ref, got \(reference).")
    }
    if canonicalID.hasPrefix(body) {
      return reference
    }
  }
  throw SupatermE2EError("Expected a listed ref for \(id.uuidString.lowercased()).")
}

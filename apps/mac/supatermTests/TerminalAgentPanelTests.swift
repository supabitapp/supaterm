import Darwin
import Foundation
import Testing

@testable import SupatermCLIShared
@testable import SupatermSupport
@testable import supaterm

struct TerminalAgentPanelTests {
  enum InheritedSurfaceKind: CaseIterable {
    case tab
    case split
  }

  @Test
  @MainActor
  func restoredAgentStateRequiresCurrentProcessIdentityAndPreservesForegroundPlan() throws {
    let host = TerminalHostState.test(managesTerminalSurfaces: false)
    let surfaceID = UUID()
    let identity = try #require(TerminalAgentProcessInspector.identity(for: getpid()))
    let plan = PaneAgentProgressRow(id: "plan-1", title: "Implement", status: .running)

    host.restoreAgentState(
      [
        TerminalPaneAgentRecord(
          agent: .codex,
          sessionID: "background",
          processes: [identity],
          turnLifecycle: .active("turn-1"),
          phase: .running,
          isForeground: false,
          revision: 4
        ),
        TerminalPaneAgentRecord(
          agent: .codex,
          sessionID: "foreground",
          processes: [identity],
          turnLifecycle: .active("turn-2"),
          phase: .running,
          progressRows: [plan],
          isForeground: true,
          revision: 9
        ),
      ],
      for: surfaceID
    )

    let snapshots = host.agentStateStore.snapshots(for: surfaceID)
    let foreground = try #require(
      snapshots.first(where: { $0.sessionID == "foreground" })
    )
    #expect(snapshots.count == 2)
    #expect(host.agentStateStore.foregroundSessionID(for: surfaceID, agent: .codex) == "foreground")
    #expect(foreground.progressRows == [plan])
    #expect(foreground.turnLifecycle == .active("turn-2"))
    #expect(!foreground.isActionable)
  }

  @Test
  @MainActor
  func restoredAgentStateRejectsReusedProcessID() throws {
    let host = TerminalHostState.test(managesTerminalSurfaces: false)
    let surfaceID = UUID()
    let identity = try #require(TerminalAgentProcessInspector.identity(for: getpid()))
    let staleIdentity = TerminalAgentProcessIdentity(
      processID: identity.processID,
      startTimeMicroseconds: identity.startTimeMicroseconds + 1
    )

    host.restoreAgentState(
      [
        TerminalPaneAgentRecord(
          agent: .codex,
          sessionID: "stale",
          processes: [staleIdentity],
          isForeground: true,
          revision: 1
        )
      ],
      for: surfaceID
    )

    #expect(host.agentStateStore.snapshots(for: surfaceID).isEmpty)
  }

  @Test
  func workspaceKeyNormalizesEquivalentPaths() {
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString, directoryHint: .isDirectory)
    let path = root.appending(path: "child/..", directoryHint: .isDirectory).path(percentEncoded: false)

    #expect(
      TerminalAgentPanelWorkspaceKey(workingDirectoryPath: " \(path) ")?
        .workingDirectoryPath == SupatermWorkingDirectory.normalizedPath(root.standardizedFileURL)
    )
    #expect(TerminalAgentPanelWorkspaceKey(workingDirectoryPath: " ") == nil)
  }

  @Test
  func commandRunnerDrainsConcurrentSubprocessOutput() async throws {
    let runner = TerminalAgentPanelCommandRunner.live
    let byteCount = 256 * 1_024
    let command =
      "/usr/bin/head -c \(byteCount) /dev/zero; /usr/bin/head -c \(byteCount) /dev/zero >&2"

    let results = try await withThrowingTaskGroup(
      of: TerminalAgentPanelCommandResult.self,
      returning: [TerminalAgentPanelCommandResult].self
    ) { group in
      for _ in 0..<24 {
        group.addTask {
          try await runner.run(
            URL(fileURLWithPath: "/bin/sh"),
            ["-c", command],
            nil
          )
        }
      }
      var results: [TerminalAgentPanelCommandResult] = []
      for try await result in group {
        results.append(result)
      }
      return results
    }

    #expect(results.count == 24)
    #expect(results.allSatisfy { $0.status == 0 })
    #expect(results.allSatisfy { $0.stdout.utf8.count == byteCount })
    #expect(results.allSatisfy { $0.stderr.utf8.count == byteCount })
  }

  @Test(arguments: InheritedSurfaceKind.allCases)
  @MainActor
  func newTabsAndSplitsInheritAgentWorkspace(kind: InheritedSurfaceKind) throws {
    initializeGhosttyForTests()

    let root = FileManager.default.temporaryDirectory.appending(
      path: UUID().uuidString,
      directoryHint: .isDirectory
    )
    let paneDirectory = root.appending(path: "pane", directoryHint: .isDirectory)
    let agentWorkspace = root.appending(path: "agent", directoryHint: .isDirectory)
    for directory in [paneDirectory, agentWorkspace] {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }
    defer { try? FileManager.default.removeItem(at: root) }

    let host = TerminalHostState.test(createsLiveTerminalSurfaces: true)
    host.ensureInitialTab(
      focusing: false,
      workingDirectoryPath: paneDirectory.path(percentEncoded: false)
    )
    let sourceSurface = try #require(host.selectedSurfaceView)
    #expect(
      host.startTestAgentSession(
        agent: .codex,
        for: sourceSurface.id,
        sessionID: "session-1",
        processID: nil,
        workingDirectoryPath: agentWorkspace.path(percentEncoded: false)
      )
    )

    switch kind {
    case .tab:
      #expect(host.createTab(inheritingFromSurfaceID: sourceSurface.id) != nil)
    case .split:
      #expect(host.performSplitAction(.newSplit(direction: .right), for: sourceSurface.id))
    }

    let inheritedSurface = try #require(host.selectedSurfaceView)
    #expect(inheritedSurface !== sourceSurface)
    #expect(
      inheritedSurface.bridge.state.pwd
        == SupatermWorkingDirectory.normalizedPath(
          agentWorkspace.path(percentEncoded: false)
        )
    )
  }

  @Test
  func mainBranchHidesEmptyPullRequestAction() {
    let createStatus = PaneAgentPullRequestStatus.createPullRequest(
      url: URL(string: "https://github.com/supabitapp/supaterm/compare/main?expand=1")!
    )
    let mainBranchDetails = PaneAgentBranchDetails(
      repositoryRootPath: "/repo",
      branchName: "main",
      addedLineCount: 0,
      removedLineCount: 0,
      pullRequestStatus: createStatus
    )
    let featureBranchDetails = PaneAgentBranchDetails(
      repositoryRootPath: "/repo",
      branchName: "khoi/agent-panel",
      addedLineCount: 0,
      removedLineCount: 0,
      pullRequestStatus: createStatus
    )
    let openStatus = PaneAgentPullRequestStatus(
      kind: .open,
      title: "#1",
      url: nil,
      addedLineCount: nil,
      removedLineCount: nil,
      checks: nil
    )
    let mainBranchOpenDetails = PaneAgentBranchDetails(
      repositoryRootPath: "/repo",
      branchName: "main",
      addedLineCount: 0,
      removedLineCount: 0,
      pullRequestStatus: openStatus
    )

    #expect(mainBranchDetails.displayedPullRequestStatus == nil)
    #expect(featureBranchDetails.displayedPullRequestStatus == createStatus)
    #expect(mainBranchOpenDetails.displayedPullRequestStatus == openStatus)
  }

  @Test
  func branchDetailsHideUnavailablePullRequestStatus() {
    let branchDetails = PaneAgentBranchDetails(
      repositoryRootPath: "/repo",
      branchName: "khoi/agent-panel",
      addedLineCount: 0,
      removedLineCount: 0,
      pullRequestStatus: .unavailable
    )

    #expect(branchDetails.displayedPullRequestStatus == nil)
  }

  @Test
  func panelSessionBuildsVisibleForkShellCommands() throws {
    let codex = try #require(
      PaneAgentPanelSession.supported(
        agent: .codex,
        sessionID: "019c7714-3b77-74d1-9866-e1f484aae2ab",
        commandLineArguments: ["codex", "--profile", "work"]
      )
    )
    let claude = try #require(
      PaneAgentPanelSession.supported(
        agent: .claude,
        sessionID: "session_1",
        commandLineArguments: ["claude", "--model", "opus"]
      )
    )
    #expect(
      codex.forkStartupCommand
        == .shell("codex --profile work fork 019c7714-3b77-74d1-9866-e1f484aae2ab")
    )
    #expect(
      claude.forkStartupCommand
        == .shell("claude --model opus --fork-session --resume session_1")
    )
  }

  @Test
  func panelSessionKeepsCodexForkOptionsAndDropsPriorSessionArguments() throws {
    let commandLineArguments = [
      "codex",
      "--search",
      "--config=model=codex-1",
      "resume",
      "--profile",
      "work",
      "old-session",
      "old prompt",
    ]
    let session = try #require(
      PaneAgentPanelSession.supported(
        agent: .codex,
        sessionID: "new-session",
        commandLineArguments: commandLineArguments
      )
    )

    #expect(
      session.forkStartupCommand
        == .shell(
          "codex --search --config=model=codex-1 --profile work fork new-session"
        )
    )
  }

  @Test
  func panelSessionDropsCodexPromptArguments() throws {
    let session = try #require(
      PaneAgentPanelSession.supported(
        agent: .codex,
        sessionID: "session-1",
        commandLineArguments: ["codex", "-pwork", "--no-alt-screen", "old prompt"]
      )
    )

    #expect(
      session.forkStartupCommand
        == .shell("codex -pwork --no-alt-screen fork session-1")
    )
  }

  @Test
  func panelSessionKeepsClaudeOptionsAndDropsPriorSessionArguments() throws {
    let session = try #require(
      PaneAgentPanelSession.supported(
        agent: .claude,
        sessionID: "new-session",
        commandLineArguments: [
          "claude",
          "--permission-mode",
          "plan",
          "--fork-session",
          "--resume",
          "old-session",
          "old prompt",
        ]
      )
    )

    #expect(
      session.forkStartupCommand
        == .shell(
          "claude --permission-mode plan --fork-session --resume new-session"
        )
    )
  }

  @Test
  func panelSessionDropsUnsafeReplayOptions() throws {
    let claude = try #require(
      PaneAgentPanelSession.supported(
        agent: .claude,
        sessionID: "new-session",
        commandLineArguments: [
          "claude",
          "--file",
          "prompt.md",
          "--tmux",
          "classic",
          "--worktree",
          "branch",
          "--model",
          "opus",
        ]
      )
    )
    let codex = try #require(
      PaneAgentPanelSession.supported(
        agent: .codex,
        sessionID: "new-session",
        commandLineArguments: [
          "codex",
          "--image",
          "one.png",
          "two.png",
          "--remote",
          "task-1",
          "--remote-auth-token-env=CODEX_TOKEN",
          "--profile",
          "work",
        ]
      )
    )
    #expect(
      claude.forkStartupCommand
        == .shell("claude --model opus --fork-session --resume new-session")
    )
    #expect(codex.forkStartupCommand == .shell("codex --profile work fork new-session"))
  }

  @Test
  func panelSessionRejectsNonRestorableLaunches() {
    #expect(
      PaneAgentPanelSession.supported(
        agent: .claude,
        sessionID: "new-session",
        commandLineArguments: ["claude", "--print", "prompt"]
      ) == nil
    )
    #expect(
      PaneAgentPanelSession.supported(
        agent: .codex,
        sessionID: "new-session",
        commandLineArguments: ["codex", "exec", "make", "test"]
      ) == nil
    )
    #expect(PaneAgentPanelSession.supported(agent: .pi, sessionID: "new-session") == nil)
  }

  @Test
  func panelSessionKeepsTrailingAndMultiValueOptions() throws {
    let claude = try #require(
      PaneAgentPanelSession.supported(
        agent: .claude,
        sessionID: "new-session",
        commandLineArguments: [
          "claude",
          "--allowed-tools",
          "Read",
          "Write",
          "old prompt",
          "--permission-mode",
          "plan",
          "--model",
          "opus",
        ]
      )
    )
    let codex = try #require(
      PaneAgentPanelSession.supported(
        agent: .codex,
        sessionID: "new-session",
        commandLineArguments: [
          "codex",
          "fork",
          "old-session",
          "tag",
          "--profile",
          "work",
          "--sandbox",
          "read-only",
        ]
      )
    )

    #expect(
      claude.forkStartupCommand
        == .shell(
          "claude --allowed-tools Read Write --permission-mode plan --model opus --fork-session --resume new-session"
        )
    )
    #expect(
      codex.forkStartupCommand
        == .shell("codex --profile work --sandbox read-only fork new-session")
    )
  }

  @Test
  func panelSessionTrimsSafeSessionIdentifiers() throws {
    let session = try #require(
      PaneAgentPanelSession.supported(
        agent: .codex,
        sessionID: " \n\tsession-1 \r"
      )
    )

    #expect(session.sessionID == "session-1")
    #expect(session.forkStartupCommand == .shell("codex fork session-1"))
  }

  @Test
  func panelSessionRejectsUnsafeSessionIdentifiers() {
    for sessionID in [
      "",
      " \n\t",
      "session 1",
      "session\n1",
      "session'1",
      "session\"1",
      "$HOME",
      "`id`",
      "session;exit",
      "session|id",
      "session&exit",
      "$(id)",
      "session>file",
      "session<file",
    ] {
      #expect(PaneAgentPanelSession.supported(agent: .codex, sessionID: sessionID) == nil)
      #expect(PaneAgentPanelSession.supported(agent: .claude, sessionID: sessionID) == nil)
      #expect(PaneAgentPanelSession.supported(agent: .pi, sessionID: sessionID) == nil)
    }
  }

  @Test
  @MainActor
  func registeredStateShowsWorkspaceWithoutActivity() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState.test()
    let workingDirectoryPath = FileManager.default.temporaryDirectory.path(percentEncoded: false)
    let surfaceID = try #require(
      restoreSplitHost(
        host,
        workingDirectoryPath: workingDirectoryPath
      )
      .first
    )

    #expect(
      host.startTestAgentSession(
        agent: .pi,
        for: surfaceID,
        sessionID: "session-1",
        processID: nil
      )
    )

    let presentation = try #require(host.agentPanelPresentation(for: surfaceID))
    #expect(
      presentation.workingDirectoryPath
        == SupatermWorkingDirectory.normalizedPath(workingDirectoryPath)
    )
    #expect(presentation.session == nil)
  }

  @Test
  @MainActor
  func terminalOnlyPiDoesNotOverrideManagedSessionActions() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState.test()
    let surfaceID = try #require(
      restoreSplitHost(host, workingDirectoryPath: "/tmp/pane-workspace").first
    )
    #expect(
      host.makeTestAgentSessionActionable(
        agent: .codex,
        for: surfaceID,
        sessionID: "session-1",
        processID: nil,
        workingDirectoryPath: "/tmp/codex-workspace"
      )
    )
    #expect(
      host.applyTestAgentActivity(
        TerminalHostState.AgentActivity(agent: .pi, phase: .running),
        for: surfaceID,
        sessionID: "session-2",
        processID: nil,
        workingDirectoryPath: "/tmp/pi-workspace"
      )
    )

    let presentation = try #require(host.agentPanelPresentation(for: surfaceID))
    #expect(presentation.workingDirectoryPath == "/tmp/codex-workspace")
    #expect(
      presentation.session
        == PaneAgentPanelSession.supported(
          agent: .codex,
          sessionID: "session-1",
          workingDirectoryPath: "/tmp/codex-workspace"
        )
    )
  }

  @Test
  @MainActor
  func runningStateWithoutSessionIsRejected() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState.test()
    let surfaceID = try #require(
      restoreSplitHost(
        host,
        workingDirectoryPath: FileManager.default.temporaryDirectory.path(percentEncoded: false)
      )
      .first
    )

    #expect(
      !host.applyTestAgentActivity(
        TerminalHostState.AgentActivity(agent: .codex, phase: .running),
        for: surfaceID,
        sessionID: nil,
        processID: nil
      )
    )

    #expect(host.agentPanelPresentation(for: surfaceID) == nil)
  }

  @Test
  @MainActor
  func newerSessionIdentityBecomesForeground() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState.test()
    let surfaceID = try #require(
      restoreSplitHost(
        host,
        workingDirectoryPath: FileManager.default.temporaryDirectory.path(percentEncoded: false)
      )
      .first
    )

    #expect(
      host.applyTestAgentActivity(
        TerminalHostState.AgentActivity(agent: .codex, phase: .running, detail: "Previous"),
        for: surfaceID,
        sessionID: "session-0",
        processID: nil
      )
    )
    #expect(
      host.applyTestAgentActivity(
        TerminalHostState.AgentActivity(agent: .codex, phase: .running, detail: "Current"),
        for: surfaceID,
        sessionID: "session-1",
        processID: nil
      )
    )

    let presentation = try #require(host.agentPanelPresentation(for: surfaceID))
    let tabID = try #require(host.selectedTabID)
    #expect(
      presentation.session
        == PaneAgentPanelSession.supported(
          agent: .codex,
          sessionID: "session-1",
          workingDirectoryPath: SupatermWorkingDirectory.normalizedPath(
            FileManager.default.temporaryDirectory
          )
        )
    )
    #expect(
      host.agentActivity(for: tabID)
        == .codex(.running)
    )
  }

  @Test
  @MainActor
  func actionableStateExposesSessionPanelWithoutSnapshot() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState.test()
    let surfaceID = try #require(
      restoreSplitHost(
        host,
        workingDirectoryPath: FileManager.default.temporaryDirectory.path(percentEncoded: false)
      )
      .first
    )

    #expect(
      host.makeTestAgentSessionActionable(
        agent: .codex,
        for: surfaceID,
        sessionID: "session-1",
        processID: nil
      )
    )

    let presentation = try #require(host.agentPanelPresentation(for: surfaceID))
    #expect(
      presentation.session
        == PaneAgentPanelSession.supported(
          agent: .codex,
          sessionID: "session-1",
          workingDirectoryPath: SupatermWorkingDirectory.normalizedPath(
            FileManager.default.temporaryDirectory
          )
        )
    )
    #expect(presentation.progressRows.isEmpty)
  }

  @Test
  @MainActor
  func piStateDoesNotExposeSessionActionsOrProgress() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState.test()
    let surfaceID = try #require(
      restoreSplitHost(
        host,
        workingDirectoryPath: FileManager.default.temporaryDirectory.path(percentEncoded: false)
      )
      .first
    )

    #expect(
      host.applyTestAgentActivity(
        TerminalHostState.AgentActivity(agent: .pi, phase: .running, detail: nil),
        for: surfaceID,
        sessionID: "session-1",
        processID: nil
      )
    )
    #expect(
      host.setTestAgentProgressRows(
        progressRows: [
          PaneAgentProgressRow(id: "run-tests", title: "Run tests", status: .running)
        ],
        for: surfaceID
      )
    )

    let presentation = try #require(host.agentPanelPresentation(for: surfaceID))
    #expect(presentation.session == nil)
    #expect(presentation.progressRows.isEmpty)
  }

}

import ComposableArchitecture
import Darwin
import Foundation
import Sharing
import Testing

@testable import SupatermCLIShared
@testable import supaterm

struct TerminalAgentPanelTests {
  enum InheritedSurfaceKind: CaseIterable {
    case tab
    case split
  }

  @Test
  @MainActor
  func childTitleMatchesCodexLabels() {
    #expect(AgentPanelView.childTitle(child(nickname: "Mendel")) == "Mendel")
    #expect(
      AgentPanelView.childTitle(child(nickname: "Mendel", role: "reviewer"))
        == "Mendel [reviewer]"
    )
    #expect(AgentPanelView.childTitle(child(role: "reviewer")) == "Reviewer")
    #expect(AgentPanelView.childTitle(child()) == "Agent")
  }

  @Test
  @MainActor
  func childDetailFallsBackWhileWaitingForFirstMessage() {
    #expect(AgentPanelView.childDetail(child()) == "Working…")
    #expect(
      AgentPanelView.childDetail(child(task: "Explore UI test infrastructure"))
        == "Explore UI test infrastructure"
    )
    #expect(
      AgentPanelView.childDetail(
        child(
          task: "Explore UI test infrastructure",
          detail: "Tracing persistence failure behavior"
        )
      )
        == "Tracing persistence failure behavior"
    )
  }

  private func child(
    nickname: String? = nil,
    role: String? = nil,
    task: String? = nil,
    detail: String? = nil
  ) -> TerminalAgentActiveChild {
    TerminalAgentActiveChild(
      id: TerminalAgentActiveChild.Identity(
        subagentID: "child-1",
        sessionID: "session-1",
        turnID: "turn-1"
      ),
      nickname: nickname,
      role: role,
      task: task,
      phase: .running,
      detail: detail
    )
  }

  @Test
  @MainActor
  func restoredAgentStateRequiresCurrentProcessIdentityAndPreservesForegroundPlan() throws {
    let host = TerminalHostState(managesTerminalSurfaces: false)
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
          transcriptPath: "/tmp/foreground.jsonl",
          turnLifecycle: .active("turn-2"),
          phase: .running,
          nativePlanRows: [plan],
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
    #expect(foreground.progressRowsBySource[.nativePlan] == [plan])
    #expect(foreground.turnLifecycle == .active("turn-2"))
    #expect(!foreground.isActionable)
  }

  @Test
  @MainActor
  func restoredAgentStateRejectsReusedProcessID() throws {
    let host = TerminalHostState(managesTerminalSurfaces: false)
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
        .workingDirectoryPath == root.path(percentEncoded: false)
    )
    #expect(TerminalAgentPanelWorkspaceKey(workingDirectoryPath: " ") == nil)
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

    let host = TerminalHostState()
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
        == GhosttySurfaceView.normalizedWorkingDirectoryPath(
          agentWorkspace.path(percentEncoded: false)
        )
    )
  }

  @Test
  func mainBranchHidesEmptyPullRequestAction() throws {
    let createStatus = PaneAgentPullRequestStatus.createPullRequest(
      url: try #require(URL(string: "https://github.com/supabitapp/supaterm/compare/main?expand=1"))
    )
    let mainBranchDetails = PaneAgentBranchDetails(
      branchName: "main",
      addedLineCount: 0,
      removedLineCount: 0,
      pullRequestStatus: createStatus
    )
    let featureBranchDetails = PaneAgentBranchDetails(
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
      branchName: "khoi/agent-panel",
      addedLineCount: 0,
      removedLineCount: 0,
      pullRequestStatus: .unavailable
    )

    #expect(branchDetails.displayedPullRequestStatus == nil)
  }

  @Test
  func panelSessionBuildsForkStartupCommands() throws {
    let codex = try #require(PaneAgentPanelSession.supported(agent: .codex, sessionID: "session 1"))
    let claude = try #require(PaneAgentPanelSession.supported(agent: .claude, sessionID: "session-1"))

    #expect(
      codex.forkStartupCommand
        == SupatermShellCommand.interactiveStartupCommand(for: "codex fork 'session 1'")
    )
    #expect(
      claude.forkStartupCommand
        == SupatermShellCommand.interactiveStartupCommand(
          for: "claude --fork-session --resume session-1"
        )
    )
    #expect(PaneAgentPanelSession.supported(agent: .pi, sessionID: "session-1") == nil)
    #expect(PaneAgentPanelSession.supported(agent: .codex, sessionID: " ") == nil)
  }

  @Test
  @MainActor
  func registeredStateShowsWorkspaceWithoutActivity() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
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
    #expect(presentation.workingDirectoryPath == workingDirectoryPath)
    #expect(presentation.session == nil)
  }

  @Test
  @MainActor
  func workspaceDoesNotHideRunningFallbackRow() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    let workingDirectoryPath = FileManager.default.temporaryDirectory.path(percentEncoded: false)
    let surfaceID = try #require(
      restoreSplitHost(host, workingDirectoryPath: workingDirectoryPath).first
    )

    let tabID = try #require(host.tabID(containing: surfaceID))
    #expect(
      host.applyAgentEvent(
        TerminalAgentEvent(
          scope: TerminalAgentEvent.Scope(agent: .codex, sessionID: "session-1"),
          context: SupatermCLIContext(surfaceID: surfaceID, tabID: tabID.rawValue),
          action: .turnRunning(detail: "Inspecting"),
          origin: .transcript
        )
      ).changed
    )
    #expect(
      host.agentPanelPresentation(for: surfaceID)
        == PaneAgentPanelPresentation(
          progressRows: [
            PaneAgentProgressRow(
              id: "agent-session-running",
              title: "Inspecting",
              status: .running
            )
          ],
          workingDirectoryPath: workingDirectoryPath
        )
    )
  }

  @Test
  @MainActor
  func actionableSessionKeepsItsOwnWorkspaceWhenAnotherAgentIsCurrent() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
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
        TerminalHostState.AgentActivity(kind: .pi, phase: .running),
        for: surfaceID,
        sessionID: "session-2",
        processID: nil,
        workingDirectoryPath: "/tmp/pi-workspace"
      )
    )

    let presentation = try #require(host.agentPanelPresentation(for: surfaceID))
    #expect(presentation.workingDirectoryPath == "/tmp/pi-workspace/")
    #expect(
      presentation.session
        == PaneAgentPanelSession.supported(
          agent: .codex,
          sessionID: "session-1",
          workingDirectoryPath: "/tmp/codex-workspace/"
        )
    )
  }

  @Test
  @MainActor
  func runningStateWithoutSessionIsRejected() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    let surfaceID = try #require(
      restoreSplitHost(
        host,
        workingDirectoryPath: FileManager.default.temporaryDirectory.path(percentEncoded: false)
      )
      .first
    )

    #expect(
      !host.applyTestAgentActivity(
        TerminalHostState.AgentActivity(kind: .codex, phase: .running),
        for: surfaceID,
        sessionID: nil,
        processID: nil
      )
    )

    #expect(host.agentPanelPresentation(for: surfaceID) == nil)
  }

  @Test
  @MainActor
  func newerHookSessionBecomesForeground() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    let surfaceID = try #require(
      restoreSplitHost(
        host,
        workingDirectoryPath: FileManager.default.temporaryDirectory.path(percentEncoded: false)
      )
      .first
    )

    #expect(
      host.applyTestAgentActivity(
        TerminalHostState.AgentActivity(kind: .codex, phase: .running, detail: "Previous"),
        for: surfaceID,
        sessionID: "session-0",
        processID: nil
      )
    )
    #expect(
      host.applyTestAgentActivity(
        TerminalHostState.AgentActivity(kind: .codex, phase: .running, detail: "Current"),
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
          workingDirectoryPath: FileManager.default.temporaryDirectory.path(percentEncoded: false)
        )
    )
    #expect(
      host.agentActivity(for: tabID)
        == .codex(.running, detail: "Current")
    )
  }

  @Test
  @MainActor
  func actionableStateExposesSessionPanelWithoutSnapshot() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
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
          workingDirectoryPath: FileManager.default.temporaryDirectory.path(percentEncoded: false)
        )
    )
    #expect(presentation.progressRows.isEmpty)
  }

  @Test
  @MainActor
  func unsupportedActionableStateDoesNotExposeSessionActions() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    let surfaceID = try #require(
      restoreSplitHost(
        host,
        workingDirectoryPath: FileManager.default.temporaryDirectory.path(percentEncoded: false)
      )
      .first
    )

    #expect(
      host.applyTestAgentActivity(
        TerminalHostState.AgentActivity(kind: .pi, phase: .running, detail: nil),
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
    #expect(presentation.progressRows.map(\.title) == ["Run tests"])
  }

  @Test
  @MainActor
  func disabledPanelSkipsWorkspaceRefresh() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.supatermSettings) var supatermSettings = .default
      $supatermSettings.withLock {
        $0.codingAgentsShowPanel = false
      }

      initializeGhosttyForTests()

      let repoRoot = FileManager.default.temporaryDirectory.appending(
        path: UUID().uuidString,
        directoryHint: .isDirectory
      )
      try FileManager.default.createDirectory(at: repoRoot, withIntermediateDirectories: true)
      defer { try? FileManager.default.removeItem(at: repoRoot) }

      let recorder = AgentPanelRefreshRecorder()
      let gitClient = TerminalAgentGitClient { workingDirectoryPath in
        await recorder.recordGit(workingDirectoryPath)
        return TerminalAgentGitSnapshot(
          repoRoot: repoRoot,
          headURL: nil,
          branchName: "main",
          addedLineCount: 1,
          removedLineCount: 1
        )
      }
      let githubClient = TerminalAgentGithubClient { _, branchName in
        await recorder.recordPullRequest(branchName)
        return PaneAgentPullRequestStatus(
          kind: .none,
          title: "",
          url: nil,
          addedLineCount: nil,
          removedLineCount: nil,
          checks: nil
        )
      }
      let host = TerminalHostState()
      let controller = TerminalAgentPanelController(
        terminal: host,
        gitClient: gitClient,
        githubClient: githubClient
      )
      host.agentPanelController = controller
      defer { controller.stop() }

      let surfaceIDs = try restoreSplitHost(
        host,
        workingDirectoryPath: repoRoot.path(percentEncoded: false)
      )
      _ = host.startTestAgentSession(
        agent: .codex,
        for: surfaceIDs[0],
        sessionID: "session-0",
        processID: nil
      )

      controller.surfaceFocused(surfaceIDs[0])
      try? await Task.sleep(for: .milliseconds(300))

      #expect(host.agentPanelPresentation(for: surfaceIDs[0]) == nil)
      #expect(await recorder.gitPaths().isEmpty)
      #expect(await recorder.pullRequestBranches().isEmpty)
    }
  }

  @Test
  @MainActor
  func sharedWorkspaceRefreshFansOutToUnfocusedPane() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let repoRoot = FileManager.default.temporaryDirectory.appending(
        path: UUID().uuidString,
        directoryHint: .isDirectory
      )
      try FileManager.default.createDirectory(at: repoRoot, withIntermediateDirectories: true)
      defer { try? FileManager.default.removeItem(at: repoRoot) }

      let recorder = AgentPanelRefreshRecorder()
      let gitClient = TerminalAgentGitClient { workingDirectoryPath in
        await recorder.recordGit(workingDirectoryPath)
        return TerminalAgentGitSnapshot(
          repoRoot: repoRoot,
          headURL: nil,
          branchName: "main",
          addedLineCount: 12,
          removedLineCount: 3
        )
      }
      let githubClient = TerminalAgentGithubClient { _, branchName in
        await recorder.recordPullRequest(branchName)
        return PaneAgentPullRequestStatus(
          kind: .open,
          title: "#1",
          url: nil,
          addedLineCount: 34,
          removedLineCount: 5,
          checks: nil
        )
      }
      let host = TerminalHostState()
      let controller = TerminalAgentPanelController(
        terminal: host,
        gitClient: gitClient,
        githubClient: githubClient
      )
      host.agentPanelController = controller
      defer { controller.stop() }

      let surfaceIDs = try restoreSplitHost(
        host,
        workingDirectoryPath: repoRoot.path(percentEncoded: false)
      )
      for (index, surfaceID) in surfaceIDs.enumerated() {
        _ = host.startTestAgentSession(
          agent: .codex,
          for: surfaceID,
          sessionID: "session-\(index)",
          processID: nil
        )
      }

      controller.surfaceFocused(surfaceIDs[0])

      #expect(await waitForBranchDetails(host: host, surfaceIDs: surfaceIDs, branchName: "main"))
      let firstDetails = try #require(host.agentPanelPresentation(for: surfaceIDs[0])?.branchDetails)
      let secondDetails = try #require(host.agentPanelPresentation(for: surfaceIDs[1])?.branchDetails)
      #expect(firstDetails == secondDetails)
      #expect(firstDetails.addedLineCount == 34)
      #expect(firstDetails.removedLineCount == 5)
      #expect(await recorder.gitPaths() == [repoRoot.path(percentEncoded: false)])
      #expect(await recorder.pullRequestBranches() == ["main"])
    }
  }

  @Test
  @MainActor
  func agentWorkingDirectoryReplacesStalePanePath() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let root = FileManager.default.temporaryDirectory.appending(
        path: UUID().uuidString,
        directoryHint: .isDirectory
      )
      let paneRoot = root.appending(path: "pane", directoryHint: .isDirectory)
      let agentRoot = root.appending(path: "agent", directoryHint: .isDirectory)
      let nextAgentRoot = root.appending(path: "next-agent", directoryHint: .isDirectory)
      for directory in [paneRoot, agentRoot, nextAgentRoot] {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      }
      defer { try? FileManager.default.removeItem(at: root) }

      let recorder = AgentPanelRefreshRecorder()
      let gitClient = TerminalAgentGitClient { workingDirectoryPath in
        await recorder.recordGit(workingDirectoryPath)
        let repoRoot = URL(fileURLWithPath: workingDirectoryPath, isDirectory: true)
        return TerminalAgentGitSnapshot(
          repoRoot: repoRoot,
          headURL: nil,
          branchName: repoRoot.lastPathComponent,
          addedLineCount: 1,
          removedLineCount: 0
        )
      }
      let githubClient = TerminalAgentGithubClient { _, _ in .unavailable }
      let host = TerminalHostState()
      let surfaceID = try #require(
        restoreSplitHost(
          host,
          workingDirectoryPath: paneRoot.path(percentEncoded: false)
        )
        .first
      )
      let controller = TerminalAgentPanelController(
        terminal: host,
        gitClient: gitClient,
        githubClient: githubClient
      )
      host.agentPanelController = controller
      defer { controller.stop() }

      #expect(
        host.startTestAgentSession(
          agent: .codex,
          for: surfaceID,
          sessionID: "session-1",
          processID: nil,
          workingDirectoryPath: agentRoot.path(percentEncoded: false)
        )
      )
      controller.surfaceFocused(surfaceID)

      #expect(
        await waitForBranchDetails(
          host: host,
          surfaceIDs: [surfaceID],
          branchName: agentRoot.lastPathComponent
        )
      )
      #expect(
        host.agentPanelPresentation(for: surfaceID)?.workingDirectoryPath
          == agentRoot.path(percentEncoded: false)
      )

      #expect(
        host.applyTestAgentActivity(
          .codex(.running),
          for: surfaceID,
          sessionID: "session-1",
          processID: nil,
          workingDirectoryPath: nextAgentRoot.path(percentEncoded: false)
        )
      )
      #expect(host.agentPanelPresentation(for: surfaceID)?.branchDetails == nil)
      #expect(
        host.agentPanelPresentation(for: surfaceID)?.workingDirectoryPath
          == nextAgentRoot.path(percentEncoded: false)
      )
      #expect(
        await waitForBranchDetails(
          host: host,
          surfaceIDs: [surfaceID],
          branchName: nextAgentRoot.lastPathComponent
        )
      )
      #expect(
        await recorder.gitPaths() == [
          agentRoot.path(percentEncoded: false),
          nextAgentRoot.path(percentEncoded: false),
        ]
      )
    }
  }

  @Test
  @MainActor
  func refreshKeepsPullRequestStatusWhenGithubBecomesUnavailable() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let repoRoot = FileManager.default.temporaryDirectory.appending(
        path: UUID().uuidString,
        directoryHint: .isDirectory
      )
      try FileManager.default.createDirectory(at: repoRoot, withIntermediateDirectories: true)
      defer { try? FileManager.default.removeItem(at: repoRoot) }

      let recorder = AgentPanelRefreshRecorder()
      let statuses = AgentPanelPullRequestStatusSequence([
        PaneAgentPullRequestStatus(
          kind: .open,
          title: "#9",
          url: URL(string: "https://github.com/supabitapp/supaterm/pull/9"),
          addedLineCount: 34,
          removedLineCount: 5,
          checks: nil
        ),
        .unavailable,
      ])
      let gitClient = TerminalAgentGitClient { workingDirectoryPath in
        await recorder.recordGit(workingDirectoryPath)
        return TerminalAgentGitSnapshot(
          repoRoot: repoRoot,
          headURL: nil,
          branchName: "feature/flicker",
          addedLineCount: 12,
          removedLineCount: 3,
          remoteURL: "https://github.com/supabitapp/supaterm.git"
        )
      }
      let githubClient = TerminalAgentGithubClient { _, branchName in
        await recorder.recordPullRequest(branchName)
        return await statuses.next()
      }
      let host = TerminalHostState()
      let surfaceID = try #require(
        restoreSplitHost(
          host,
          workingDirectoryPath: repoRoot.path(percentEncoded: false)
        )
        .first
      )
      _ = host.startTestAgentSession(
        agent: .codex,
        for: surfaceID,
        sessionID: "session-0",
        processID: nil
      )
      let controller = TerminalAgentPanelController(
        terminal: host,
        gitClient: gitClient,
        githubClient: githubClient
      )
      host.agentPanelController = controller
      defer { controller.stop() }

      controller.surfaceFocused(surfaceID)

      #expect(await waitForBranchDetails(host: host, surfaceIDs: [surfaceID], branchName: "feature/flicker"))
      #expect(host.agentPanelPresentation(for: surfaceID)?.branchDetails?.displayedPullRequestStatus?.title == "#9")

      #expect(
        host.setTestAgentProgressRows(
          progressRows: [
            PaneAgentProgressRow(id: "tool-call", title: "Tool call", status: .running)
          ],
          for: surfaceID
        )
      )
      #expect(await waitForPullRequestRefreshes(recorder: recorder, count: 2))
      #expect(
        await waitForBranchDetails(
          host: host,
          surfaceIDs: [surfaceID],
          branchName: "feature/flicker",
          addedLineCount: 12,
          removedLineCount: 3
        )
      )

      let branchDetails = try #require(host.agentPanelPresentation(for: surfaceID)?.branchDetails)
      #expect(branchDetails.displayedPullRequestStatus?.title == "#9")
      #expect(branchDetails.addedLineCount == 12)
      #expect(branchDetails.removedLineCount == 3)
    }
  }

  @Test
  func shortstatParserHandlesInsertionsAndDeletions() {
    #expect(
      TerminalAgentGitClient.parseShortstat(
        " 2 files changed, 2676 insertions(+), 4 deletions(-)\n"
      ) == (added: 2676, removed: 4)
    )
  }

  @Test
  func shortstatParserHandlesEmptyDiff() {
    #expect(TerminalAgentGitClient.parseShortstat("") == (added: 0, removed: 0))
  }

  @Test
  func headResolverHandlesWorktreeGitFile() throws {
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString, directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: root) }
    let worktree = root.appending(path: "worktree", directoryHint: .isDirectory)
    let gitDirectory = root.appending(path: "gitdir", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: worktree, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: gitDirectory, withIntermediateDirectories: true)
    try "gitdir: \(gitDirectory.path(percentEncoded: false))\n".write(
      to: worktree.appending(path: ".git"),
      atomically: true,
      encoding: .utf8
    )

    #expect(
      TerminalAgentGitClient.headURL(for: worktree, fileManager: .default)
        == gitDirectory.appending(path: "HEAD")
    )
  }

  @Test
  func processTreeExpansionIncludesDescendants() {
    let expanded = PaneAgentPortScanner.expandProcessTree(
      rootProcessIDs: [10],
      parentByPID: [
        11: 10,
        12: 11,
        20: 1,
      ]
    )

    #expect(expanded == [10, 11, 12])
  }

  @Test
  func lsofParserExtractsListeningPorts() {
    let ports = PaneAgentPortScanner.ports(
      fromLsofOutput: """
        p10
        n*:5173
        n127.0.0.1:5175
        p12
        n[::1]:8080
        """
    )

    #expect(ports == [10: [5173, 5175], 12: [8080]])
  }

  @Test
  @MainActor
  func portScannerBatchesSurfacesIntoSingleScan() async throws {
    let firstSurfaceID = try #require(UUID(uuidString: "00000000-0000-0000-0000-000000000001"))
    let secondSurfaceID = try #require(UUID(uuidString: "00000000-0000-0000-0000-000000000002"))
    let recorder = AgentPanelCommandRecorder(
      psOutput: """
        10 1
        11 10
        20 1
        21 20
        """,
      lsofOutput: """
        p11
        n*:5173
        p21
        n127.0.0.1:8080
        """
    )
    let scanner = PaneAgentPortScanner(runner: await recorder.runner())
    var deliveries: [(UUID, [String])] = []
    let deliver: PaneAgentPortScanner.Delivery = { surfaceID, artifacts in
      deliveries.append((surfaceID, artifacts.map(\.title)))
    }

    scanner.update(surfaceID: firstSurfaceID, processIDs: [10], deliver: deliver)
    scanner.update(surfaceID: secondSurfaceID, processIDs: [20], deliver: deliver)

    #expect(await scanner.scanOnce())
    #expect(await recorder.commandPaths() == ["/bin/ps", "/usr/sbin/lsof"])
    #expect(await recorder.arguments(for: "/usr/sbin/lsof").first?.contains("10,11,20,21") == true)
    #expect(deliveries.count == 2)
    #expect(deliveries[0].0 == firstSurfaceID)
    #expect(deliveries[0].1 == ["localhost:5173"])
    #expect(deliveries[1].0 == secondSurfaceID)
    #expect(deliveries[1].1 == ["localhost:8080"])
  }

  @Test
  @MainActor
  func portScannerDeliversOnlyChangedArtifacts() async throws {
    let surfaceID = try #require(UUID(uuidString: "00000000-0000-0000-0000-000000000010"))
    let recorder = AgentPanelCommandRecorder(
      psOutput: """
        10 1
        11 10
        """,
      lsofOutput: """
        p11
        n*:5173
        """
    )
    let scanner = PaneAgentPortScanner(runner: await recorder.runner())
    var deliveries: [[String]] = []
    let deliver: PaneAgentPortScanner.Delivery = { _, artifacts in
      deliveries.append(artifacts.map(\.title))
    }

    scanner.update(surfaceID: surfaceID, processIDs: [10], deliver: deliver)

    #expect(await scanner.scanOnce())
    #expect(await scanner.scanOnce() == false)

    scanner.update(surfaceID: surfaceID, processIDs: [10], deliver: deliver)

    #expect(await scanner.scanOnce() == false)

    scanner.clear(surfaceID: surfaceID, deliver: deliver)
    scanner.clear(surfaceID: surfaceID, deliver: deliver)

    #expect(deliveries == [["localhost:5173"], []])
  }

  @Test
  @MainActor
  func portScannerRemovesClearedSurfaceFromBatch() async throws {
    let firstSurfaceID = try #require(UUID(uuidString: "00000000-0000-0000-0000-000000000001"))
    let secondSurfaceID = try #require(UUID(uuidString: "00000000-0000-0000-0000-000000000002"))
    let recorder = AgentPanelCommandRecorder(
      psOutput: """
        10 1
        11 10
        20 1
        21 20
        """,
      lsofOutput: """
        p11
        n*:5173
        p21
        n127.0.0.1:8080
        """
    )
    let scanner = PaneAgentPortScanner(runner: await recorder.runner())
    var deliveries: [(UUID, [String])] = []
    let deliver: PaneAgentPortScanner.Delivery = { surfaceID, artifacts in
      deliveries.append((surfaceID, artifacts.map(\.title)))
    }

    scanner.update(surfaceID: firstSurfaceID, processIDs: [10], deliver: deliver)
    scanner.update(surfaceID: secondSurfaceID, processIDs: [20], deliver: deliver)
    await scanner.scanOnce()
    scanner.clear(surfaceID: firstSurfaceID, deliver: deliver)
    await recorder.reset()

    #expect(await scanner.scanOnce() == false)
    #expect(await recorder.arguments(for: "/usr/sbin/lsof").first?.contains("20,21") == true)

    scanner.clear(surfaceID: secondSurfaceID, deliver: deliver)
    await recorder.reset()

    #expect(await scanner.scanOnce() == false)
    #expect(await recorder.commandPaths().isEmpty)
    #expect(deliveries.contains { $0.0 == firstSurfaceID && $0.1.isEmpty })
  }

  @Test
  func githubRemoteParserHandlesCommonRemoteURLs() throws {
    #expect(
      TerminalAgentGithubRemote(remoteURL: "git@github.com:supabitapp/supaterm.git")
        == TerminalAgentGithubRemote(host: "github.com", owner: "supabitapp", repo: "supaterm")
    )
    #expect(
      TerminalAgentGithubRemote(remoteURL: "https://github.com/supabitapp/supaterm.git")
        == TerminalAgentGithubRemote(host: "github.com", owner: "supabitapp", repo: "supaterm")
    )
    #expect(
      TerminalAgentGithubRemote(remoteURL: "ssh://git@github.example.com/supabitapp/supaterm.git")
        == TerminalAgentGithubRemote(
          host: "github.example.com",
          owner: "supabitapp",
          repo: "supaterm"
        )
    )
  }

  @Test
  func githubPullRequestStatusBuildsCreateURLWhenNoPullRequestExists() async {
    let runner = TerminalAgentPanelCommandRunner(
      run: { executableURL, arguments, _ in
        if executableURL.path == "/usr/bin/which" {
          return TerminalAgentPanelCommandResult(status: 0, stdout: "/usr/bin/gh\n")
        }
        if arguments.starts(with: ["api", "graphql"]) {
          return TerminalAgentPanelCommandResult(
            status: 0,
            stdout: """
              {"data":{"repository":{"branch0":{"nodes":[]}}}}
              """
          )
        }
        return TerminalAgentPanelCommandResult(status: 1, stdout: "")
      },
      runLoginCommand: { _, _ in
        TerminalAgentPanelCommandResult(status: 1, stdout: "")
      }
    )
    let client = TerminalAgentGithubClient(
      runner: runner,
      resolver: TerminalAgentGithubExecutableResolver()
    )

    let status = await client.pullRequestStatus(
      repoRoot: URL(fileURLWithPath: "/tmp/repo", isDirectory: true),
      branchName: "khoi/agent-panel",
      remote: TerminalAgentGithubRemote(remoteURL: "git@github.com:supabitapp/supaterm.git")
    )

    #expect(status.kind == .none)
    #expect(status.title == "Create pull request")
    #expect(
      status.url?.absoluteString
        == "https://github.com/supabitapp/supaterm/compare/khoi/agent-panel?expand=1"
    )
  }

  @Test
  func githubPullRequestStatusCoalescesDuplicateRequests() async {
    let recorder = GithubPullRequestCommandRecorder()
    let client = TerminalAgentGithubClient(
      runner: await recorder.runner(),
      resolver: TerminalAgentGithubExecutableResolver(),
      statusBatcher: TerminalAgentGithubStatusBatcher(batchWindow: .milliseconds(10))
    )
    let repoRoot = URL(fileURLWithPath: "/tmp/repo", isDirectory: true)

    async let first = client.pullRequestStatus(
      repoRoot: repoRoot,
      branchName: "khoi/agent-panel",
      remote: TerminalAgentGithubRemote(remoteURL: "https://github.com/supabitapp/supaterm.git")
    )
    async let second = client.pullRequestStatus(
      repoRoot: repoRoot,
      branchName: "khoi/agent-panel",
      remote: TerminalAgentGithubRemote(remoteURL: "https://github.com/supabitapp/supaterm.git")
    )

    #expect(await first.kind == .open)
    #expect(await second.kind == .open)
    #expect(await recorder.graphqlCallCount() == 1)

    let fresh = await client.pullRequestStatus(
      repoRoot: repoRoot,
      branchName: "khoi/agent-panel",
      remote: TerminalAgentGithubRemote(remoteURL: "https://github.com/supabitapp/supaterm.git")
    )

    #expect(fresh.kind == .open)
    #expect(await recorder.graphqlCallCount() == 2)
  }

  @Test
  func githubPullRequestStatusBatchesBranchesByRemote() async {
    let recorder = GithubPullRequestCommandRecorder(
      pullRequestNumbersByBranch: [
        "feature/a": 101,
        "feature/b": 102,
        "feature/c": 103,
      ]
    )
    let client = TerminalAgentGithubClient(
      runner: await recorder.runner(),
      resolver: TerminalAgentGithubExecutableResolver(),
      statusBatcher: TerminalAgentGithubStatusBatcher(batchWindow: .milliseconds(10))
    )
    let repoRoot = URL(fileURLWithPath: "/tmp/repo", isDirectory: true)

    async let first = client.pullRequestStatus(
      repoRoot: repoRoot,
      branchName: "feature/a",
      remote: TerminalAgentGithubRemote(remoteURL: "https://github.com/supabitapp/supaterm.git")
    )
    async let second = client.pullRequestStatus(
      repoRoot: repoRoot,
      branchName: "feature/b",
      remote: TerminalAgentGithubRemote(remoteURL: "https://github.com/supabitapp/supaterm.git")
    )
    async let third = client.pullRequestStatus(
      repoRoot: repoRoot,
      branchName: "feature/c",
      remote: TerminalAgentGithubRemote(remoteURL: "https://github.com/supabitapp/supaterm.git")
    )

    #expect(await first.title == "#101")
    #expect(await second.title == "#102")
    #expect(await third.title == "#103")
    #expect(await recorder.graphqlCallCount() == 1)
    #expect(await recorder.graphqlBranchNamesByCall() == [["feature/a", "feature/b", "feature/c"]])
  }

  @Test
  func githubPullRequestStatusChunksBatchedBranches() async {
    let branches = (1...6).map { "feature/\($0)" }
    let recorder = GithubPullRequestCommandRecorder(
      pullRequestNumbersByBranch: Dictionary(
        uniqueKeysWithValues: branches.enumerated().map { index, branch in
          (branch, index + 1)
        }
      )
    )
    let client = TerminalAgentGithubClient(
      runner: await recorder.runner(),
      resolver: TerminalAgentGithubExecutableResolver(),
      statusBatcher: TerminalAgentGithubStatusBatcher(batchWindow: .milliseconds(10))
    )
    let repoRoot = URL(fileURLWithPath: "/tmp/repo", isDirectory: true)

    async let first = client.pullRequestStatus(
      repoRoot: repoRoot,
      branchName: branches[0],
      remote: TerminalAgentGithubRemote(remoteURL: "https://github.com/supabitapp/supaterm.git")
    )
    async let second = client.pullRequestStatus(
      repoRoot: repoRoot,
      branchName: branches[1],
      remote: TerminalAgentGithubRemote(remoteURL: "https://github.com/supabitapp/supaterm.git")
    )
    async let third = client.pullRequestStatus(
      repoRoot: repoRoot,
      branchName: branches[2],
      remote: TerminalAgentGithubRemote(remoteURL: "https://github.com/supabitapp/supaterm.git")
    )
    async let fourth = client.pullRequestStatus(
      repoRoot: repoRoot,
      branchName: branches[3],
      remote: TerminalAgentGithubRemote(remoteURL: "https://github.com/supabitapp/supaterm.git")
    )
    async let fifth = client.pullRequestStatus(
      repoRoot: repoRoot,
      branchName: branches[4],
      remote: TerminalAgentGithubRemote(remoteURL: "https://github.com/supabitapp/supaterm.git")
    )
    async let sixth = client.pullRequestStatus(
      repoRoot: repoRoot,
      branchName: branches[5],
      remote: TerminalAgentGithubRemote(remoteURL: "https://github.com/supabitapp/supaterm.git")
    )

    _ = await (first, second, third, fourth, fifth, sixth)

    #expect(await recorder.graphqlCallCount() == 2)
    #expect(await recorder.graphqlBranchNamesByCall().map(\.count).sorted() == [1, 5])
  }

  @Test
  func githubPullRequestStatusDoesNotBatchDifferentRemotes() async {
    let recorder = GithubPullRequestCommandRecorder(
      pullRequestNumbersByBranch: [
        "feature/a": 101,
        "feature/b": 102,
      ]
    )
    let client = TerminalAgentGithubClient(
      runner: await recorder.runner(),
      resolver: TerminalAgentGithubExecutableResolver(),
      statusBatcher: TerminalAgentGithubStatusBatcher(batchWindow: .milliseconds(10))
    )
    let repoRoot = URL(fileURLWithPath: "/tmp/repo", isDirectory: true)

    async let first = client.pullRequestStatus(
      repoRoot: repoRoot,
      branchName: "feature/a",
      remote: TerminalAgentGithubRemote(remoteURL: "https://github.com/supabitapp/supaterm.git")
    )
    async let second = client.pullRequestStatus(
      repoRoot: repoRoot,
      branchName: "feature/b",
      remote: TerminalAgentGithubRemote(remoteURL: "https://github.example.com/supabitapp/supaterm.git")
    )

    #expect(await first.title == "#101")
    #expect(await second.title == "#102")
    #expect(await recorder.graphqlCallCount() == 2)
    #expect(await recorder.graphqlHosts().sorted() == ["github.com", "github.example.com"])
  }

  @Test
  func githubPullRequestStatusBuildsCreateURLWhenBatchedBranchIsMissing() async {
    let recorder = GithubPullRequestCommandRecorder(pullRequestNumbersByBranch: [:])
    let client = TerminalAgentGithubClient(
      runner: await recorder.runner(),
      resolver: TerminalAgentGithubExecutableResolver(),
      statusBatcher: TerminalAgentGithubStatusBatcher(batchWindow: .milliseconds(10))
    )

    let status = await client.pullRequestStatus(
      repoRoot: URL(fileURLWithPath: "/tmp/repo", isDirectory: true),
      branchName: "feature/missing",
      remote: TerminalAgentGithubRemote(remoteURL: "https://github.com/supabitapp/supaterm.git")
    )

    #expect(status.kind == .none)
    #expect(status.title == "Create pull request")
    #expect(
      status.url?.absoluteString
        == "https://github.com/supabitapp/supaterm/compare/feature/missing?expand=1"
    )
  }

  @Test
  func githubPullRequestStatusRetriesGatewayTimeoutOnce() async {
    let recorder = GithubPullRequestCommandRecorder(
      pullRequestNumbersByBranch: ["feature/retry": 104],
      gatewayTimeoutsRemaining: 1
    )
    let client = TerminalAgentGithubClient(
      runner: await recorder.runner(),
      resolver: TerminalAgentGithubExecutableResolver(),
      statusBatcher: TerminalAgentGithubStatusBatcher(batchWindow: .milliseconds(10))
    )

    let status = await client.pullRequestStatus(
      repoRoot: URL(fileURLWithPath: "/tmp/repo", isDirectory: true),
      branchName: "feature/retry",
      remote: TerminalAgentGithubRemote(remoteURL: "https://github.com/supabitapp/supaterm.git")
    )

    #expect(status.title == "#104")
    #expect(await recorder.graphqlCallCount() == 2)
  }

  @Test
  func githubPullRequestDecoderKeepsGoodBranchesWhenOneAliasIsNull() {
    let statuses = TerminalAgentGithubClient.decodePullRequestStatuses(
      """
      {
        "data": {
          "repository": {
            "branch0": {
              "nodes": [
                {
                  "number": 39,
                  "additions": 10,
                  "deletions": 2,
                  "state": "OPEN",
                  "isDraft": false,
                  "url": "https://github.com/supabitapp/supaterm/pull/39",
                  "baseRefName": "main",
                  "headRepository": {
                    "name": "supaterm",
                    "owner": { "login": "supabitapp" }
                  },
                  "commits": {"nodes": []}
                }
              ]
            },
            "branch1": null
          }
        }
      }
      """,
      aliasMap: ["branch0": "feature/a", "branch1": "feature/b"],
      remote: TerminalAgentGithubRemote(
        host: "github.com",
        owner: "supabitapp",
        repo: "supaterm"
      )
    )

    #expect(statuses["feature/a"]?.kind == .open)
    #expect(statuses["feature/a"]?.title == "#39")
    #expect(statuses["feature/b"]?.kind == PaneAgentPullRequestStatus.Kind.none)
    #expect(statuses["feature/b"]?.title == "Create pull request")
    #expect(
      statuses["feature/b"]?.url?.absoluteString
        == "https://github.com/supabitapp/supaterm/compare/feature/b?expand=1"
    )
  }

  @Test
  func githubPullRequestDecoderIgnoresForkPullRequestTargetingCurrentBranch() {
    let statuses = TerminalAgentGithubClient.decodePullRequestStatuses(
      """
      {
        "data": {
          "repository": {
            "branch0": {
              "nodes": [
                {
                  "number": 538,
                  "additions": 1,
                  "deletions": 0,
                  "state": "MERGED",
                  "isDraft": false,
                  "url": "https://github.com/NoopApp/noop/pull/538",
                  "baseRefName": "main",
                  "headRepository": {
                    "name": "noop",
                    "owner": { "login": "ahmedelfayoume" }
                  },
                  "commits": {"nodes": []}
                }
              ]
            }
          }
        }
      }
      """,
      aliasMap: ["branch0": "main"],
      remote: TerminalAgentGithubRemote(
        host: "github.com",
        owner: "NoopApp",
        repo: "noop"
      )
    )

    #expect(statuses["main"]?.kind == PaneAgentPullRequestStatus.Kind.none)
    #expect(statuses["main"]?.title == "Create pull request")
  }

  @Test
  func githubPullRequestDecoderUsesNumberChangesAndChecks() throws {
    let status = Self.decodeSinglePullRequestStatus(
      """
      {
        "data": {
          "repository": {
            "branch0": {
              "nodes": [
                {
                  "number": 39,
                  "additions": 3040,
                  "deletions": 29,
                  "state": "OPEN",
                  "isDraft": false,
                  "url": "https://github.com/supabitapp/supaterm/pull/39",
                  "baseRefName": "main",
                  "headRepository": {
                    "name": "supaterm",
                    "owner": { "login": "supabitapp" }
                  },
                  "commits": {
                    "nodes": [
                      {
                        "commit": {
                          "statusCheckRollup": {
                            "state": "PENDING",
                            "contexts": {
                              "totalCount": 2,
                              "nodes": [
                                {
                                  "__typename": "CheckRun",
                                  "name": "inspect-dependencies",
                                  "status": "COMPLETED",
                                  "conclusion": "SUCCESS"
                                },
                                {
                                  "__typename": "StatusContext",
                                  "context": "test",
                                  "state": "PENDING"
                                }
                              ]
                            }
                          }
                        }
                      }
                    ]
                  }
                }
              ]
            }
          }
        }
      }
      """
    )

    #expect(status.kind == .open)
    #expect(status.title == "#39")
    #expect(status.addedLineCount == 3040)
    #expect(status.removedLineCount == 29)
    #expect(
      status.checks
        == PaneAgentPullRequestChecks(
          status: .pending,
          totalCount: 2,
          items: [
            PaneAgentPullRequestCheck(name: "inspect-dependencies", status: .passing),
            PaneAgentPullRequestCheck(name: "test", status: .pending),
          ]
        )
    )
    #expect(status.checks?.title == "Checks pending (2)")
  }

  @Test
  func githubPullRequestDecoderBuildsCheckDisplayText() throws {
    let status = Self.decodeSinglePullRequestStatus(
      """
      {
        "data": {
          "repository": {
            "branch0": {
              "nodes": [
                {
                  "number": 40,
                  "additions": 12,
                  "deletions": 3,
                  "state": "OPEN",
                  "isDraft": false,
                  "url": "https://github.com/supabitapp/supaterm/pull/40",
                  "baseRefName": "main",
                  "headRepository": {
                    "name": "supaterm",
                    "owner": { "login": "supabitapp" }
                  },
                  "commits": {
                    "nodes": [
                      {
                        "commit": {
                          "statusCheckRollup": {
                            "state": "PENDING",
                            "contexts": {
                              "totalCount": 3,
                              "nodes": [
                                {
                                  "__typename": "CheckRun",
                                  "name": "test",
                                  "status": "IN_PROGRESS",
                                  "conclusion": null,
                                  "startedAt": "2026-05-17T14:10:22Z",
                                  "completedAt": null,
                                  "checkSuite": {
                                    "workflowRun": {
                                      "workflow": {
                                        "name": "test"
                                      }
                                    }
                                  }
                                },
                                {
                                  "__typename": "CheckRun",
                                  "name": "inspect-dependencies",
                                  "status": "COMPLETED",
                                  "conclusion": "SUCCESS",
                                  "startedAt": "2026-05-17T14:10:23Z",
                                  "completedAt": "2026-05-17T14:12:03Z",
                                  "checkSuite": {
                                    "workflowRun": {
                                      "workflow": {
                                        "name": "inspect-dependencies"
                                      }
                                    }
                                  }
                                },
                                {
                                  "__typename": "CheckRun",
                                  "name": "preview",
                                  "status": "WAITING",
                                  "conclusion": null,
                                  "startedAt": null,
                                  "completedAt": null,
                                  "checkSuite": {
                                    "workflowRun": {
                                      "workflow": {
                                        "name": "deploy"
                                      }
                                    }
                                  }
                                }
                              ]
                            }
                          }
                        }
                      }
                    ]
                  }
                }
              ]
            }
          }
        }
      }
      """
    )
    let items = try #require(status.checks?.items)
    let now = try isoDate("2026-05-17T14:13:22Z")

    #expect(items[0].title == "test")
    #expect(items[0].detailText(now: now) == "Started 3 minutes ago")
    #expect(items[1].title == "inspect-dependencies")
    #expect(items[1].detailText(now: now) == "Successful in 1m")
    #expect(items[2].title == "deploy / preview")
    #expect(items[2].detailText(now: now) == "Waiting for approval")
  }

  @Test
  func githubPullRequestDecoderBuildsCheckURLs() throws {
    let status = Self.decodeSinglePullRequestStatus(
      """
      {
        "data": {
          "repository": {
            "branch0": {
              "nodes": [
                {
                  "number": 41,
                  "additions": 12,
                  "deletions": 3,
                  "state": "OPEN",
                  "isDraft": false,
                  "url": "https://github.com/supabitapp/supaterm/pull/41",
                  "baseRefName": "main",
                  "headRepository": {
                    "name": "supaterm",
                    "owner": { "login": "supabitapp" }
                  },
                  "commits": {
                    "nodes": [
                      {
                        "commit": {
                          "statusCheckRollup": {
                            "state": "PENDING",
                            "contexts": {
                              "totalCount": 2,
                              "nodes": [
                                {
                                  "__typename": "CheckRun",
                                  "name": "build",
                                  "status": "COMPLETED",
                                  "conclusion": "SUCCESS",
                                  "detailsUrl": "https://github.com/supabitapp/supaterm/actions/runs/1/job/2",
                                  "url": "https://github.com/supabitapp/supaterm/runs/2"
                                },
                                {
                                  "__typename": "StatusContext",
                                  "context": "ci",
                                  "state": "PENDING",
                                  "targetUrl": "https://ci.example.com/supaterm/41"
                                }
                              ]
                            }
                          }
                        }
                      }
                    ]
                  }
                }
              ]
            }
          }
        }
      }
      """
    )
    let items = try #require(status.checks?.items)

    #expect(items[0].url?.absoluteString == "https://github.com/supabitapp/supaterm/actions/runs/1/job/2")
    #expect(items[1].url?.absoluteString == "https://ci.example.com/supaterm/41")
  }

  @Test
  func pullRequestChecksCountsKnownItemsByStatus() {
    let checks = PaneAgentPullRequestChecks(
      status: .pending,
      totalCount: 7,
      items: [
        PaneAgentPullRequestCheck(name: "lint", status: .passing),
        PaneAgentPullRequestCheck(name: "test", status: .pending),
        PaneAgentPullRequestCheck(name: "build", status: .pending),
        PaneAgentPullRequestCheck(name: "deploy", status: .failing),
        PaneAgentPullRequestCheck(name: "docs", status: .skipped),
      ]
    )

    let expectedCounts: [PaneAgentPullRequestCheck.Status: Int] = [
      .passing: 1,
      .pending: 2,
      .failing: 1,
      .skipped: 1,
    ]
    #expect(checks.itemCounts == expectedCounts)
    #expect(checks.title == "Checks pending (7)")
    #expect(!checks.isEmpty)
  }

  @Test
  func pullRequestChecksIsEmptyWhenTotalCountIsZero() {
    let checks = PaneAgentPullRequestChecks(
      status: .passing,
      totalCount: 0,
      items: []
    )

    #expect(checks.isEmpty)
  }

  @Test
  func githubPullRequestDecoderUsesRollupStateForCheckSummary() throws {
    let status = Self.decodeSinglePullRequestStatus(
      """
      {
        "data": {
          "repository": {
            "branch0": {
              "nodes": [
                {
                  "number": 39,
                  "additions": 3040,
                  "deletions": 29,
                  "state": "OPEN",
                  "isDraft": false,
                  "url": "https://github.com/supabitapp/supaterm/pull/39",
                  "baseRefName": "main",
                  "headRepository": {
                    "name": "supaterm",
                    "owner": { "login": "supabitapp" }
                  },
                  "commits": {
                    "nodes": [
                      {
                        "commit": {
                          "statusCheckRollup": {
                            "state": "FAILURE",
                            "contexts": {
                              "totalCount": 25,
                              "nodes": [
                                {
                                  "__typename": "CheckRun",
                                  "name": "first-page-check",
                                  "status": "COMPLETED",
                                  "conclusion": "SUCCESS"
                                }
                              ]
                            }
                          }
                        }
                      }
                    ]
                  }
                }
              ]
            }
          }
        }
      }
      """
    )

    #expect(status.checks?.title == "Checks failing (25)")
  }

  private static func decodeSinglePullRequestStatus(_ json: String) -> PaneAgentPullRequestStatus {
    TerminalAgentGithubClient.decodePullRequestStatuses(
      json,
      aliasMap: ["branch0": "feature"],
      remote: TerminalAgentGithubRemote(host: "github.com", owner: "supabitapp", repo: "supaterm")
    )["feature"] ?? .unavailable
  }
}

private func isoDate(_ value: String) throws -> Date {
  try #require(ISO8601DateFormatter().date(from: value))
}

private actor GithubPullRequestCommandRecorder {
  private let pullRequestNumbersByBranch: [String: Int]
  private var gatewayTimeoutsRemaining: Int
  private var graphqlCalls = 0
  private var graphqlArguments: [[String]] = []

  init(
    pullRequestNumbersByBranch: [String: Int] = ["khoi/agent-panel": 39],
    gatewayTimeoutsRemaining: Int = 0
  ) {
    self.pullRequestNumbersByBranch = pullRequestNumbersByBranch
    self.gatewayTimeoutsRemaining = gatewayTimeoutsRemaining
  }

  func runner() -> TerminalAgentPanelCommandRunner {
    TerminalAgentPanelCommandRunner(
      run: { executableURL, arguments, _ in
        await self.run(executableURL: executableURL, arguments: arguments)
      },
      runLoginCommand: { _, _ in
        TerminalAgentPanelCommandResult(status: 1, stdout: "")
      }
    )
  }

  func graphqlCallCount() -> Int {
    graphqlCalls
  }

  func graphqlBranchNamesByCall() -> [[String]] {
    graphqlArguments.map { Self.branchNames(from: Self.query(from: $0)) }
  }

  func graphqlHosts() -> [String] {
    graphqlArguments.compactMap { arguments in
      guard let index = arguments.firstIndex(of: "--hostname"),
        arguments.indices.contains(arguments.index(after: index))
      else {
        return nil
      }
      return arguments[arguments.index(after: index)]
    }
  }

  private func run(
    executableURL: URL,
    arguments: [String]
  ) -> TerminalAgentPanelCommandResult {
    if executableURL.path == "/usr/bin/which" {
      return TerminalAgentPanelCommandResult(status: 0, stdout: "/usr/bin/gh\n")
    }
    if arguments.starts(with: ["api", "graphql"]) {
      graphqlCalls += 1
      graphqlArguments.append(arguments)
      if gatewayTimeoutsRemaining > 0 {
        gatewayTimeoutsRemaining -= 1
        return TerminalAgentPanelCommandResult(
          status: 1,
          stdout: "",
          stderr: "HTTP 504 Gateway Timeout"
        )
      }
      let branches = Self.branchNames(from: Self.query(from: arguments))
      return TerminalAgentPanelCommandResult(
        status: 0,
        stdout: Self.response(
          branches: branches,
          pullRequestNumbersByBranch: pullRequestNumbersByBranch
        )
      )
    }
    return TerminalAgentPanelCommandResult(status: 1, stdout: "")
  }

  private static func query(from arguments: [String]) -> String {
    arguments
      .first { $0.hasPrefix("query=") }?
      .dropFirst("query=".count)
      .description ?? ""
  }

  private static func branchNames(from query: String) -> [String] {
    let marker = "headRefName: \""
    var branchNames: [String] = []
    var searchRange = query.startIndex..<query.endIndex
    while let markerRange = query.range(of: marker, range: searchRange) {
      let start = markerRange.upperBound
      guard let end = query[start...].firstIndex(of: "\"") else { break }
      branchNames.append(String(query[start..<end]))
      searchRange = query.index(after: end)..<query.endIndex
    }
    return branchNames
  }

  private static func response(
    branches: [String],
    pullRequestNumbersByBranch: [String: Int]
  ) -> String {
    let selections = branches.enumerated().map { index, branch in
      let nodes: String
      if let number = pullRequestNumbersByBranch[branch] {
        nodes = "[\(node(number: number))]"
      } else {
        nodes = "[]"
      }
      return #""branch\#(index)":{"nodes":\#(nodes)}"#
    }
    return #"{"data":{"repository":{\#(selections.joined(separator: ","))}}}"#
  }

  private static func node(number: Int) -> String {
    """
    {
      "number": \(number),
      "additions": 12,
      "deletions": 3,
      "state": "OPEN",
      "isDraft": false,
      "url": "https://github.com/supabitapp/supaterm/pull/\(number)",
      "baseRefName": "main",
      "headRepository": {
        "name": "supaterm",
        "owner": { "login": "supabitapp" }
      },
      "commits": {
        "nodes": [
          {
            "commit": {
              "statusCheckRollup": {
                "state": "SUCCESS",
                "contexts": {
                  "totalCount": 0,
                  "nodes": []
                }
              }
            }
          }
        ]
      }
    }
    """
  }
}

private actor AgentPanelCommandRecorder {
  private let psOutput: String
  private let lsofOutput: String
  private var commands: [(path: String, arguments: [String])] = []

  init(psOutput: String, lsofOutput: String) {
    self.psOutput = psOutput
    self.lsofOutput = lsofOutput
  }

  func runner() -> TerminalAgentPanelCommandRunner {
    TerminalAgentPanelCommandRunner(
      run: { executableURL, arguments, _ in
        await self.run(executableURL: executableURL, arguments: arguments)
      },
      runLoginCommand: { _, _ in
        TerminalAgentPanelCommandResult(status: 1, stdout: "")
      }
    )
  }

  func reset() {
    commands = []
  }

  func commandPaths() -> [String] {
    commands.map(\.path)
  }

  func arguments(for path: String) -> [[String]] {
    commands.compactMap { command in
      command.path == path ? command.arguments : nil
    }
  }

  private func run(
    executableURL: URL,
    arguments: [String]
  ) -> TerminalAgentPanelCommandResult {
    let path = executableURL.path
    commands.append((path, arguments))
    switch path {
    case "/bin/ps":
      return TerminalAgentPanelCommandResult(status: 0, stdout: psOutput)
    case "/usr/sbin/lsof":
      return TerminalAgentPanelCommandResult(status: 0, stdout: lsofOutput)
    default:
      return TerminalAgentPanelCommandResult(status: 1, stdout: "")
    }
  }
}

private actor AgentPanelRefreshRecorder {
  private var recordedGitPaths: [String] = []
  private var recordedPullRequestBranches: [String] = []

  func recordGit(_ workingDirectoryPath: String) {
    recordedGitPaths.append(workingDirectoryPath)
  }

  func recordPullRequest(_ branchName: String) {
    recordedPullRequestBranches.append(branchName)
  }

  func gitPaths() -> [String] {
    recordedGitPaths
  }

  func pullRequestBranches() -> [String] {
    recordedPullRequestBranches
  }
}

private actor AgentPanelPullRequestStatusSequence {
  private var statuses: [PaneAgentPullRequestStatus]

  init(_ statuses: [PaneAgentPullRequestStatus]) {
    self.statuses = statuses
  }

  func next() -> PaneAgentPullRequestStatus {
    if statuses.isEmpty {
      return .unavailable
    }
    return statuses.removeFirst()
  }
}

@MainActor
private func restoreSplitHost(
  _ host: TerminalHostState,
  workingDirectoryPath: String
) throws -> [UUID] {
  let spaceID = try #require(host.spaces.first?.id)
  let sessionTabID = TerminalTabID()
  let tabSession = TerminalTabSession(
    id: sessionTabID,
    lockedTitle: nil,
    focusedPaneIndex: 0,
    root: .split(
      TerminalPaneSplitSession(
        direction: .horizontal,
        ratio: 0.5,
        left: .leaf(TerminalPaneLeafSession(workingDirectoryPath: workingDirectoryPath)),
        right: .leaf(TerminalPaneLeafSession(workingDirectoryPath: workingDirectoryPath))
      )
    )
  )
  let session = TerminalWindowSession(
    selectedSpaceID: spaceID,
    spaces: [
      TerminalWindowSpaceSession(
        id: spaceID,
        selectedTabID: sessionTabID,
        nodes: [
          TerminalTabNodeSession(
            item: .tab(sessionTabID),
            parent: .root(isPinned: false),
            order: 0
          )
        ],
        groups: [],
        collapsedGroupIDs: [],
        tabs: [tabSession]
      )
    ]
  )

  #expect(host.restore(from: session))
  let tabID = try #require(host.selectedTabID)
  let leaves = try #require(host.trees[tabID]?.leaves())
  #expect(leaves.count == 2)
  return leaves.map(\.id)
}

@MainActor
private func waitForBranchDetails(
  host: TerminalHostState,
  surfaceIDs: [UUID],
  branchName: String,
  addedLineCount: Int? = nil,
  removedLineCount: Int? = nil
) async -> Bool {
  let clock = ContinuousClock()
  let deadline = clock.now.advanced(by: .seconds(1))
  while clock.now < deadline {
    if surfaceIDs.allSatisfy({
      guard let branchDetails = host.agentPanelPresentation(for: $0)?.branchDetails else { return false }
      guard branchDetails.branchName == branchName else { return false }
      if let addedLineCount, branchDetails.addedLineCount != addedLineCount {
        return false
      }
      if let removedLineCount, branchDetails.removedLineCount != removedLineCount {
        return false
      }
      return true
    }) {
      return true
    }
    try? await Task.sleep(for: .milliseconds(10))
  }
  return false
}

private func waitForPullRequestRefreshes(
  recorder: AgentPanelRefreshRecorder,
  count: Int
) async -> Bool {
  let clock = ContinuousClock()
  let deadline = clock.now.advanced(by: .seconds(1))
  while clock.now < deadline {
    if await recorder.pullRequestBranches().count >= count {
      return true
    }
    try? await Task.sleep(for: .milliseconds(10))
  }
  return false
}

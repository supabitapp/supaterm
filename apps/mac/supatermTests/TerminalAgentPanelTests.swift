import ComposableArchitecture
import Foundation
import Sharing
import Testing

@testable import SupatermCLIShared
@testable import SupatermTerminalAgentPanelFeature
@testable import SupatermTerminalFeature
@testable import SupatermTerminalModels
@testable import SupatermTerminalPresentationFeature
@testable import supaterm

struct TerminalAgentPanelTests {
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

  @Test
  func mainBranchHidesEmptyPullRequestAction() throws {
    let createStatus = PaneAgentPullRequestStatus.createPullRequest(
      url: URL(string: "https://github.com/supabitapp/supaterm/compare/main?expand=1")!
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
  func registeredPresenceHidesSessionPanelWithoutActivity() throws {
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
      host.registerAgentPresence(
        agent: .pi,
        for: surfaceID,
        sessionID: "session-1",
        processID: nil
      )
    )

    #expect(host.agentPanelPresentation(for: surfaceID) == nil)
  }

  @Test
  @MainActor
  func runningPresenceWithoutSessionShowsStartingPanel() throws {
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
      host.setAgentPresenceActivity(
        TerminalHostState.AgentActivity(kind: .codex, phase: .running),
        for: surfaceID,
        sessionID: nil,
        processID: nil
      )
    )

    let presentation = try #require(host.agentPanelPresentation(for: surfaceID))
    #expect(
      presentation.progressRows == [
        PaneAgentProgressRow(id: "agent-session-running", title: "Starting session", status: .running)
      ])
    #expect(presentation.session == nil)
  }

  @Test
  @MainActor
  func forkedPresenceAdoptsHookSessionID() throws {
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
      host.setAgentPresenceActivity(
        TerminalHostState.AgentActivity(kind: .codex, phase: .running),
        for: surfaceID,
        sessionID: nil,
        processID: nil
      )
    )
    #expect(
      host.registerAgentPresence(
        agent: .codex,
        for: surfaceID,
        sessionID: "session-1",
        processID: nil
      )
    )

    let presentation = try #require(host.agentPanelPresentation(for: surfaceID))
    #expect(presentation.session == PaneAgentPanelSession.supported(agent: .codex, sessionID: "session-1"))
    #expect(presentation.progressRows.isEmpty)
  }

  @Test
  @MainActor
  func actionablePresenceExposesSessionPanelWithoutSnapshot() throws {
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
      host.markAgentSessionActionable(
        agent: .codex,
        for: surfaceID,
        sessionID: "session-1",
        processID: nil
      )
    )

    let presentation = try #require(host.agentPanelPresentation(for: surfaceID))
    #expect(presentation.session == PaneAgentPanelSession.supported(agent: .codex, sessionID: "session-1"))
    #expect(presentation.progressRows.isEmpty)
  }

  @Test
  @MainActor
  func unsupportedActionablePresenceDoesNotExposeSessionActions() throws {
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
      host.markAgentSessionActionable(
        agent: .pi,
        for: surfaceID,
        sessionID: "session-1",
        processID: nil
      )
    )
    #expect(
      host.recordAgentPanelSnapshot(
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
      _ = host.registerAgentPresence(
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
        _ = host.registerAgentPresence(
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
      _ = host.registerAgentPresence(
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
        host.recordAgentPanelSnapshot(
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
  let tabSession = TerminalTabSession(
    isPinned: false,
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
        selectedTabIndex: 0,
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

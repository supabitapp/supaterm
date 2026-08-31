import ComposableArchitecture
import Foundation
import Sharing
import Testing

@testable import SupatermCLIShared
@testable import SupatermSupport
@testable import supaterm

extension TerminalAgentPanelTests {
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

      let repoRoot = URL(fileURLWithPath: "/tmp/ordinary-git-shell", isDirectory: true)
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
      let host = TerminalHostState.test()
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
  func ordinaryGitShellSkipsAgentWorkspaceRefresh() async throws {
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
          addedLineCount: 1,
          removedLineCount: 1
        )
      }
      let githubClient = TerminalAgentGithubClient { _, branchName in
        await recorder.recordPullRequest(branchName)
        return .unavailable
      }
      let host = TerminalHostState.test()
      let surfaceID = try #require(
        restoreSplitHost(
          host,
          workingDirectoryPath: repoRoot.path
        ).first
      )
      let controller = TerminalAgentPanelController(
        terminal: host,
        gitClient: gitClient,
        githubClient: githubClient
      )
      host.agentPanelController = controller
      defer { controller.stop() }

      controller.surfaceFocused(surfaceID)
      try await Task.sleep(for: .milliseconds(300))

      #expect(host.agentPanelPresentation(for: surfaceID) == nil)
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
      let host = TerminalHostState.test()
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
      #expect(await recorder.gitPaths() == [SupatermWorkingDirectory.normalizedPath(repoRoot)])
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
      let host = TerminalHostState.test()
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
          == SupatermWorkingDirectory.normalizedPath(agentRoot)
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
          == SupatermWorkingDirectory.normalizedPath(nextAgentRoot)
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
          SupatermWorkingDirectory.normalizedPath(agentRoot),
          SupatermWorkingDirectory.normalizedPath(nextAgentRoot),
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
      let host = TerminalHostState.test()
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
func restoreSplitHost(
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
    displayedSpaceID: spaceID,
    spaces: [
      TerminalSpaceSession(
        spaceID: spaceID,
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

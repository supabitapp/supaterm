import ComposableArchitecture
import Foundation
import Sharing
import Testing

@testable import SupatermCLIShared
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
  func githubPullRequestDecoderHandlesNoPullRequest() {
    let status = TerminalAgentGithubClient.decodePullRequestStatus(
      """
      {"data":{"repository":{"pullRequests":{"nodes":[]}}}}
      """
    )

    #expect(status == .none)
  }

  @Test
  func githubPullRequestStatusBuildsCreateURLWhenNoPullRequestExists() async {
    let runner = TerminalAgentPanelCommandRunner(
      run: { executableURL, arguments, _ in
        if executableURL.path == "/usr/bin/which" {
          return TerminalAgentPanelCommandResult(status: 0, stdout: "/usr/bin/gh\n")
        }
        if arguments.starts(with: ["repo", "view"]) {
          return TerminalAgentPanelCommandResult(
            status: 0,
            stdout: """
              {
                "name": "supaterm",
                "owner": {
                  "login": "supabitapp"
                },
                "url": "https://github.com/supabitapp/supaterm"
              }
              """
          )
        }
        if arguments.starts(with: ["api", "graphql"]) {
          return TerminalAgentPanelCommandResult(
            status: 0,
            stdout: """
              {"data":{"repository":{"pullRequests":{"nodes":[]}}}}
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
      branchName: "khoi/agent-panel"
    )

    #expect(status.kind == .none)
    #expect(status.title == "Create pull request")
    #expect(
      status.url?.absoluteString
        == "https://github.com/supabitapp/supaterm/compare/khoi/agent-panel?expand=1"
    )
  }

  @Test
  func githubPullRequestDecoderUsesNumberChangesAndChecks() throws {
    let status = TerminalAgentGithubClient.decodePullRequestStatus(
      """
      {
        "data": {
          "repository": {
            "pullRequests": {
              "nodes": [
                {
                  "number": 39,
                  "additions": 3040,
                  "deletions": 29,
                  "state": "OPEN",
                  "isDraft": false,
                  "url": "https://github.com/supabitapp/supaterm/pull/39",
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
    let status = TerminalAgentGithubClient.decodePullRequestStatus(
      """
      {
        "data": {
          "repository": {
            "pullRequests": {
              "nodes": [
                {
                  "number": 40,
                  "additions": 12,
                  "deletions": 3,
                  "state": "OPEN",
                  "isDraft": false,
                  "url": "https://github.com/supabitapp/supaterm/pull/40",
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
    let status = TerminalAgentGithubClient.decodePullRequestStatus(
      """
      {
        "data": {
          "repository": {
            "pullRequests": {
              "nodes": [
                {
                  "number": 41,
                  "additions": 12,
                  "deletions": 3,
                  "state": "OPEN",
                  "isDraft": false,
                  "url": "https://github.com/supabitapp/supaterm/pull/41",
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
    let status = TerminalAgentGithubClient.decodePullRequestStatus(
      """
      {
        "data": {
          "repository": {
            "pullRequests": {
              "nodes": [
                {
                  "number": 39,
                  "additions": 3040,
                  "deletions": 29,
                  "state": "OPEN",
                  "isDraft": false,
                  "url": "https://github.com/supabitapp/supaterm/pull/39",
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
}

private func isoDate(_ value: String) throws -> Date {
  try #require(ISO8601DateFormatter().date(from: value))
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
  branchName: String
) async -> Bool {
  let clock = ContinuousClock()
  let deadline = clock.now.advanced(by: .seconds(1))
  while clock.now < deadline {
    if surfaceIDs.allSatisfy({
      host.agentPanelPresentation(for: $0)?.branchDetails?.branchName == branchName
    }) {
      return true
    }
    try? await Task.sleep(for: .milliseconds(10))
  }
  return false
}

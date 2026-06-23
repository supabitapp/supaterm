import Foundation
import Testing

@testable import SupatermTerminalAgentPanelFeature

struct TerminalAgentPanelGithubTests {
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

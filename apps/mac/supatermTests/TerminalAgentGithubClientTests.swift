import Foundation
import Testing

@testable import supaterm

extension TerminalAgentPanelTests {
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
    let query = await recorder.graphqlQueries().first
    #expect(query?.contains("states: [OPEN, MERGED, CLOSED]") == true)
    #expect(query?.contains("autoMergeRequest") == true)
    #expect(query?.contains("mergeQueueEntry") == true)

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

  func graphqlQueries() -> [String] {
    graphqlArguments.map(Self.query)
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

import Darwin
import Dispatch
import Foundation

nonisolated struct TerminalAgentPanelRefreshContext: Equatable, Sendable {
  let workingDirectoryPath: String?
  let processIDs: Set<Int32>
}

nonisolated struct TerminalAgentPanelCommandResult: Equatable, Sendable {
  let status: Int32
  let stdout: String
}

nonisolated enum TerminalAgentPanelCommandError: Error, Equatable, Sendable {
  case launchFailed(String)
}

nonisolated struct TerminalAgentPanelCommandRunner: Sendable {
  var run: @Sendable (URL, [String], URL?) async throws -> TerminalAgentPanelCommandResult
  var runLoginCommand: @Sendable (String, URL?) async throws -> TerminalAgentPanelCommandResult

  static let live = Self(
    run: { executableURL, arguments, currentDirectoryURL in
      try await runProcess(
        executableURL: executableURL,
        arguments: arguments,
        currentDirectoryURL: currentDirectoryURL
      )
    },
    runLoginCommand: { command, currentDirectoryURL in
      try await runProcess(
        executableURL: loginShellURL(),
        arguments: ["-l", "-i", "-c", command],
        currentDirectoryURL: currentDirectoryURL
      )
    }
  )

  private static func runProcess(
    executableURL: URL,
    arguments: [String],
    currentDirectoryURL: URL?
  ) async throws -> TerminalAgentPanelCommandResult {
    try await Task.detached(priority: .utility) {
      let process = Process()
      process.executableURL = executableURL
      process.arguments = arguments
      process.currentDirectoryURL = currentDirectoryURL
      process.standardInput = FileHandle.nullDevice

      let stdoutPipe = Pipe()
      process.standardOutput = stdoutPipe
      process.standardError = FileHandle.nullDevice

      do {
        try process.run()
      } catch {
        throw TerminalAgentPanelCommandError.launchFailed(error.localizedDescription)
      }

      let stdoutData = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
      process.waitUntilExit()

      return TerminalAgentPanelCommandResult(
        status: process.terminationStatus,
        stdout: String(data: stdoutData, encoding: .utf8) ?? ""
      )
    }.value
  }

  private static func loginShellURL(
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> URL {
    let shell = environment["SHELL"]?.trimmingCharacters(in: .whitespacesAndNewlines)
    if let shell, !shell.isEmpty {
      return URL(fileURLWithPath: shell)
    }
    return URL(fileURLWithPath: "/bin/zsh")
  }
}

nonisolated struct TerminalAgentGitSnapshot: Equatable, Sendable {
  let repoRoot: URL
  let headURL: URL?
  let branchName: String
  let addedLineCount: Int
  let removedLineCount: Int
  let hasWorkingTreeChanges: Bool
}

nonisolated struct TerminalAgentGitClient: Sendable {
  let runner: TerminalAgentPanelCommandRunner

  init(runner: TerminalAgentPanelCommandRunner = .live) {
    self.runner = runner
  }

  nonisolated func snapshot(workingDirectoryPath: String) async -> TerminalAgentGitSnapshot? {
    TerminalAgentPanelDiagnostics.log("git snapshot start pwd=\(workingDirectoryPath)")
    let workingDirectoryURL = URL(fileURLWithPath: workingDirectoryPath, isDirectory: true)
    guard let repoRoot = await repoRoot(for: workingDirectoryURL) else {
      TerminalAgentPanelDiagnostics.log("git snapshot missing repo pwd=\(workingDirectoryPath)")
      return nil
    }
    guard
      let status = try? await runGit(
        arguments: ["-C", repoRoot.path(percentEncoded: false), "status", "--porcelain=v2", "--branch"]
      ), status.status == 0
    else {
      TerminalAgentPanelDiagnostics.log(
        "git snapshot status failed repo=\(repoRoot.path(percentEncoded: false))"
      )
      return nil
    }
    let headURL = Self.headURL(for: repoRoot, fileManager: .default)
    let branchName = Self.branchName(headURL: headURL) ?? "HEAD"
    let changes = await lineChanges(repoRoot: repoRoot, headURL: headURL) ?? (added: 0, removed: 0)
    let snapshot = TerminalAgentGitSnapshot(
      repoRoot: repoRoot,
      headURL: headURL,
      branchName: branchName,
      addedLineCount: changes.added,
      removedLineCount: changes.removed,
      hasWorkingTreeChanges: Self.hasWorkingTreeChanges(status.stdout)
    )
    TerminalAgentPanelDiagnostics.log(
      [
        "git snapshot",
        "repo=\(repoRoot.path(percentEncoded: false))",
        "branch=\(snapshot.branchName)",
        "added=\(snapshot.addedLineCount)",
        "removed=\(snapshot.removedLineCount)",
        "dirty=\(snapshot.hasWorkingTreeChanges)",
      ].joined(separator: " ")
    )
    return snapshot
  }

  nonisolated func repoRoot(for workingDirectoryURL: URL) async -> URL? {
    guard
      let result = try? await runGit(
        arguments: [
          "-C",
          workingDirectoryURL.path(percentEncoded: false),
          "rev-parse",
          "--show-toplevel",
        ]
      ), result.status == 0
    else {
      return nil
    }
    let path = result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !path.isEmpty else { return nil }
    return URL(fileURLWithPath: path, isDirectory: true).standardizedFileURL
  }

  nonisolated private func lineChanges(
    repoRoot: URL,
    headURL: URL?
  ) async -> (added: Int, removed: Int)? {
    guard !Self.isIndexLocked(headURL: headURL, fileManager: .default) else {
      TerminalAgentPanelDiagnostics.log(
        "git diff skipped repo=\(repoRoot.path(percentEncoded: false)) reason=index-lock"
      )
      return nil
    }
    guard
      let result = try? await runGit(
        arguments: [
          "-C",
          repoRoot.path(percentEncoded: false),
          "diff",
          "HEAD",
          "--shortstat",
        ]
      ), result.status == 0
    else {
      TerminalAgentPanelDiagnostics.log(
        "git diff failed repo=\(repoRoot.path(percentEncoded: false))"
      )
      return nil
    }
    return Self.parseShortstat(result.stdout)
  }

  nonisolated private func runGit(
    arguments: [String]
  ) async throws -> TerminalAgentPanelCommandResult {
    try await runner.run(URL(fileURLWithPath: "/usr/bin/env"), ["git"] + arguments, nil)
  }

  nonisolated static func parseShortstat(_ output: String) -> (added: Int, removed: Int) {
    let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
      return (0, 0)
    }
    var added = 0
    var removed = 0
    if let match = trimmed.firstMatch(of: /(\d+)\s+insertions?\(\+\)/) {
      added = Int(match.1) ?? 0
    }
    if let match = trimmed.firstMatch(of: /(\d+)\s+deletions?\(-\)/) {
      removed = Int(match.1) ?? 0
    }
    return (added, removed)
  }

  nonisolated static func hasWorkingTreeChanges(_ statusOutput: String) -> Bool {
    statusOutput
      .split(whereSeparator: \.isNewline)
      .contains { !$0.hasPrefix("#") }
  }

  nonisolated static func branchName(headURL: URL?) -> String? {
    guard let headURL,
      let line = try? String(contentsOf: headURL, encoding: .utf8)
        .split(whereSeparator: \.isNewline)
        .first
    else {
      return nil
    }
    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    let refPrefix = "ref:"
    guard trimmed.hasPrefix(refPrefix) else {
      return "HEAD"
    }
    let ref = trimmed.dropFirst(refPrefix.count).trimmingCharacters(in: .whitespaces)
    let headsPrefix = "refs/heads/"
    if ref.hasPrefix(headsPrefix) {
      return String(ref.dropFirst(headsPrefix.count))
    }
    return String(ref)
  }

  nonisolated static func isIndexLocked(
    headURL: URL?,
    fileManager: FileManager
  ) -> Bool {
    guard let headURL else { return false }
    let lockURL = headURL.deletingLastPathComponent().appending(path: "index.lock")
    return fileManager.fileExists(atPath: lockURL.path(percentEncoded: false))
  }

  nonisolated static func headURL(
    for worktreeURL: URL,
    fileManager: FileManager
  ) -> URL? {
    let gitURL = worktreeURL.appending(path: ".git")
    var isDirectory = ObjCBool(false)
    guard
      fileManager.fileExists(
        atPath: gitURL.path(percentEncoded: false),
        isDirectory: &isDirectory
      )
    else {
      return nil
    }
    if isDirectory.boolValue {
      return gitURL.appending(path: "HEAD")
    }
    guard let contents = try? String(contentsOf: gitURL, encoding: .utf8),
      let line = contents.split(whereSeparator: \.isNewline).first
    else {
      return nil
    }
    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    let prefix = "gitdir:"
    guard trimmed.hasPrefix(prefix) else {
      return nil
    }
    let pathPart = trimmed.dropFirst(prefix.count).trimmingCharacters(in: .whitespacesAndNewlines)
    guard !pathPart.isEmpty else { return nil }
    return URL(fileURLWithPath: String(pathPart), relativeTo: worktreeURL)
      .standardizedFileURL
      .appending(path: "HEAD")
  }
}

nonisolated struct TerminalAgentGithubRemote: Equatable, Sendable {
  let host: String
  let owner: String
  let repo: String
}

actor TerminalAgentGithubExecutableResolver {
  private var cachedExecutableURL: URL?
  private var inFlightResolution: Task<URL, Error>?

  func executableURL(runner: TerminalAgentPanelCommandRunner) async throws -> URL {
    if let cachedExecutableURL {
      return cachedExecutableURL
    }
    if let inFlightResolution {
      return try await inFlightResolution.value
    }
    let task = Task {
      try await resolveExecutableURL(runner: runner)
    }
    inFlightResolution = task
    do {
      let url = try await task.value
      cachedExecutableURL = url
      inFlightResolution = nil
      return url
    } catch {
      inFlightResolution = nil
      throw error
    }
  }

  func invalidate() {
    cachedExecutableURL = nil
    inFlightResolution?.cancel()
    inFlightResolution = nil
  }

  private func resolveExecutableURL(
    runner: TerminalAgentPanelCommandRunner
  ) async throws -> URL {
    if let result = try? await runner.run(
      URL(fileURLWithPath: "/usr/bin/which"),
      ["gh"],
      nil
    ), result.status == 0 {
      let path = result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
      if !path.isEmpty {
        return URL(fileURLWithPath: path)
      }
    }
    if let result = try? await runner.runLoginCommand("command -v gh", nil),
      result.status == 0
    {
      let path = result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
      if !path.isEmpty {
        return URL(fileURLWithPath: path)
      }
    }
    throw TerminalAgentPanelCommandError.launchFailed("gh unavailable")
  }
}

nonisolated struct TerminalAgentGithubClient: Sendable {
  let runner: TerminalAgentPanelCommandRunner
  let resolver: TerminalAgentGithubExecutableResolver

  init(
    runner: TerminalAgentPanelCommandRunner = .live,
    resolver: TerminalAgentGithubExecutableResolver = TerminalAgentGithubExecutableResolver()
  ) {
    self.runner = runner
    self.resolver = resolver
  }

  nonisolated func pullRequestStatus(
    repoRoot: URL,
    branchName: String
  ) async -> PaneAgentPullRequestStatus {
    TerminalAgentPanelDiagnostics.log(
      "gh pr status start repo=\(repoRoot.path(percentEncoded: false)) branch=\(branchName)"
    )
    guard let remote = await remoteInfo(repoRoot: repoRoot) else {
      TerminalAgentPanelDiagnostics.log(
        "gh pr status unavailable repo=\(repoRoot.path(percentEncoded: false)) reason=no-remote"
      )
      return .unavailable
    }
    guard
      let output = try? await runGh(
        arguments: [
          "api",
          "graphql",
          "--hostname",
          remote.host,
          "-f",
          "query=\(Self.pullRequestQuery)",
          "-f",
          "owner=\(remote.owner)",
          "-f",
          "repo=\(remote.repo)",
          "-f",
          "branch=\(branchName)",
        ],
        repoRoot: nil
      ), output.status == 0
    else {
      TerminalAgentPanelDiagnostics.log(
        [
          "gh pr status unavailable",
          "owner=\(remote.owner)",
          "repo=\(remote.repo)",
          "branch=\(branchName)",
          "reason=query-failed",
        ].joined(separator: " ")
      )
      return .unavailable
    }
    let status = Self.decodePullRequestStatus(output.stdout)
    TerminalAgentPanelDiagnostics.log(
      [
        "gh pr status",
        "owner=\(remote.owner)",
        "repo=\(remote.repo)",
        "branch=\(branchName)",
        "kind=\(status.kind)",
        "title=\(status.title)",
      ].joined(separator: " ")
    )
    return status
  }

  nonisolated private func remoteInfo(repoRoot: URL) async -> TerminalAgentGithubRemote? {
    guard
      let output = try? await runGh(
        arguments: ["repo", "view", "--json", "owner,name,url"],
        repoRoot: repoRoot
      ), output.status == 0
    else {
      TerminalAgentPanelDiagnostics.log(
        "gh remote unavailable repo=\(repoRoot.path(percentEncoded: false)) reason=repo-view-failed"
      )
      return nil
    }
    guard
      let response = try? JSONDecoder().decode(
        GithubRepoViewResponse.self,
        from: Data(output.stdout.utf8)
      )
    else {
      TerminalAgentPanelDiagnostics.log(
        "gh remote unavailable repo=\(repoRoot.path(percentEncoded: false)) reason=decode-failed"
      )
      return nil
    }
    guard !response.owner.login.isEmpty, !response.name.isEmpty else {
      TerminalAgentPanelDiagnostics.log(
        "gh remote unavailable repo=\(repoRoot.path(percentEncoded: false)) reason=empty-owner-or-name"
      )
      return nil
    }
    return TerminalAgentGithubRemote(
      host: Self.host(from: response.url) ?? "github.com",
      owner: response.owner.login,
      repo: response.name
    )
  }

  nonisolated private func runGh(
    arguments: [String],
    repoRoot: URL?
  ) async throws -> TerminalAgentPanelCommandResult {
    let executableURL = try await resolver.executableURL(runner: runner)
    let result = try await runner.run(executableURL, arguments, repoRoot)
    if result.status == 127 {
      await resolver.invalidate()
    }
    return result
  }

  nonisolated static func decodePullRequestStatus(_ output: String) -> PaneAgentPullRequestStatus {
    guard
      let response = try? JSONDecoder().decode(
        GithubPullRequestResponse.self,
        from: Data(output.utf8)
      )
    else {
      return .unavailable
    }
    guard let node = response.data.repository.pullRequests.nodes.first else {
      return .none
    }
    let kind: PaneAgentPullRequestStatus.Kind =
      if node.isDraft {
        .draft
      } else {
        switch node.state {
        case "OPEN": .open
        case "MERGED": .merged
        case "CLOSED": .closed
        default: .unavailable
        }
      }
    return PaneAgentPullRequestStatus(
      kind: kind,
      title: "PR #\(node.number)",
      url: URL(string: node.url),
      addedLineCount: node.additions,
      removedLineCount: node.deletions,
      checks: Self.checks(from: node)
    )
  }

  nonisolated private static func checks(
    from node: GithubPullRequestNodeResponse
  ) -> PaneAgentPullRequestChecks {
    guard
      let rollup = node.commits.nodes.last?.commit.statusCheckRollup
    else {
      return PaneAgentPullRequestChecks(status: .passing, totalCount: 0, items: [])
    }
    let checks = rollup.contexts.nodes.compactMap(Self.check)
    return PaneAgentPullRequestChecks(
      status: rollupStatus(rollup.state),
      totalCount: rollup.contexts.totalCount,
      items: checks
    )
  }

  nonisolated private static func check(
    from node: GithubPRCheckNodeResponse
  ) -> PaneAgentPullRequestCheck? {
    switch node.typename {
    case "CheckRun":
      guard let name = normalizedCheckName(node.name) else { return nil }
      return PaneAgentPullRequestCheck(
        name: name,
        status: checkRunStatus(status: node.status, conclusion: node.conclusion)
      )
    case "StatusContext":
      guard let name = normalizedCheckName(node.context) else { return nil }
      return PaneAgentPullRequestCheck(
        name: name,
        status: statusContextStatus(node.state)
      )
    default:
      return nil
    }
  }

  nonisolated private static func normalizedCheckName(_ value: String?) -> String? {
    guard let value else { return nil }
    let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty else { return nil }
    return normalized
  }

  nonisolated private static func checkRunStatus(
    status: String?,
    conclusion: String?
  ) -> PaneAgentPullRequestCheck.Status {
    guard status == "COMPLETED" else {
      return .pending
    }
    switch conclusion {
    case "SUCCESS":
      return .passing
    case "NEUTRAL", "SKIPPED":
      return .skipped
    default:
      return .failing
    }
  }

  nonisolated private static func statusContextStatus(
    _ state: String?
  ) -> PaneAgentPullRequestCheck.Status {
    switch state {
    case "SUCCESS":
      return .passing
    case "FAILURE", "ERROR":
      return .failing
    default:
      return .pending
    }
  }

  nonisolated private static func rollupStatus(
    _ state: String
  ) -> PaneAgentPullRequestChecks.Status {
    switch state {
    case "SUCCESS":
      return .passing
    case "FAILURE", "ERROR":
      return .failing
    default:
      return .pending
    }
  }

  nonisolated private static func host(from urlString: String?) -> String? {
    guard let urlString, let url = URL(string: urlString), let host = url.host else {
      return nil
    }
    return host
  }

  private static let pullRequestQuery = """
    query($owner: String!, $repo: String!, $branch: String!) {
      repository(owner: $owner, name: $repo) {
        pullRequests(
          first: 1
          states: [OPEN, MERGED, CLOSED]
          headRefName: $branch
          orderBy: {field: UPDATED_AT, direction: DESC}
        ) {
          nodes {
            number
            additions
            deletions
            state
            isDraft
            url
            commits(last: 1) {
              nodes {
                commit {
                  statusCheckRollup {
                    state
                    contexts(first: 20) {
                      totalCount
                      nodes {
                        __typename
                        ... on CheckRun {
                          name
                          status
                          conclusion
                        }
                        ... on StatusContext {
                          context
                          state
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    """
}

nonisolated private struct GithubRepoViewResponse: Decodable {
  let name: String
  let owner: GithubRepoViewOwnerResponse
  let url: String?
}

nonisolated private struct GithubRepoViewOwnerResponse: Decodable {
  let login: String
}

nonisolated private struct GithubPullRequestResponse: Decodable {
  let data: GithubPullRequestDataResponse
}

nonisolated private struct GithubPullRequestDataResponse: Decodable {
  let repository: GithubPullRequestRepositoryResponse
}

nonisolated private struct GithubPullRequestRepositoryResponse: Decodable {
  let pullRequests: GithubPullRequestConnectionResponse
}

nonisolated private struct GithubPullRequestConnectionResponse: Decodable {
  let nodes: [GithubPullRequestNodeResponse]
}

nonisolated private struct GithubPullRequestNodeResponse: Decodable {
  let number: Int
  let additions: Int
  let deletions: Int
  let state: String
  let isDraft: Bool
  let url: String
  let commits: GithubPRCommitConnectionResponse
}

nonisolated private struct GithubPRCommitConnectionResponse: Decodable {
  let nodes: [GithubPRCommitNodeResponse]
}

nonisolated private struct GithubPRCommitNodeResponse: Decodable {
  let commit: GithubPRCommitResponse
}

nonisolated private struct GithubPRCommitResponse: Decodable {
  let statusCheckRollup: GithubPRCheckRollupResponse?
}

nonisolated private struct GithubPRCheckRollupResponse: Decodable {
  let state: String
  let contexts: GithubPRCheckContextConnectionResponse
}

nonisolated private struct GithubPRCheckContextConnectionResponse: Decodable {
  let totalCount: Int
  let nodes: [GithubPRCheckNodeResponse]
}

nonisolated private struct GithubPRCheckNodeResponse: Decodable {
  let typename: String
  let name: String?
  let context: String?
  let status: String?
  let conclusion: String?
  let state: String?

  enum CodingKeys: String, CodingKey {
    case typename = "__typename"
    case name
    case context
    case status
    case conclusion
    case state
  }
}

@MainActor
final class PaneAgentPortScanner {
  typealias Delivery = @MainActor (UUID, [PaneAgentArtifact]) -> Void

  private let runner: TerminalAgentPanelCommandRunner
  private var revisions: [UUID: UInt64] = [:]
  private var burstTasks: [UUID: [Task<Void, Never>]] = [:]
  private var periodicTasks: [UUID: Task<Void, Never>] = [:]

  private static let burstDelays: [Duration] = [
    .milliseconds(500),
    .milliseconds(1500),
    .seconds(3),
    .seconds(5),
    .milliseconds(7500),
    .seconds(10),
  ]

  init(runner: TerminalAgentPanelCommandRunner = .live) {
    self.runner = runner
  }

  func update(
    surfaceID: UUID,
    processIDs: Set<Int32>,
    deliver: @escaping Delivery
  ) {
    let normalizedProcessIDs = Set(processIDs.map(Int.init).filter { $0 > 0 })
    let revision = nextRevision(for: surfaceID)
    TerminalAgentPanelDiagnostics.log(
      [
        "ports update",
        "surface=\(TerminalAgentPanelDiagnostics.surface(surfaceID))",
        "roots=\(normalizedProcessIDs.sorted())",
        "revision=\(revision)",
      ].joined(separator: " ")
    )
    cancelBurst(surfaceID)
    periodicTasks.removeValue(forKey: surfaceID)?.cancel()
    guard !normalizedProcessIDs.isEmpty else {
      TerminalAgentPanelDiagnostics.log(
        "ports cleared surface=\(TerminalAgentPanelDiagnostics.surface(surfaceID)) reason=no-processes"
      )
      deliver(surfaceID, [])
      return
    }
    burstTasks[surfaceID] = Self.burstDelays.map { delay in
      scanTask(
        surfaceID: surfaceID,
        processIDs: normalizedProcessIDs,
        revision: revision,
        delay: delay,
        deliver: deliver
      )
    }
    periodicTasks[surfaceID] = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(2))
        guard !Task.isCancelled else { return }
        await self?.scanAndDeliver(
          surfaceID: surfaceID,
          processIDs: normalizedProcessIDs,
          revision: revision,
          deliver: deliver
        )
      }
    }
  }

  func clear(surfaceID: UUID, deliver: Delivery? = nil) {
    nextRevision(for: surfaceID)
    cancelBurst(surfaceID)
    periodicTasks.removeValue(forKey: surfaceID)?.cancel()
    TerminalAgentPanelDiagnostics.log(
      "ports cleared surface=\(TerminalAgentPanelDiagnostics.surface(surfaceID))"
    )
    deliver?(surfaceID, [])
  }

  func stop() {
    for surfaceID in Set(burstTasks.keys).union(periodicTasks.keys) {
      clear(surfaceID: surfaceID)
    }
  }

  private func scanTask(
    surfaceID: UUID,
    processIDs: Set<Int>,
    revision: UInt64,
    delay: Duration,
    deliver: @escaping Delivery
  ) -> Task<Void, Never> {
    Task { [weak self] in
      try? await Task.sleep(for: delay)
      guard !Task.isCancelled else { return }
      await self?.scanAndDeliver(
        surfaceID: surfaceID,
        processIDs: processIDs,
        revision: revision,
        deliver: deliver
      )
    }
  }

  private func scanAndDeliver(
    surfaceID: UUID,
    processIDs: Set<Int>,
    revision: UInt64,
    deliver: @escaping Delivery
  ) async {
    let ports = await Self.scanPorts(rootProcessIDs: processIDs, runner: runner)
    let artifacts = Self.artifacts(for: ports)
    guard revisions[surfaceID] == revision else {
      TerminalAgentPanelDiagnostics.log(
        "ports ignored surface=\(TerminalAgentPanelDiagnostics.surface(surfaceID)) reason=stale revision=\(revision)"
      )
      return
    }
    TerminalAgentPanelDiagnostics.log(
      "ports delivered surface=\(TerminalAgentPanelDiagnostics.surface(surfaceID)) ports=\(ports)"
    )
    deliver(surfaceID, artifacts)
  }

  @discardableResult
  private func nextRevision(for surfaceID: UUID) -> UInt64 {
    let revision = revisions[surfaceID, default: 0] &+ 1
    revisions[surfaceID] = revision
    return revision
  }

  private func cancelBurst(_ surfaceID: UUID) {
    for task in burstTasks.removeValue(forKey: surfaceID) ?? [] {
      task.cancel()
    }
  }

  nonisolated static func scanPorts(
    rootProcessIDs: Set<Int>,
    runner: TerminalAgentPanelCommandRunner
  ) async -> [Int] {
    guard !rootProcessIDs.isEmpty else {
      TerminalAgentPanelDiagnostics.log("port scan skipped reason=no-roots")
      return []
    }
    TerminalAgentPanelDiagnostics.log("port scan start roots=\(rootProcessIDs.sorted())")
    guard
      let psResult = try? await runner.run(
        URL(fileURLWithPath: "/bin/ps"),
        ["-ax", "-o", "pid=,ppid="],
        nil
      )
    else {
      TerminalAgentPanelDiagnostics.log("port scan failed reason=ps")
      return []
    }
    let processIDs = expandProcessTree(
      rootProcessIDs: rootProcessIDs,
      parentByPID: parentMap(fromPSOutput: psResult.stdout)
    )
    guard !processIDs.isEmpty else {
      TerminalAgentPanelDiagnostics.log("port scan empty-process-tree roots=\(rootProcessIDs.sorted())")
      return []
    }
    let pids = processIDs.sorted().map(String.init).joined(separator: ",")
    guard
      let lsofResult = try? await runner.run(
        URL(fileURLWithPath: "/usr/sbin/lsof"),
        ["-nP", "-a", "-p", pids, "-iTCP", "-sTCP:LISTEN", "-Fpn"],
        nil
      )
    else {
      TerminalAgentPanelDiagnostics.log("port scan failed reason=lsof pids=\(pids)")
      return []
    }
    let ports = Array(ports(fromLsofOutput: lsofResult.stdout).values.flatMap { $0 }).sorted()
    TerminalAgentPanelDiagnostics.log("port scan result pids=\(pids) ports=\(ports)")
    return ports
  }

  nonisolated static func artifacts(for ports: [Int]) -> [PaneAgentArtifact] {
    Array(Set(ports))
      .sorted()
      .compactMap { port in
        guard let url = URL(string: "http://localhost:\(port)") else { return nil }
        return PaneAgentArtifact(title: "localhost:\(port)", url: url)
      }
  }

  nonisolated static func parentMap(fromPSOutput output: String) -> [Int: Int] {
    var mapping: [Int: Int] = [:]
    for line in output.split(whereSeparator: \.isNewline) {
      let parts = line.split(whereSeparator: \.isWhitespace)
      guard parts.count >= 2,
        let pid = Int(parts[0]),
        let parentPID = Int(parts[1])
      else {
        continue
      }
      mapping[pid] = parentPID
    }
    return mapping
  }

  nonisolated static func expandProcessTree(
    rootProcessIDs: Set<Int>,
    parentByPID: [Int: Int]
  ) -> Set<Int> {
    var result = Set(rootProcessIDs.filter { $0 > 0 })
    var childrenByParent: [Int: [Int]] = [:]
    for (pid, parentPID) in parentByPID {
      childrenByParent[parentPID, default: []].append(pid)
    }
    var queue = Array(result)
    var index = 0
    while index < queue.count {
      let pid = queue[index]
      index += 1
      for childPID in childrenByParent[pid] ?? [] where result.insert(childPID).inserted {
        queue.append(childPID)
      }
    }
    return result
  }

  nonisolated static func ports(fromLsofOutput output: String) -> [Int: Set<Int>] {
    var result: [Int: Set<Int>] = [:]
    var currentPID: Int?
    for line in output.split(whereSeparator: \.isNewline) {
      guard let first = line.first else { continue }
      switch first {
      case "p":
        currentPID = Int(line.dropFirst())
      case "n":
        guard let pid = currentPID,
          let port = port(fromLsofName: String(line.dropFirst()))
        else {
          continue
        }
        result[pid, default: []].insert(port)
      default:
        break
      }
    }
    return result
  }

  nonisolated static func port(fromLsofName value: String) -> Int? {
    let localValue: String
    if let arrowRange = value.range(of: "->") {
      localValue = String(value[..<arrowRange.lowerBound])
    } else {
      localValue = value
    }
    guard let colonIndex = localValue.lastIndex(of: ":") else {
      return nil
    }
    let portText = localValue[localValue.index(after: colonIndex)...].prefix(while: \.isNumber)
    guard let port = Int(portText), port > 0, port <= 65535 else {
      return nil
    }
    return port
  }
}

@MainActor
final class TerminalAgentPanelController {
  private struct HeadWatcher {
    let headURL: URL
    let source: DispatchSourceFileSystemObject
  }

  private weak var terminal: TerminalHostState?
  private let gitClient: TerminalAgentGitClient
  private let githubClient: TerminalAgentGithubClient
  private let portScanner: PaneAgentPortScanner
  private var surfaceRevisions: [UUID: UInt64] = [:]
  private var refreshTasks: [UUID: Task<Void, Never>] = [:]
  private var periodicTasks: [UUID: Task<Void, Never>] = [:]
  private var branchDebounceTasks: [UUID: Task<Void, Never>] = [:]
  private var filesDebounceTasks: [UUID: Task<Void, Never>] = [:]
  private var headWatchers: [UUID: HeadWatcher] = [:]

  init(
    terminal: TerminalHostState,
    gitClient: TerminalAgentGitClient = TerminalAgentGitClient(),
    githubClient: TerminalAgentGithubClient = TerminalAgentGithubClient(),
    portScanner: PaneAgentPortScanner = PaneAgentPortScanner()
  ) {
    self.terminal = terminal
    self.gitClient = gitClient
    self.githubClient = githubClient
    self.portScanner = portScanner
  }

  func surfaceFocused(_ surfaceID: UUID) {
    TerminalAgentPanelDiagnostics.log(
      "surface focused surface=\(TerminalAgentPanelDiagnostics.surface(surfaceID))"
    )
    for id in periodicTasks.keys where id != surfaceID {
      periodicTasks.removeValue(forKey: id)?.cancel()
    }
    touch(surfaceID)
    let context = terminal?.agentPanelRefreshContext(for: surfaceID)
    updatePortTracking(surfaceID, context: context)
    guard context != nil else {
      TerminalAgentPanelDiagnostics.log(
        "surface focused no context surface=\(TerminalAgentPanelDiagnostics.surface(surfaceID))"
      )
      cancelRefreshTracking(surfaceID)
      return
    }
    scheduleRefresh(surfaceID, delay: .zero)
    schedulePeriodicRefresh(surfaceID)
  }

  func surfacePathChanged(_ surfaceID: UUID) {
    TerminalAgentPanelDiagnostics.log(
      "surface path changed surface=\(TerminalAgentPanelDiagnostics.surface(surfaceID))"
    )
    touch(surfaceID)
    scheduleRefresh(surfaceID, delay: .milliseconds(200))
  }

  func surfaceAgentStateChanged(_ surfaceID: UUID) {
    TerminalAgentPanelDiagnostics.log(
      "surface agent state changed surface=\(TerminalAgentPanelDiagnostics.surface(surfaceID))"
    )
    touch(surfaceID)
    let context = terminal?.agentPanelRefreshContext(for: surfaceID)
    updatePortTracking(surfaceID, context: context)
    guard context != nil else {
      TerminalAgentPanelDiagnostics.log(
        "surface agent state no context surface=\(TerminalAgentPanelDiagnostics.surface(surfaceID))"
      )
      cancelRefreshTracking(surfaceID)
      stopHeadWatcher(surfaceID)
      _ = terminal?.clearAgentPanelMetadata(for: surfaceID)
      return
    }
    scheduleRefresh(surfaceID, delay: .milliseconds(200))
    schedulePeriodicRefresh(surfaceID)
  }

  func surfaceCommandFinished(_ surfaceID: UUID) {
    TerminalAgentPanelDiagnostics.log(
      "surface command finished surface=\(TerminalAgentPanelDiagnostics.surface(surfaceID))"
    )
    clearSurface(surfaceID)
  }

  func surfaceRemoved(_ surfaceID: UUID) {
    TerminalAgentPanelDiagnostics.log(
      "surface removed surface=\(TerminalAgentPanelDiagnostics.surface(surfaceID))"
    )
    clearSurface(surfaceID)
  }

  func stop() {
    for surfaceID in Set(surfaceRevisions.keys)
      .union(refreshTasks.keys)
      .union(periodicTasks.keys)
      .union(headWatchers.keys)
    {
      clearSurface(surfaceID)
    }
    portScanner.stop()
  }

  private func schedulePeriodicRefresh(_ surfaceID: UUID) {
    guard periodicTasks[surfaceID] == nil else { return }
    TerminalAgentPanelDiagnostics.log(
      "periodic refresh scheduled surface=\(TerminalAgentPanelDiagnostics.surface(surfaceID))"
    )
    periodicTasks[surfaceID] = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(30))
        guard !Task.isCancelled else { return }
        self?.scheduleRefresh(surfaceID, delay: .zero)
      }
    }
  }

  private func scheduleRefresh(
    _ surfaceID: UUID,
    delay: Duration
  ) {
    refreshTasks.removeValue(forKey: surfaceID)?.cancel()
    let revision = surfaceRevisions[surfaceID, default: 0]
    TerminalAgentPanelDiagnostics.log(
      [
        "refresh scheduled",
        "surface=\(TerminalAgentPanelDiagnostics.surface(surfaceID))",
        "revision=\(revision)",
        "delay=\(delay)",
      ].joined(separator: " ")
    )
    refreshTasks[surfaceID] = Task { [weak self] in
      if delay != .zero {
        try? await Task.sleep(for: delay)
      }
      guard !Task.isCancelled else { return }
      await self?.refresh(surfaceID: surfaceID, revision: revision)
    }
  }

  private func refresh(
    surfaceID: UUID,
    revision: UInt64
  ) async {
    TerminalAgentPanelDiagnostics.log(
      "refresh start surface=\(TerminalAgentPanelDiagnostics.surface(surfaceID)) revision=\(revision)"
    )
    guard let context = terminal?.agentPanelRefreshContext(for: surfaceID),
      let workingDirectoryPath = context.workingDirectoryPath
    else {
      TerminalAgentPanelDiagnostics.log(
        "refresh no context or pwd surface=\(TerminalAgentPanelDiagnostics.surface(surfaceID)) revision=\(revision)"
      )
      storeBranchDetails(nil, surfaceID: surfaceID, revision: revision)
      return
    }
    let gitSnapshot = await gitClient.snapshot(workingDirectoryPath: workingDirectoryPath)
    let branchDetails: PaneAgentBranchDetails?
    if let gitSnapshot {
      let pullRequestStatus = await githubClient.pullRequestStatus(
        repoRoot: gitSnapshot.repoRoot,
        branchName: gitSnapshot.branchName
      )
      branchDetails = PaneAgentBranchDetails(
        branchName: gitSnapshot.branchName,
        addedLineCount: pullRequestStatus.addedLineCount ?? gitSnapshot.addedLineCount,
        removedLineCount: pullRequestStatus.removedLineCount ?? gitSnapshot.removedLineCount,
        hasWorkingTreeChanges: gitSnapshot.hasWorkingTreeChanges,
        pullRequestStatus: pullRequestStatus
      )
    } else {
      TerminalAgentPanelDiagnostics.log(
        [
          "refresh no git snapshot",
          "surface=\(TerminalAgentPanelDiagnostics.surface(surfaceID))",
          "pwd=\(workingDirectoryPath)",
        ].joined(separator: " ")
      )
      branchDetails = nil
    }
    await MainActor.run {
      guard self.surfaceRevisions[surfaceID, default: 0] == revision else {
        TerminalAgentPanelDiagnostics.log(
          "refresh ignored stale surface=\(TerminalAgentPanelDiagnostics.surface(surfaceID)) revision=\(revision)"
        )
        return
      }
      TerminalAgentPanelDiagnostics.log(
        "refresh store surface=\(TerminalAgentPanelDiagnostics.surface(surfaceID)) hasBranch=\(branchDetails != nil)"
      )
      self.storeBranchDetails(branchDetails, surfaceID: surfaceID, revision: revision)
      self.configureHeadWatcher(surfaceID: surfaceID, headURL: gitSnapshot?.headURL)
    }
  }

  private func updatePortTracking(
    _ surfaceID: UUID,
    context: TerminalAgentPanelRefreshContext?
  ) {
    guard let context else {
      TerminalAgentPanelDiagnostics.log(
        "port tracking clear surface=\(TerminalAgentPanelDiagnostics.surface(surfaceID)) reason=no-context"
      )
      portScanner.clear(surfaceID: surfaceID) { [weak self] surfaceID, artifacts in
        self?.storeArtifacts(artifacts, surfaceID: surfaceID)
      }
      return
    }
    TerminalAgentPanelDiagnostics.log(
      [
        "port tracking update",
        "surface=\(TerminalAgentPanelDiagnostics.surface(surfaceID))",
        "processIDs=\(context.processIDs.sorted())",
      ].joined(separator: " ")
    )
    portScanner.update(
      surfaceID: surfaceID,
      processIDs: context.processIDs
    ) { [weak self] surfaceID, artifacts in
      self?.storeArtifacts(artifacts, surfaceID: surfaceID)
    }
  }

  private func storeBranchDetails(
    _ branchDetails: PaneAgentBranchDetails?,
    surfaceID: UUID,
    revision: UInt64
  ) {
    guard surfaceRevisions[surfaceID, default: 0] == revision else {
      TerminalAgentPanelDiagnostics.log(
        [
          "branch details ignored",
          "surface=\(TerminalAgentPanelDiagnostics.surface(surfaceID))",
          "reason=stale",
          "revision=\(revision)",
        ].joined(separator: " ")
      )
      return
    }
    guard terminal?.storeAgentPanelBranchDetails(branchDetails, for: surfaceID) == true else {
      TerminalAgentPanelDiagnostics.log(
        "branch details unchanged surface=\(TerminalAgentPanelDiagnostics.surface(surfaceID))"
      )
      return
    }
  }

  private func storeArtifacts(
    _ artifacts: [PaneAgentArtifact],
    surfaceID: UUID
  ) {
    guard terminal?.storeAgentPanelArtifacts(artifacts, for: surfaceID) == true else {
      TerminalAgentPanelDiagnostics.log(
        "artifacts unchanged surface=\(TerminalAgentPanelDiagnostics.surface(surfaceID)) count=\(artifacts.count)"
      )
      return
    }
  }

  @discardableResult
  private func touch(_ surfaceID: UUID) -> UInt64 {
    let revision = surfaceRevisions[surfaceID, default: 0] &+ 1
    surfaceRevisions[surfaceID] = revision
    return revision
  }

  private func clearSurface(_ surfaceID: UUID) {
    TerminalAgentPanelDiagnostics.log(
      "surface cleared surface=\(TerminalAgentPanelDiagnostics.surface(surfaceID))"
    )
    touch(surfaceID)
    cancelRefreshTracking(surfaceID)
    stopHeadWatcher(surfaceID)
    portScanner.clear(surfaceID: surfaceID)
  }

  private func cancelRefreshTracking(_ surfaceID: UUID) {
    refreshTasks.removeValue(forKey: surfaceID)?.cancel()
    periodicTasks.removeValue(forKey: surfaceID)?.cancel()
    branchDebounceTasks.removeValue(forKey: surfaceID)?.cancel()
    filesDebounceTasks.removeValue(forKey: surfaceID)?.cancel()
  }

  private func configureHeadWatcher(surfaceID: UUID, headURL: URL?) {
    guard let headURL else {
      TerminalAgentPanelDiagnostics.log(
        "head watcher stopped surface=\(TerminalAgentPanelDiagnostics.surface(surfaceID)) reason=no-head"
      )
      stopHeadWatcher(surfaceID)
      return
    }
    if headWatchers[surfaceID]?.headURL == headURL {
      return
    }
    stopHeadWatcher(surfaceID)
    let path = headURL.path(percentEncoded: false)
    let descriptor = open(path, O_EVTONLY)
    guard descriptor >= 0 else {
      TerminalAgentPanelDiagnostics.log(
        "head watcher failed surface=\(TerminalAgentPanelDiagnostics.surface(surfaceID)) path=\(path)"
      )
      return
    }
    let source = DispatchSource.makeFileSystemObjectSource(
      fileDescriptor: descriptor,
      eventMask: [.write, .rename, .delete, .attrib],
      queue: DispatchQueue(label: "terminal-agent-panel-head.\(surfaceID.uuidString)")
    )
    source.setEventHandler { @Sendable [weak self, weak source] in
      guard let source else { return }
      let event = source.data
      Task { @MainActor in
        self?.handleHeadEvent(surfaceID: surfaceID, event: event)
      }
    }
    source.setCancelHandler { @Sendable in
      close(descriptor)
    }
    source.resume()
    headWatchers[surfaceID] = HeadWatcher(headURL: headURL, source: source)
    TerminalAgentPanelDiagnostics.log(
      "head watcher started surface=\(TerminalAgentPanelDiagnostics.surface(surfaceID)) path=\(path)"
    )
  }

  private func handleHeadEvent(
    surfaceID: UUID,
    event: DispatchSource.FileSystemEvent
  ) {
    TerminalAgentPanelDiagnostics.log(
      "head changed surface=\(TerminalAgentPanelDiagnostics.surface(surfaceID)) event=\(event.rawValue)"
    )
    if event.contains(.delete) || event.contains(.rename) {
      stopHeadWatcher(surfaceID)
    }
    branchDebounceTasks.removeValue(forKey: surfaceID)?.cancel()
    branchDebounceTasks[surfaceID] = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(200))
      self?.surfacePathChanged(surfaceID)
    }
    filesDebounceTasks.removeValue(forKey: surfaceID)?.cancel()
    filesDebounceTasks[surfaceID] = Task { [weak self] in
      try? await Task.sleep(for: .seconds(5))
      self?.surfacePathChanged(surfaceID)
    }
  }

  private func stopHeadWatcher(_ surfaceID: UUID) {
    headWatchers.removeValue(forKey: surfaceID)?.source.cancel()
  }
}

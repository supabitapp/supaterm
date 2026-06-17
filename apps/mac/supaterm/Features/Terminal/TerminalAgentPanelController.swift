import Darwin
import Dispatch
import Foundation

nonisolated struct TerminalAgentPanelRefreshContext: Equatable, Sendable {
  let workingDirectoryPath: String?
  let processIDs: Set<Int32>
}

nonisolated struct TerminalAgentPanelWorkspaceKey: Equatable, Hashable, Sendable {
  let workingDirectoryPath: String

  init?(workingDirectoryPath: String?) {
    guard
      let workingDirectoryPath = workingDirectoryPath?.trimmingCharacters(in: .whitespacesAndNewlines),
      !workingDirectoryPath.isEmpty
    else {
      return nil
    }
    self.workingDirectoryPath = URL(
      fileURLWithPath: workingDirectoryPath,
      isDirectory: true
    )
    .standardizedFileURL
    .path(percentEncoded: false)
  }
}

nonisolated struct TerminalAgentPanelCommandResult: Equatable, Sendable {
  let status: Int32
  let stdout: String
  let stderr: String

  init(status: Int32, stdout: String, stderr: String = "") {
    self.status = status
    self.stdout = stdout
    self.stderr = stderr
  }
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
      let stderrPipe = Pipe()
      process.standardOutput = stdoutPipe
      process.standardError = stderrPipe

      do {
        try process.run()
      } catch {
        throw TerminalAgentPanelCommandError.launchFailed(error.localizedDescription)
      }

      let stdoutTask = Task.detached(priority: .utility) {
        stdoutPipe.fileHandleForReading.readDataToEndOfFile()
      }
      let stderrTask = Task.detached(priority: .utility) {
        stderrPipe.fileHandleForReading.readDataToEndOfFile()
      }
      process.waitUntilExit()
      let stdoutData = await stdoutTask.value
      let stderrData = await stderrTask.value

      return TerminalAgentPanelCommandResult(
        status: process.terminationStatus,
        stdout: String(data: stdoutData, encoding: .utf8) ?? "",
        stderr: String(data: stderrData, encoding: .utf8) ?? ""
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
  let remoteURL: String?

  init(
    repoRoot: URL,
    headURL: URL?,
    branchName: String,
    addedLineCount: Int,
    removedLineCount: Int,
    remoteURL: String? = nil
  ) {
    self.repoRoot = repoRoot
    self.headURL = headURL
    self.branchName = branchName
    self.addedLineCount = addedLineCount
    self.removedLineCount = removedLineCount
    self.remoteURL = remoteURL
  }
}

nonisolated struct TerminalAgentGitClient: Sendable {
  let runner: TerminalAgentPanelCommandRunner
  private let snapshotProvider: (@Sendable (String) async -> TerminalAgentGitSnapshot?)?

  init(runner: TerminalAgentPanelCommandRunner = .live) {
    self.runner = runner
    snapshotProvider = nil
  }

  init(snapshot: @escaping @Sendable (String) async -> TerminalAgentGitSnapshot?) {
    runner = .live
    snapshotProvider = snapshot
  }

  nonisolated func snapshot(workingDirectoryPath: String) async -> TerminalAgentGitSnapshot? {
    if let snapshotProvider {
      return await snapshotProvider(workingDirectoryPath)
    }
    let workingDirectoryURL = URL(fileURLWithPath: workingDirectoryPath, isDirectory: true)
    guard let repoRoot = await repoRoot(for: workingDirectoryURL) else {
      return nil
    }
    let headURL = Self.headURL(for: repoRoot, fileManager: .default)
    let branchName = Self.branchName(headURL: headURL) ?? "HEAD"
    let changes = await lineChanges(repoRoot: repoRoot, headURL: headURL) ?? (added: 0, removed: 0)
    let remoteURL = await remoteURL(repoRoot: repoRoot, branchName: branchName)
    let snapshot = TerminalAgentGitSnapshot(
      repoRoot: repoRoot,
      headURL: headURL,
      branchName: branchName,
      addedLineCount: changes.added,
      removedLineCount: changes.removed,
      remoteURL: remoteURL
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
      return nil
    }
    return Self.parseShortstat(result.stdout)
  }

  nonisolated private func runGit(
    arguments: [String]
  ) async throws -> TerminalAgentPanelCommandResult {
    try await runner.run(URL(fileURLWithPath: "/usr/bin/env"), ["git"] + arguments, nil)
  }

  nonisolated private func remoteURL(
    repoRoot: URL,
    branchName: String
  ) async -> String? {
    let configuredRemoteName = await gitOutput(
      arguments: [
        "-C",
        repoRoot.path(percentEncoded: false),
        "config",
        "--get",
        "branch.\(branchName).remote",
      ]
    )
    let remoteName = configuredRemoteName.flatMap(Self.normalizedRemoteName) ?? "origin"
    if let remoteURL = await gitOutput(
      arguments: [
        "-C",
        repoRoot.path(percentEncoded: false),
        "remote",
        "get-url",
        remoteName,
      ]
    ) {
      return remoteURL
    }
    guard remoteName != "origin" else { return nil }
    return await gitOutput(
      arguments: [
        "-C",
        repoRoot.path(percentEncoded: false),
        "remote",
        "get-url",
        "origin",
      ]
    )
  }

  nonisolated private func gitOutput(arguments: [String]) async -> String? {
    guard
      let result = try? await runGit(arguments: arguments),
      result.status == 0
    else {
      return nil
    }
    let output = result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !output.isEmpty else { return nil }
    return output
  }

  nonisolated private static func normalizedRemoteName(_ value: String) -> String? {
    let remoteName = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !remoteName.isEmpty, remoteName != "." else { return nil }
    return remoteName
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

nonisolated struct TerminalAgentGithubRemote: Equatable, Hashable, Sendable {
  let host: String
  let owner: String
  let repo: String

  init(host: String, owner: String, repo: String) {
    self.host = host
    self.owner = owner
    self.repo = repo
  }

  init?(remoteURL: String) {
    let trimmed = remoteURL.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    if let remote = Self.urlRemote(from: trimmed) ?? Self.scpRemote(from: trimmed) {
      self = remote
    } else {
      return nil
    }
  }

  func createPullRequestURL(branchName: String) -> URL? {
    var components = URLComponents()
    components.scheme = "https"
    components.host = host
    components.path = "/\(owner)/\(repo)/compare/\(branchName)"
    components.queryItems = [URLQueryItem(name: "expand", value: "1")]
    return components.url
  }

  private static func urlRemote(from value: String) -> Self? {
    guard let url = URL(string: value), let host = url.host else {
      return nil
    }
    guard let repository = repository(fromPath: url.path) else {
      return nil
    }
    return Self(host: host, owner: repository.owner, repo: repository.repo)
  }

  private static func scpRemote(from value: String) -> Self? {
    guard
      let colon = value.firstIndex(of: ":"),
      !value[..<colon].contains("/")
    else {
      return nil
    }
    let userHost = value[..<colon]
    let path = value[value.index(after: colon)...]
    guard
      let host = userHost.split(separator: "@").last,
      let repository = repository(fromPath: String(path))
    else {
      return nil
    }
    return Self(host: String(host), owner: repository.owner, repo: repository.repo)
  }

  private static func repository(fromPath path: String) -> (owner: String, repo: String)? {
    let components = path.split(separator: "/").filter { !$0.isEmpty }
    guard components.count >= 2 else { return nil }
    let owner = String(components[components.count - 2])
    var repo = String(components[components.count - 1])
    if repo.hasSuffix(".git") {
      repo.removeLast(4)
    }
    guard !owner.isEmpty, !repo.isEmpty else { return nil }
    return (owner, repo)
  }
}

actor TerminalAgentGithubStatusBatcher {
  typealias Loader =
    @Sendable (TerminalAgentGithubRemote, [String]) async -> [String:
    PaneAgentPullRequestStatus]

  private struct PendingBatch {
    var branchNames: Set<String> = []
    var continuations: [String: [CheckedContinuation<PaneAgentPullRequestStatus, Never>]] = [:]
    var task: Task<Void, Never>?
  }

  private let batchWindow: Duration
  private var pendingBatches: [TerminalAgentGithubRemote: PendingBatch] = [:]

  init(batchWindow: Duration = .milliseconds(50)) {
    self.batchWindow = batchWindow
  }

  func status(
    remote: TerminalAgentGithubRemote,
    branchName: String,
    load: @escaping Loader
  ) async -> PaneAgentPullRequestStatus {
    await withCheckedContinuation { continuation in
      var batch = pendingBatches[remote] ?? PendingBatch()
      batch.branchNames.insert(branchName)
      batch.continuations[branchName, default: []].append(continuation)
      if batch.task == nil {
        batch.task = Task { [batchWindow] in
          if batchWindow != .zero {
            try? await Task.sleep(for: batchWindow)
          }
          await self.flush(remote: remote, load: load)
        }
      }
      pendingBatches[remote] = batch
    }
  }

  private func flush(
    remote: TerminalAgentGithubRemote,
    load: @escaping Loader
  ) async {
    guard let batch = pendingBatches.removeValue(forKey: remote) else { return }
    let branchNames = batch.branchNames.sorted()
    let statuses = await load(remote, branchNames)
    for (branchName, continuations) in batch.continuations {
      let status = statuses[branchName] ?? .unavailable
      for continuation in continuations {
        continuation.resume(returning: status)
      }
    }
  }
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
  let statusBatcher: TerminalAgentGithubStatusBatcher
  private let pullRequestStatusProvider: (@Sendable (URL, String) async -> PaneAgentPullRequestStatus)?

  init(
    runner: TerminalAgentPanelCommandRunner = .live,
    resolver: TerminalAgentGithubExecutableResolver = TerminalAgentGithubExecutableResolver(),
    statusBatcher: TerminalAgentGithubStatusBatcher = TerminalAgentGithubStatusBatcher()
  ) {
    self.runner = runner
    self.resolver = resolver
    self.statusBatcher = statusBatcher
    pullRequestStatusProvider = nil
  }

  init(
    pullRequestStatus: @escaping @Sendable (URL, String) async -> PaneAgentPullRequestStatus
  ) {
    runner = .live
    resolver = TerminalAgentGithubExecutableResolver()
    statusBatcher = TerminalAgentGithubStatusBatcher()
    pullRequestStatusProvider = pullRequestStatus
  }

  nonisolated func pullRequestStatus(
    repoRoot: URL,
    branchName: String,
    remoteURL: String?
  ) async -> PaneAgentPullRequestStatus {
    if let pullRequestStatusProvider {
      return await pullRequestStatusProvider(repoRoot, branchName)
    }
    guard let remote = remoteURL.flatMap(TerminalAgentGithubRemote.init(remoteURL:)) else {
      return .unavailable
    }
    return await statusBatcher.status(remote: remote, branchName: branchName) { remote, branchNames in
      await fetchPullRequestStatuses(remote: remote, branchNames: branchNames)
    }
  }

  nonisolated private func fetchPullRequestStatuses(
    remote: TerminalAgentGithubRemote,
    branchNames: [String]
  ) async -> [String: PaneAgentPullRequestStatus] {
    let chunks = Self.chunks(branchNames, size: Self.pullRequestBatchChunkSize)
    return await withTaskGroup(of: [String: PaneAgentPullRequestStatus].self) { group in
      var nextIndex = 0
      let initialCount = min(Self.pullRequestBatchMaxConcurrentRequests, chunks.count)
      while nextIndex < initialCount {
        let chunk = chunks[nextIndex]
        group.addTask {
          await fetchPullRequestStatusChunk(remote: remote, branchNames: chunk)
        }
        nextIndex += 1
      }

      var statuses: [String: PaneAgentPullRequestStatus] = [:]
      while let chunkStatuses = await group.next() {
        statuses.merge(chunkStatuses) { _, new in new }
        guard nextIndex < chunks.count else { continue }
        let chunk = chunks[nextIndex]
        group.addTask {
          await fetchPullRequestStatusChunk(remote: remote, branchNames: chunk)
        }
        nextIndex += 1
      }
      return statuses
    }
  }

  nonisolated private func fetchPullRequestStatusChunk(
    remote: TerminalAgentGithubRemote,
    branchNames: [String]
  ) async -> [String: PaneAgentPullRequestStatus] {
    let (query, aliasMap) = Self.makeBatchPullRequestQuery(branchNames: branchNames)
    guard
      let output = await runPullRequestQuery(remote: remote, query: query)
    else {
      return Self.unavailableStatuses(for: branchNames)
    }
    return Self.decodePullRequestStatuses(
      output,
      aliasMap: aliasMap,
      remote: remote
    )
  }

  nonisolated private func runPullRequestQuery(
    remote: TerminalAgentGithubRemote,
    query: String
  ) async -> String? {
    let arguments = [
      "api",
      "graphql",
      "--hostname",
      remote.host,
      "-f",
      "query=\(query)",
      "-f",
      "owner=\(remote.owner)",
      "-f",
      "repo=\(remote.repo)",
    ]
    guard let result = try? await runGh(arguments: arguments, repoRoot: nil) else {
      return nil
    }
    if result.status == 0 {
      return result.stdout
    }
    guard Self.isGatewayTimeout(result) else {
      return nil
    }
    try? await Task.sleep(for: Self.pullRequestGatewayRetryBackoff)
    guard
      let retryResult = try? await runGh(arguments: arguments, repoRoot: nil),
      retryResult.status == 0
    else {
      return nil
    }
    return retryResult.stdout
  }

  nonisolated private static func unavailableStatuses(
    for branchNames: [String]
  ) -> [String: PaneAgentPullRequestStatus] {
    Dictionary(uniqueKeysWithValues: branchNames.map { ($0, PaneAgentPullRequestStatus.unavailable) })
  }

  nonisolated private static func resolvedMissingStatus(
    remote: TerminalAgentGithubRemote,
    branchName: String
  ) -> PaneAgentPullRequestStatus {
    PaneAgentPullRequestStatus.createPullRequest(
      url: remote.createPullRequestURL(branchName: branchName)
    )
  }

  nonisolated private static func isGatewayTimeout(_ result: TerminalAgentPanelCommandResult) -> Bool {
    let output = "\(result.stdout)\n\(result.stderr)".lowercased()
    return output.contains("504") || output.contains("gateway timeout")
  }

  nonisolated private static func chunks(
    _ values: [String],
    size: Int
  ) -> [[String]] {
    guard size > 0 else { return [values] }
    var result: [[String]] = []
    var index = values.startIndex
    while index < values.endIndex {
      let endIndex = values.index(index, offsetBy: size, limitedBy: values.endIndex) ?? values.endIndex
      result.append(Array(values[index..<endIndex]))
      index = endIndex
    }
    return result
  }

  nonisolated private static func makeBatchPullRequestQuery(
    branchNames: [String]
  ) -> (query: String, aliasMap: [String: String]) {
    var aliasMap: [String: String] = [:]
    var selections: [String] = []
    for (index, branchName) in branchNames.enumerated() {
      let alias = "branch\(index)"
      aliasMap[alias] = branchName
      let escapedBranchName = escapeGraphQLString(branchName)
      selections.append(
        """
        \(alias): pullRequests(
          first: 1
          states: [OPEN, MERGED, CLOSED]
          headRefName: "\(escapedBranchName)"
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
                    contexts(first: 100) {
                      totalCount
                      nodes {
                        __typename
                        ... on CheckRun {
                          name
                          status
                          conclusion
                          startedAt
                          completedAt
                          detailsUrl
                          url
                          checkSuite {
                            workflowRun {
                              workflow {
                                name
                              }
                            }
                          }
                        }
                        ... on StatusContext {
                          context
                          state
                          targetUrl
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
      )
    }
    let selectionBlock = selections.joined(separator: "\n")
    let query = """
      query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
      \(selectionBlock)
        }
      }
      """
    return (query, aliasMap)
  }

  nonisolated private static func escapeGraphQLString(_ value: String) -> String {
    value
      .replacingOccurrences(of: "\\", with: "\\\\")
      .replacingOccurrences(of: "\"", with: "\\\"")
      .replacingOccurrences(of: "\n", with: "\\n")
      .replacingOccurrences(of: "\r", with: "\\r")
      .replacingOccurrences(of: "\t", with: "\\t")
  }

  nonisolated static func decodePullRequestStatuses(
    _ output: String,
    aliasMap: [String: String],
    remote: TerminalAgentGithubRemote
  ) -> [String: PaneAgentPullRequestStatus] {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    guard
      let response = try? decoder.decode(GithubPullRequestBatchResponse.self, from: Data(output.utf8))
    else {
      return unavailableStatuses(for: Array(aliasMap.values))
    }
    var statuses: [String: PaneAgentPullRequestStatus] = [:]
    for (alias, branchName) in aliasMap {
      guard let node = response.data.repository[alias]?.nodes.first else {
        statuses[branchName] = resolvedMissingStatus(remote: remote, branchName: branchName)
        continue
      }
      statuses[branchName] = status(from: node)
    }
    return statuses
  }

  nonisolated static func decodePullRequestStatus(_ output: String) -> PaneAgentPullRequestStatus {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    guard
      let response = try? decoder.decode(GithubPullRequestResponse.self, from: Data(output.utf8))
    else {
      return .unavailable
    }
    guard let node = response.data.repository.pullRequests.nodes.first else {
      return .none
    }
    return status(from: node)
  }

  nonisolated private static func status(
    from node: GithubPullRequestNodeResponse
  ) -> PaneAgentPullRequestStatus {
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
      title: "#\(node.number)",
      url: URL(string: node.url),
      addedLineCount: node.additions,
      removedLineCount: node.deletions,
      checks: Self.checks(from: node)
    )
  }

  private static let pullRequestBatchChunkSize = 5
  private static let pullRequestBatchMaxConcurrentRequests = 3
  private static let pullRequestGatewayRetryBackoff: Duration = .seconds(1)

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
        state: checkRunState(status: node.status, conclusion: node.conclusion),
        workflowName: node.checkSuite?.workflowRun?.workflow?.name,
        startedAt: node.startedAt,
        completedAt: node.completedAt,
        url: webURL(node.detailsUrl) ?? webURL(node.url)
      )
    case "StatusContext":
      guard let name = normalizedCheckName(node.context) else { return nil }
      return PaneAgentPullRequestCheck(
        name: name,
        state: statusContextState(node.state),
        url: webURL(node.targetUrl)
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

  nonisolated private static func webURL(_ value: String?) -> URL? {
    guard let value = normalizedCheckName(value) else { return nil }
    return URL(string: value)
  }

  nonisolated private static func checkRunState(
    status: String?,
    conclusion: String?
  ) -> PaneAgentPullRequestCheck.State {
    if status == "COMPLETED" {
      return conclusion.flatMap { checkRunConclusionStates[$0] } ?? .failure
    }
    return status.flatMap { checkRunStatusStates[$0] } ?? .unavailable
  }

  nonisolated private static func statusContextState(
    _ state: String?
  ) -> PaneAgentPullRequestCheck.State {
    state.flatMap { statusContextStates[$0] } ?? .pending
  }

  private static let checkRunStatusStates: [String: PaneAgentPullRequestCheck.State] = [
    "IN_PROGRESS": .inProgress,
    "QUEUED": .queued,
    "WAITING": .waiting,
    "REQUESTED": .requested,
    "PENDING": .pending,
  ]

  private static let checkRunConclusionStates: [String: PaneAgentPullRequestCheck.State] = [
    "SUCCESS": .success,
    "FAILURE": .failure,
    "NEUTRAL": .neutral,
    "SKIPPED": .skipped,
    "CANCELLED": .cancelled,
    "TIMED_OUT": .timedOut,
    "ACTION_REQUIRED": .actionRequired,
    "STALE": .stale,
    "STARTUP_FAILURE": .startupFailure,
  ]

  private static let statusContextStates: [String: PaneAgentPullRequestCheck.State] = [
    "SUCCESS": .success,
    "FAILURE": .failure,
    "ERROR": .error,
  ]

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
}

nonisolated private struct GithubPullRequestBatchResponse: Decodable {
  let data: GithubPullRequestBatchDataResponse
}

nonisolated private struct GithubPullRequestBatchDataResponse: Decodable {
  let repository: [String: GithubPullRequestConnectionResponse]
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
  let startedAt: Date?
  let completedAt: Date?
  let detailsUrl: String?
  let url: String?
  let targetUrl: String?
  let checkSuite: GithubPRCheckSuiteResponse?
  let state: String?

  enum CodingKeys: String, CodingKey {
    case typename = "__typename"
    case name
    case context
    case status
    case conclusion
    case startedAt
    case completedAt
    case detailsUrl
    case url
    case targetUrl
    case checkSuite
    case state
  }
}

nonisolated private struct GithubPRCheckSuiteResponse: Decodable {
  let workflowRun: GithubPRWorkflowRunResponse?
}

nonisolated private struct GithubPRWorkflowRunResponse: Decodable {
  let workflow: GithubPRWorkflowResponse?
}

nonisolated private struct GithubPRWorkflowResponse: Decodable {
  let name: String?
}

@MainActor
final class PaneAgentPortScanner {
  typealias Delivery = @MainActor (UUID, [PaneAgentArtifact]) -> Void

  private let runner: TerminalAgentPanelCommandRunner
  private let interval: Duration
  private var processIDsBySurfaceID: [UUID: Set<Int>] = [:]
  private var artifactsBySurfaceID: [UUID: [PaneAgentArtifact]] = [:]
  private var scanTask: Task<Void, Never>?
  private var delivery: Delivery?

  init(
    runner: TerminalAgentPanelCommandRunner = .live,
    interval: Duration = .seconds(10)
  ) {
    self.runner = runner
    self.interval = interval
  }

  func update(
    surfaceID: UUID,
    processIDs: Set<Int32>,
    deliver: @escaping Delivery
  ) {
    let normalizedProcessIDs = Set(processIDs.map(Int.init).filter { $0 > 0 })
    delivery = deliver
    guard !normalizedProcessIDs.isEmpty else {
      clear(surfaceID: surfaceID, deliver: deliver)
      return
    }
    guard processIDsBySurfaceID[surfaceID] != normalizedProcessIDs else {
      startLoop()
      return
    }
    processIDsBySurfaceID[surfaceID] = normalizedProcessIDs
    startLoop()
  }

  func clear(surfaceID: UUID, deliver: Delivery? = nil) {
    let wasTracked = processIDsBySurfaceID.removeValue(forKey: surfaceID) != nil
    let hadArtifacts = artifactsBySurfaceID.removeValue(forKey: surfaceID) != nil
    if wasTracked || hadArtifacts {
      (deliver ?? delivery)?(surfaceID, [])
    }
    stopLoopIfIdle()
  }

  func stop() {
    processIDsBySurfaceID.removeAll()
    artifactsBySurfaceID.removeAll()
    scanTask?.cancel()
    scanTask = nil
    delivery = nil
  }

  @discardableResult
  func scanOnce() async -> Bool {
    let rootProcessIDsBySurfaceID = processIDsBySurfaceID
    guard !rootProcessIDsBySurfaceID.isEmpty else {
      stopLoopIfIdle()
      return false
    }
    let portsBySurfaceID = await Self.scanPorts(
      rootProcessIDsBySurfaceID: rootProcessIDsBySurfaceID,
      runner: runner
    )
    var delivered = false
    let surfaceIDs = rootProcessIDsBySurfaceID.keys.sorted { $0.uuidString < $1.uuidString }
    for surfaceID in surfaceIDs {
      guard
        processIDsBySurfaceID[surfaceID] == rootProcessIDsBySurfaceID[surfaceID]
      else {
        continue
      }
      let artifacts = Self.artifacts(for: portsBySurfaceID[surfaceID] ?? [])
      guard artifactsBySurfaceID[surfaceID, default: []] != artifacts else { continue }
      artifactsBySurfaceID[surfaceID] = artifacts
      delivery?(surfaceID, artifacts)
      delivered = true
    }
    return delivered
  }

  private func startLoop() {
    guard scanTask == nil else { return }
    let interval = self.interval
    scanTask = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: interval)
        guard !Task.isCancelled else { return }
        await self?.scanOnce()
      }
    }
  }

  private func stopLoopIfIdle() {
    guard processIDsBySurfaceID.isEmpty else { return }
    scanTask?.cancel()
    scanTask = nil
  }

  nonisolated static func scanPorts(
    rootProcessIDsBySurfaceID: [UUID: Set<Int>],
    runner: TerminalAgentPanelCommandRunner
  ) async -> [UUID: [Int]] {
    let rootProcessIDs = rootProcessIDsBySurfaceID.values.reduce(into: Set<Int>()) {
      $0.formUnion($1)
    }
    guard !rootProcessIDs.isEmpty else {
      return [:]
    }
    guard
      let psResult = try? await runner.run(
        URL(fileURLWithPath: "/bin/ps"),
        ["-ax", "-o", "pid=,ppid="],
        nil
      )
    else {
      return [:]
    }
    let parentByPID = parentMap(fromPSOutput: psResult.stdout)
    let descendantProcessIDsBySurfaceID = rootProcessIDsBySurfaceID.mapValues { rootProcessIDs in
      expandProcessTree(rootProcessIDs: rootProcessIDs, parentByPID: parentByPID)
    }
    let processIDs = descendantProcessIDsBySurfaceID.values.reduce(into: Set<Int>()) {
      $0.formUnion($1)
    }
    guard !processIDs.isEmpty else {
      return [:]
    }
    let pids = processIDs.sorted().map(String.init).joined(separator: ",")
    guard
      let lsofResult = try? await runner.run(
        URL(fileURLWithPath: "/usr/sbin/lsof"),
        ["-nP", "-a", "-p", pids, "-iTCP", "-sTCP:LISTEN", "-Fpn"],
        nil
      )
    else {
      return [:]
    }
    let portsByPID = ports(fromLsofOutput: lsofResult.stdout)
    return descendantProcessIDsBySurfaceID.mapValues { processIDs in
      Array(Set(processIDs.flatMap { portsByPID[$0] ?? [] })).sorted()
    }
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
  private var workspaceKeysBySurfaceID: [UUID: TerminalAgentPanelWorkspaceKey] = [:]
  private var surfaceIDsByWorkspaceKey: [TerminalAgentPanelWorkspaceKey: Set<UUID>] = [:]
  private var workspaceRevisions: [TerminalAgentPanelWorkspaceKey: UInt64] = [:]
  private var branchDetailsByWorkspaceKey: [TerminalAgentPanelWorkspaceKey: PaneAgentBranchDetails] = [:]
  private var refreshTasks: [TerminalAgentPanelWorkspaceKey: Task<Void, Never>] = [:]
  private var periodicTasks: [TerminalAgentPanelWorkspaceKey: Task<Void, Never>] = [:]
  private var branchDebounceTasks: [TerminalAgentPanelWorkspaceKey: Task<Void, Never>] = [:]
  private var filesDebounceTasks: [TerminalAgentPanelWorkspaceKey: Task<Void, Never>] = [:]
  private var headWatchers: [TerminalAgentPanelWorkspaceKey: HeadWatcher] = [:]

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
    #if SUPATERM_DEMO
      guard !DemoSeed.preservesSeededAgentState(surfaceID) else { return }
    #endif
    let context = terminal?.agentPanelRefreshContext(for: surfaceID)
    updatePortTracking(surfaceID, context: context)
    guard let workspaceKey = updateWorkspaceTracking(surfaceID, context: context) else {
      _ = terminal?.storeAgentPanelBranchDetails(nil, for: surfaceID)
      return
    }
    scheduleRefresh(workspaceKey, delay: .zero)
    schedulePeriodicRefresh(workspaceKey)
  }

  func surfacePathChanged(_ surfaceID: UUID) {
    #if SUPATERM_DEMO
      guard !DemoSeed.preservesSeededAgentState(surfaceID) else { return }
    #endif
    guard
      let workspaceKey = updateWorkspaceTracking(
        surfaceID,
        context: terminal?.agentPanelRefreshContext(for: surfaceID)
      )
    else {
      _ = terminal?.storeAgentPanelBranchDetails(nil, for: surfaceID)
      return
    }
    scheduleRefresh(workspaceKey, delay: .milliseconds(200))
    schedulePeriodicRefresh(workspaceKey)
  }

  func surfaceAgentStateChanged(_ surfaceID: UUID) {
    #if SUPATERM_DEMO
      guard !DemoSeed.preservesSeededAgentState(surfaceID) else { return }
    #endif
    let context = terminal?.agentPanelRefreshContext(for: surfaceID)
    updatePortTracking(surfaceID, context: context)
    guard let workspaceKey = updateWorkspaceTracking(surfaceID, context: context) else {
      _ = terminal?.storeAgentPanelBranchDetails(nil, for: surfaceID)
      if context == nil {
        _ = terminal?.clearAgentPanelMetadata(for: surfaceID)
      }
      return
    }
    scheduleRefresh(workspaceKey, delay: .milliseconds(200))
    schedulePeriodicRefresh(workspaceKey)
  }

  func surfaceCommandFinished(_ surfaceID: UUID) {
    #if SUPATERM_DEMO
      guard !DemoSeed.preservesSeededAgentState(surfaceID) else { return }
    #endif
    clearSurface(surfaceID)
  }

  func surfaceRemoved(_ surfaceID: UUID) {
    clearSurface(surfaceID)
  }

  func stop() {
    for surfaceID in Set(workspaceKeysBySurfaceID.keys) {
      clearSurface(surfaceID)
    }
    for workspaceKey in Set(workspaceRevisions.keys)
      .union(refreshTasks.keys)
      .union(periodicTasks.keys)
      .union(headWatchers.keys)
    {
      clearWorkspace(workspaceKey)
    }
    portScanner.stop()
  }

  private func schedulePeriodicRefresh(_ workspaceKey: TerminalAgentPanelWorkspaceKey) {
    guard periodicTasks[workspaceKey] == nil else { return }
    periodicTasks[workspaceKey] = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(30))
        guard !Task.isCancelled else { return }
        self?.scheduleRefresh(workspaceKey, delay: .zero)
      }
    }
  }

  private func scheduleRefresh(
    _ workspaceKey: TerminalAgentPanelWorkspaceKey,
    delay: Duration
  ) {
    guard terminal?.agentPanelIsEnabled == true else {
      clearDisabledWorkspace(workspaceKey)
      return
    }
    guard surfaceIDsByWorkspaceKey[workspaceKey]?.isEmpty == false else { return }
    refreshTasks.removeValue(forKey: workspaceKey)?.cancel()
    let revision = touch(workspaceKey)
    refreshTasks[workspaceKey] = Task { [weak self] in
      if delay != .zero {
        try? await Task.sleep(for: delay)
      }
      guard !Task.isCancelled else { return }
      await self?.refresh(workspaceKey: workspaceKey, revision: revision)
    }
  }

  private func refresh(
    workspaceKey: TerminalAgentPanelWorkspaceKey,
    revision: UInt64
  ) async {
    guard terminal?.agentPanelIsEnabled == true else {
      clearDisabledWorkspace(workspaceKey)
      return
    }
    let workingDirectoryPath = workspaceKey.workingDirectoryPath
    let gitSnapshot = await gitClient.snapshot(workingDirectoryPath: workingDirectoryPath)
    let branchDetails: PaneAgentBranchDetails?
    if let gitSnapshot {
      let pullRequestStatus = await githubClient.pullRequestStatus(
        repoRoot: gitSnapshot.repoRoot,
        branchName: gitSnapshot.branchName,
        remoteURL: gitSnapshot.remoteURL
      )
      branchDetails = PaneAgentBranchDetails(
        branchName: gitSnapshot.branchName,
        addedLineCount: pullRequestStatus.addedLineCount ?? gitSnapshot.addedLineCount,
        removedLineCount: pullRequestStatus.removedLineCount ?? gitSnapshot.removedLineCount,
        pullRequestStatus: pullRequestStatus
      )
    } else {
      branchDetails = nil
    }
    await MainActor.run {
      guard self.workspaceRevisions[workspaceKey] == revision else {
        return
      }
      self.storeBranchDetails(branchDetails, workspaceKey: workspaceKey, revision: revision)
      self.configureHeadWatcher(workspaceKey: workspaceKey, headURL: gitSnapshot?.headURL)
    }
  }

  private func updatePortTracking(
    _ surfaceID: UUID,
    context: TerminalAgentPanelRefreshContext?
  ) {
    guard let context else {
      portScanner.clear(surfaceID: surfaceID) { [weak self] surfaceID, artifacts in
        self?.storeArtifacts(artifacts, surfaceID: surfaceID)
      }
      return
    }
    portScanner.update(
      surfaceID: surfaceID,
      processIDs: context.processIDs
    ) { [weak self] surfaceID, artifacts in
      self?.storeArtifacts(artifacts, surfaceID: surfaceID)
    }
  }

  private func storeBranchDetails(
    _ branchDetails: PaneAgentBranchDetails?,
    workspaceKey: TerminalAgentPanelWorkspaceKey,
    revision: UInt64
  ) {
    guard workspaceRevisions[workspaceKey] == revision else {
      return
    }
    if let branchDetails {
      branchDetailsByWorkspaceKey[workspaceKey] = branchDetails
    } else {
      branchDetailsByWorkspaceKey.removeValue(forKey: workspaceKey)
    }
    for surfaceID in surfaceIDsByWorkspaceKey[workspaceKey] ?? [] {
      _ = terminal?.storeAgentPanelBranchDetails(branchDetails, for: surfaceID)
    }
  }

  private func storeArtifacts(
    _ artifacts: [PaneAgentArtifact],
    surfaceID: UUID
  ) {
    _ = terminal?.storeAgentPanelArtifacts(artifacts, for: surfaceID)
  }

  @discardableResult
  private func touch(_ workspaceKey: TerminalAgentPanelWorkspaceKey) -> UInt64 {
    let revision = (workspaceRevisions[workspaceKey] ?? 0) &+ 1
    workspaceRevisions[workspaceKey] = revision
    return revision
  }

  private func clearSurface(_ surfaceID: UUID) {
    removeWorkspaceTracking(surfaceID)
    portScanner.clear(surfaceID: surfaceID)
  }

  @discardableResult
  private func updateWorkspaceTracking(
    _ surfaceID: UUID,
    context: TerminalAgentPanelRefreshContext?
  ) -> TerminalAgentPanelWorkspaceKey? {
    guard
      let workspaceKey = TerminalAgentPanelWorkspaceKey(
        workingDirectoryPath: context?.workingDirectoryPath
      )
    else {
      removeWorkspaceTracking(surfaceID)
      return nil
    }
    if workspaceKeysBySurfaceID[surfaceID] == workspaceKey {
      surfaceIDsByWorkspaceKey[workspaceKey, default: []].insert(surfaceID)
      if let branchDetails = branchDetailsByWorkspaceKey[workspaceKey] {
        _ = terminal?.storeAgentPanelBranchDetails(branchDetails, for: surfaceID)
      }
      return workspaceKey
    }
    if workspaceKeysBySurfaceID[surfaceID] != nil {
      _ = terminal?.storeAgentPanelBranchDetails(nil, for: surfaceID)
    }
    removeWorkspaceTracking(surfaceID)
    workspaceKeysBySurfaceID[surfaceID] = workspaceKey
    surfaceIDsByWorkspaceKey[workspaceKey, default: []].insert(surfaceID)
    if workspaceRevisions[workspaceKey] == nil {
      workspaceRevisions[workspaceKey] = 0
    }
    if let branchDetails = branchDetailsByWorkspaceKey[workspaceKey] {
      _ = terminal?.storeAgentPanelBranchDetails(branchDetails, for: surfaceID)
    }
    return workspaceKey
  }

  private func removeWorkspaceTracking(_ surfaceID: UUID) {
    guard let workspaceKey = workspaceKeysBySurfaceID.removeValue(forKey: surfaceID) else {
      return
    }
    surfaceIDsByWorkspaceKey[workspaceKey]?.remove(surfaceID)
    guard surfaceIDsByWorkspaceKey[workspaceKey]?.isEmpty != false else {
      return
    }
    surfaceIDsByWorkspaceKey.removeValue(forKey: workspaceKey)
    clearWorkspace(workspaceKey)
  }

  private func clearWorkspace(_ workspaceKey: TerminalAgentPanelWorkspaceKey) {
    workspaceRevisions.removeValue(forKey: workspaceKey)
    branchDetailsByWorkspaceKey.removeValue(forKey: workspaceKey)
    refreshTasks.removeValue(forKey: workspaceKey)?.cancel()
    periodicTasks.removeValue(forKey: workspaceKey)?.cancel()
    branchDebounceTasks.removeValue(forKey: workspaceKey)?.cancel()
    filesDebounceTasks.removeValue(forKey: workspaceKey)?.cancel()
    stopHeadWatcher(workspaceKey)
  }

  private func clearDisabledWorkspace(_ workspaceKey: TerminalAgentPanelWorkspaceKey) {
    for surfaceID in surfaceIDsByWorkspaceKey[workspaceKey] ?? [] {
      _ = terminal?.storeAgentPanelBranchDetails(nil, for: surfaceID)
      _ = terminal?.storeAgentPanelArtifacts([], for: surfaceID)
    }
    clearWorkspace(workspaceKey)
  }

  private func configureHeadWatcher(
    workspaceKey: TerminalAgentPanelWorkspaceKey,
    headURL: URL?
  ) {
    guard let headURL else {
      stopHeadWatcher(workspaceKey)
      return
    }
    if headWatchers[workspaceKey]?.headURL == headURL {
      return
    }
    stopHeadWatcher(workspaceKey)
    let path = headURL.path(percentEncoded: false)
    let descriptor = open(path, O_EVTONLY)
    guard descriptor >= 0 else {
      return
    }
    let source = DispatchSource.makeFileSystemObjectSource(
      fileDescriptor: descriptor,
      eventMask: [.write, .rename, .delete, .attrib],
      queue: DispatchQueue(label: "terminal-agent-panel-head.\(workspaceKey.hashValue)")
    )
    source.setEventHandler { @Sendable [weak self, weak source] in
      guard let source else { return }
      let event = source.data
      Task { @MainActor in
        self?.handleHeadEvent(workspaceKey: workspaceKey, event: event)
      }
    }
    source.setCancelHandler { @Sendable in
      close(descriptor)
    }
    source.resume()
    headWatchers[workspaceKey] = HeadWatcher(headURL: headURL, source: source)
  }

  private func handleHeadEvent(
    workspaceKey: TerminalAgentPanelWorkspaceKey,
    event: DispatchSource.FileSystemEvent
  ) {
    if event.contains(.delete) || event.contains(.rename) {
      stopHeadWatcher(workspaceKey)
    }
    branchDebounceTasks.removeValue(forKey: workspaceKey)?.cancel()
    branchDebounceTasks[workspaceKey] = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(200))
      self?.scheduleRefresh(workspaceKey, delay: .zero)
    }
    filesDebounceTasks.removeValue(forKey: workspaceKey)?.cancel()
    filesDebounceTasks[workspaceKey] = Task { [weak self] in
      try? await Task.sleep(for: .seconds(5))
      self?.scheduleRefresh(workspaceKey, delay: .zero)
    }
  }

  private func stopHeadWatcher(_ workspaceKey: TerminalAgentPanelWorkspaceKey) {
    headWatchers.removeValue(forKey: workspaceKey)?.source.cancel()
  }
}

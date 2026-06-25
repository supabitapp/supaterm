import Foundation

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
    let branchNames = batch.continuations.keys.sorted()
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
    remote: TerminalAgentGithubRemote?
  ) async -> PaneAgentPullRequestStatus {
    if let pullRequestStatusProvider {
      return await pullRequestStatusProvider(repoRoot, branchName)
    }
    guard let remote else {
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

}

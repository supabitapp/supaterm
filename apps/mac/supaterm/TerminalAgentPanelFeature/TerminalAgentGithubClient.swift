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
    let output = result.stderr.lowercased()
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
          first: 5
          states: [OPEN, MERGED]
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
            updatedAt
            baseRefName
            headRepository {
              name
              owner { login }
            }
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
      guard
        let nodes = response.data.repository[alias].flatMap({ $0 })?.nodes,
        let node = bestPullRequestNode(nodes, branchName: branchName, remote: remote)
      else {
        statuses[branchName] = resolvedMissingStatus(remote: remote, branchName: branchName)
        continue
      }
      statuses[branchName] = status(from: node)
    }
    return statuses
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

  nonisolated private static func bestPullRequestNode(
    _ nodes: [GithubPullRequestNodeResponse],
    branchName: String,
    remote: TerminalAgentGithubRemote
  ) -> GithubPullRequestNodeResponse? {
    let upstreamCandidates = nodes.filter { $0.headRepositoryMatches(remote: remote) }
    let forkCandidates = nodes.filter {
      $0.headRepository != nil && $0.baseRefNameDiffers(from: branchName)
    }
    let deletedForkCandidates = nodes.filter {
      $0.headRepository == nil && $0.baseRefNameDiffers(from: branchName)
    }
    let candidates =
      if !upstreamCandidates.isEmpty {
        upstreamCandidates
      } else if !forkCandidates.isEmpty {
        forkCandidates
      } else {
        deletedForkCandidates
      }
    return candidates.max { lhs, rhs in
      if lhs.stateRank != rhs.stateRank {
        return lhs.stateRank < rhs.stateRank
      }
      let lhsUpdatedAt = lhs.updatedAt ?? .distantPast
      let rhsUpdatedAt = rhs.updatedAt ?? .distantPast
      if lhsUpdatedAt != rhsUpdatedAt {
        return lhsUpdatedAt < rhsUpdatedAt
      }
      return lhs.number < rhs.number
    }
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
  let repository: [String: GithubPullRequestConnectionResponse?]
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
  let updatedAt: Date?
  let baseRefName: String?
  let headRepository: GithubPRHeadRepositoryResponse?
  let commits: GithubPRCommitConnectionResponse

  var stateRank: Int {
    switch state {
    case "OPEN":
      return 2
    case "MERGED":
      return 1
    default:
      return 0
    }
  }

  func headRepositoryMatches(remote: TerminalAgentGithubRemote) -> Bool {
    guard let headRepository else { return false }
    return headRepository.name.lowercased() == remote.repo.lowercased()
      && headRepository.owner.login.lowercased() == remote.owner.lowercased()
  }

  func baseRefNameDiffers(from branchName: String) -> Bool {
    guard let baseRefName else { return false }
    return baseRefName.lowercased() != branchName.lowercased()
  }
}

nonisolated private struct GithubPRHeadRepositoryResponse: Decodable {
  let name: String
  let owner: GithubPRHeadRepositoryOwnerResponse
}

nonisolated private struct GithubPRHeadRepositoryOwnerResponse: Decodable {
  let login: String
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

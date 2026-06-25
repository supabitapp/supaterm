import Foundation

extension TerminalAgentGithubClient {
  nonisolated static func unavailableStatuses(
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

  nonisolated static func isGatewayTimeout(_ result: TerminalAgentPanelCommandResult) -> Bool {
    let output = result.stderr.lowercased()
    return output.contains("504") || output.contains("gateway timeout")
  }

  nonisolated static func chunks(
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

  nonisolated static func makeBatchPullRequestQuery(
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
      return conclusion.map(checkRunConclusionState) ?? .failure
    }
    return status.map(checkRunStatusState) ?? .unavailable
  }

  nonisolated private static func statusContextState(
    _ state: String?
  ) -> PaneAgentPullRequestCheck.State {
    guard let state else { return .pending }
    switch state {
    case "SUCCESS":
      return .success
    case "FAILURE":
      return .failure
    case "ERROR":
      return .error
    default:
      return .pending
    }
  }

  nonisolated private static func checkRunStatusState(
    _ status: String
  ) -> PaneAgentPullRequestCheck.State {
    switch status {
    case "IN_PROGRESS":
      return .inProgress
    case "QUEUED":
      return .queued
    case "WAITING":
      return .waiting
    case "REQUESTED":
      return .requested
    case "PENDING":
      return .pending
    default:
      return .unavailable
    }
  }

  nonisolated private static func checkRunConclusionState(
    _ conclusion: String
  ) -> PaneAgentPullRequestCheck.State {
    switch conclusion {
    case "SUCCESS":
      return .success
    case "FAILURE":
      return .failure
    case "NEUTRAL":
      return .neutral
    case "SKIPPED":
      return .skipped
    case "CANCELLED":
      return .cancelled
    case "TIMED_OUT":
      return .timedOut
    case "ACTION_REQUIRED":
      return .actionRequired
    case "STALE":
      return .stale
    case "STARTUP_FAILURE":
      return .startupFailure
    default:
      return .failure
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

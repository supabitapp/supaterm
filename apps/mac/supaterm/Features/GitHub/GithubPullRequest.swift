import Foundation

nonisolated struct GithubAuthStatus: Equatable, Sendable {
  let username: String
  let host: String
}

nonisolated struct GithubPullRequest: Decodable, Equatable, Hashable, Sendable {
  let number: Int
  let title: String
  let state: String
  let url: String
  let isDraft: Bool
  let reviewDecision: String?
  let mergeable: String?
  let mergeStateStatus: String?
  let updatedAt: Date?
  let headRefName: String?
  let baseRefName: String?
  let statusCheckRollup: GithubPullRequestStatusCheckRollup?
}

nonisolated struct GithubGraphQLPullRequestResponse: Decodable {
  let data: DataContainer

  func pullRequestsByBranch(
    aliasMap: [String: String],
    owner: String,
    repo: String
  ) -> [String: GithubPullRequest] {
    let normalizedOwner = owner.lowercased()
    let normalizedRepo = repo.lowercased()
    var results: [String: GithubPullRequest] = [:]
    for (alias, connection) in data.repository.pullRequestsByAlias {
      guard
        let branch = aliasMap[alias],
        let node = connection.preferredNode(owner: normalizedOwner, repo: normalizedRepo)
      else {
        continue
      }
      results[branch] = node.pullRequest
    }
    return results
  }

  struct DataContainer: Decodable {
    let repository: Repository
  }

  struct Repository: Decodable {
    let pullRequestsByAlias: [String: PullRequestConnection]

    init(from decoder: Decoder) throws {
      let container = try decoder.container(keyedBy: DynamicKey.self)
      var results: [String: PullRequestConnection] = [:]
      for key in container.allKeys {
        results[key.stringValue] = try container.decode(PullRequestConnection.self, forKey: key)
      }
      pullRequestsByAlias = results
    }
  }

  struct DynamicKey: CodingKey {
    let stringValue: String
    let intValue: Int?

    init?(stringValue: String) {
      self.stringValue = stringValue
      self.intValue = nil
    }

    init?(intValue: Int) {
      self.stringValue = "\(intValue)"
      self.intValue = intValue
    }
  }

  struct PullRequestConnection: Decodable {
    let nodes: [PullRequestNode]

    func preferredNode(owner: String, repo: String) -> PullRequestNode? {
      let matchingNodes = nodes.filter { $0.matches(owner: owner, repo: repo) }
      let candidates = matchingNodes.isEmpty ? nodes.filter(\.hasHeadRepository) : matchingNodes
      return candidates.max(by: { $0.isLowerPriority(than: $1) })
    }
  }

  struct PullRequestNode: Decodable {
    let number: Int
    let title: String
    let state: String
    let isDraft: Bool
    let reviewDecision: String?
    let mergeable: String?
    let mergeStateStatus: String?
    let updatedAt: Date?
    let url: String
    let headRefName: String?
    let baseRefName: String?
    let statusCheckRollup: GithubPullRequestStatusCheckRollup?
    let headRepository: HeadRepository?

    var hasHeadRepository: Bool {
      headRepository != nil
    }

    var pullRequest: GithubPullRequest {
      GithubPullRequest(
        number: number,
        title: title,
        state: state,
        url: url,
        isDraft: isDraft,
        reviewDecision: reviewDecision,
        mergeable: mergeable,
        mergeStateStatus: mergeStateStatus,
        updatedAt: updatedAt,
        headRefName: headRefName,
        baseRefName: baseRefName,
        statusCheckRollup: statusCheckRollup
      )
    }

    var stateRank: Int {
      switch state.uppercased() {
      case "OPEN":
        return 2
      case "MERGED":
        return 1
      default:
        return 0
      }
    }

    func isLowerPriority(than other: PullRequestNode) -> Bool {
      if stateRank != other.stateRank {
        return stateRank < other.stateRank
      }
      let updatedAt = updatedAt ?? .distantPast
      let otherUpdatedAt = other.updatedAt ?? .distantPast
      if updatedAt != otherUpdatedAt {
        return updatedAt < otherUpdatedAt
      }
      return number < other.number
    }

    func matches(owner: String, repo: String) -> Bool {
      guard let headRepository else { return false }
      return headRepository.owner.login.lowercased() == owner
        && headRepository.name.lowercased() == repo
    }
  }

  struct HeadRepository: Decodable {
    let name: String
    let owner: HeadRepositoryOwner
  }

  struct HeadRepositoryOwner: Decodable {
    let login: String
  }
}

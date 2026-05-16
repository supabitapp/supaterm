import Foundation

nonisolated struct PaneAgentPanelPresentation: Equatable, Sendable {
  var progressRows: [PaneAgentProgressRow] = []
  var branchDetails: PaneAgentBranchDetails?
  var artifacts: [PaneAgentArtifact] = []
  var sources: [PaneAgentSource] = []

  var isEmpty: Bool {
    progressRows.isEmpty
      && branchDetails == nil
      && artifacts.isEmpty
      && sources.isEmpty
  }
}

nonisolated struct PaneAgentProgressRow: Equatable, Identifiable, Sendable {
  enum Status: Equatable, Sendable {
    case pending
    case running
    case completed
  }

  let id: String
  let title: String
  let status: Status
}

nonisolated struct PaneAgentBranchDetails: Equatable, Sendable {
  let branchName: String
  let addedLineCount: Int
  let removedLineCount: Int
  let hasWorkingTreeChanges: Bool
  let pullRequestStatus: PaneAgentPullRequestStatus
}

nonisolated struct PaneAgentPullRequestStatus: Equatable, Sendable {
  enum Kind: Equatable, Sendable {
    case unavailable
    case none
    case open
    case draft
    case merged
    case closed
  }

  let kind: Kind
  let title: String
  let url: URL?

  static let unavailable = Self(
    kind: .unavailable,
    title: "Pull request status unavailable",
    url: nil
  )

  static let none = Self(
    kind: .none,
    title: "No pull request",
    url: nil
  )
}

nonisolated struct PaneAgentArtifact: Equatable, Identifiable, Sendable {
  let id: String
  let title: String
  let url: URL

  init(title: String, url: URL) {
    self.id = url.absoluteString
    self.title = title
    self.url = url
  }
}

nonisolated struct PaneAgentSource: Equatable, Identifiable, Sendable {
  enum Kind: Equatable, Sendable {
    case webSearch
  }

  let id: String
  let title: String
  let kind: Kind

  static let webSearch = Self(
    id: "web-search",
    title: "Web search",
    kind: .webSearch
  )
}

import Foundation
import SupatermCLIShared

public nonisolated struct PaneAgentPanelPresentation: Equatable, Sendable {
  public var progressRows: [PaneAgentProgressRow] = []
  public var branchDetails: PaneAgentBranchDetails?
  public var artifacts: [PaneAgentArtifact] = []
  public var session: PaneAgentPanelSession?

  public var isEmpty: Bool {
    progressRows.isEmpty
      && branchDetails == nil
      && artifacts.isEmpty
      && session == nil
  }
}

public nonisolated struct PaneAgentPanelSession: Equatable, Sendable {
  public let agent: SupatermAgentKind
  public let sessionID: String

  private init(agent: SupatermAgentKind, sessionID: String) {
    self.agent = agent
    self.sessionID = sessionID
  }

  public static func supported(agent: SupatermAgentKind, sessionID: String) -> Self? {
    switch agent {
    case .claude, .codex:
      break
    case .pi:
      return nil
    }
    let sessionID = sessionID.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !sessionID.isEmpty else {
      return nil
    }
    return Self(agent: agent, sessionID: sessionID)
  }

  public var forkStartupCommand: String {
    SupatermShellCommand.interactiveStartupCommand(for: forkCommand)
  }

  private var forkCommand: String {
    switch agent {
    case .claude:
      return ["claude", "--fork-session", "--resume", sessionID]
        .map(SupatermShellCommand.escapedToken)
        .joined(separator: " ")
    case .codex:
      return ["codex", "fork", sessionID]
        .map(SupatermShellCommand.escapedToken)
        .joined(separator: " ")
    case .pi:
      preconditionFailure("Unsupported agent")
    }
  }
}

public nonisolated struct PaneAgentProgressRow: Equatable, Identifiable, Sendable {
  public enum Status: Equatable, Sendable {
    case pending
    case running
    case completed
  }

  public let id: String
  public let title: String
  public let status: Status

  public init(id: String, title: String, status: Status) {
    self.id = id
    self.title = title
    self.status = status
  }
}

public nonisolated struct PaneAgentBranchDetails: Equatable, Sendable {
  public let branchName: String
  public let addedLineCount: Int
  public let removedLineCount: Int
  public let pullRequestStatus: PaneAgentPullRequestStatus

  public var displayedPullRequestStatus: PaneAgentPullRequestStatus? {
    switch pullRequestStatus.kind {
    case .unavailable:
      nil
    case .none where branchName == "main":
      nil
    case .none, .open, .draft, .merged:
      pullRequestStatus
    }
  }
}

public nonisolated struct PaneAgentPullRequestStatus: Equatable, Sendable {
  public enum Kind: Equatable, Sendable {
    case unavailable
    case none
    case open
    case draft
    case merged
  }

  public let kind: Kind
  public let title: String
  public let url: URL?
  public let addedLineCount: Int?
  public let removedLineCount: Int?
  public let checks: PaneAgentPullRequestChecks?

  static let unavailable = Self(
    kind: .unavailable,
    title: "Pull request status unavailable",
    url: nil,
    addedLineCount: nil,
    removedLineCount: nil,
    checks: nil
  )

  static func createPullRequest(url: URL?) -> Self {
    Self(
      kind: .none,
      title: "Create pull request",
      url: url,
      addedLineCount: nil,
      removedLineCount: nil,
      checks: nil
    )
  }
}

public nonisolated struct PaneAgentPullRequestChecks: Equatable, Sendable {
  public enum Status: Equatable, Sendable {
    case pending
    case passing
    case failing

  }

  public let status: Status
  public let totalCount: Int
  public let items: [PaneAgentPullRequestCheck]

  init(status: Status, totalCount: Int, items: [PaneAgentPullRequestCheck]) {
    self.status = status
    self.totalCount = totalCount
    self.items = items
  }

  public var isEmpty: Bool {
    totalCount == 0
  }

  public var title: String {
    if totalCount == 0 {
      return "Checks (0)"
    }
    if status == .failing {
      return "Checks failing (\(totalCount))"
    }
    if status == .pending {
      return "Checks pending (\(totalCount))"
    }
    return "Checks passed (\(totalCount))"
  }

  public var itemCounts: [PaneAgentPullRequestCheck.Status: Int] {
    items.reduce(into: [:]) { counts, item in
      counts[item.status, default: 0] += 1
    }
  }
}

public nonisolated struct PaneAgentPullRequestCheck: Equatable, Identifiable, Sendable {
  public enum Status: Equatable, Hashable, Sendable {
    case pending
    case passing
    case failing
    case skipped
  }

  public enum State: Equatable, Sendable {
    case pending
    case queued
    case waiting
    case requested
    case inProgress
    case success
    case failure
    case error
    case skipped
    case neutral
    case cancelled
    case timedOut
    case actionRequired
    case stale
    case startupFailure
    case unavailable

    init(status: Status) {
      switch status {
      case .pending:
        self = .pending
      case .passing:
        self = .success
      case .failing:
        self = .failure
      case .skipped:
        self = .skipped
      }
    }

    var status: Status {
      switch self {
      case .pending, .queued, .waiting, .requested, .inProgress:
        .pending
      case .success:
        .passing
      case .neutral, .skipped:
        .skipped
      case .failure, .error, .cancelled, .timedOut, .actionRequired, .stale, .startupFailure, .unavailable:
        .failing
      }
    }

    var activeFallback: String? {
      switch self {
      case .pending:
        "Pending"
      case .inProgress:
        "In progress"
      default:
        nil
      }
    }

    var completedDetail: (prefix: String, fallback: String)? {
      switch self {
      case .success:
        ("Successful in", "Successful")
      case .failure:
        ("Failed after", "Failed")
      case .error:
        ("Errored after", "Errored")
      case .neutral:
        ("Neutral after", "Neutral")
      case .cancelled:
        ("Cancelled after", "Cancelled")
      case .timedOut:
        ("Timed out after", "Timed out")
      default:
        nil
      }
    }

    var staticDetailText: String {
      switch self {
      case .queued:
        "Queued"
      case .waiting:
        "Waiting for approval"
      case .requested:
        "Requested"
      case .skipped:
        "Skipped"
      case .actionRequired:
        "Action required"
      case .stale:
        "Stale"
      case .startupFailure:
        "Failed at startup"
      case .unavailable:
        "Status unavailable"
      default:
        "Status unavailable"
      }
    }
  }

  public let id: String
  public let name: String
  public let workflowName: String?
  public let state: State
  public let startedAt: Date?
  public let completedAt: Date?
  public let url: URL?

  public var status: Status {
    state.status
  }

  public var title: String {
    guard let workflowName, workflowName != name else {
      return name
    }
    return "\(workflowName) / \(name)"
  }

  init(name: String, status: Status) {
    self.init(name: name, state: State(status: status))
  }

  init(
    name: String,
    state: State,
    workflowName: String? = nil,
    startedAt: Date? = nil,
    completedAt: Date? = nil,
    url: URL? = nil
  ) {
    let workflowName = Self.normalized(workflowName)
    self.id = [workflowName, name].compactMap(\.self).joined(separator: "/")
    self.name = name
    self.workflowName = workflowName
    self.state = state
    self.startedAt = startedAt
    self.completedAt = completedAt
    self.url = url
  }

  public func detailText(now: Date = Date()) -> String {
    if let activeFallback = state.activeFallback {
      if let startedAt {
        return "Started \(Self.relativeText(from: startedAt, to: now)) ago"
      }
      return activeFallback
    }
    if let completedDetail = state.completedDetail {
      return completedText(completedDetail.prefix, fallback: completedDetail.fallback)
    }
    return state.staticDetailText
  }

  private func completedText(_ prefix: String, fallback: String) -> String {
    guard let startedAt, let completedAt else {
      return fallback
    }
    return "\(prefix) \(Self.durationText(from: startedAt, to: completedAt))"
  }

  private static func normalized(_ value: String?) -> String? {
    guard let value else { return nil }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }

  private static func relativeText(from start: Date, to end: Date) -> String {
    let seconds = max(0, Int(end.timeIntervalSince(start).rounded(.down)))
    if seconds < 60 {
      return seconds == 1 ? "1 second" : "\(seconds) seconds"
    }
    let minutes = seconds / 60
    if minutes < 60 {
      return minutes == 1 ? "1 minute" : "\(minutes) minutes"
    }
    let hours = minutes / 60
    if hours < 24 {
      return hours == 1 ? "1 hour" : "\(hours) hours"
    }
    let days = hours / 24
    return days == 1 ? "1 day" : "\(days) days"
  }

  private static func durationText(from start: Date, to end: Date) -> String {
    let seconds = max(0, Int(end.timeIntervalSince(start).rounded(.down)))
    if seconds < 60 {
      return "\(seconds)s"
    }
    let minutes = seconds / 60
    if minutes < 60 {
      return "\(minutes)m"
    }
    let hours = minutes / 60
    let remainingMinutes = minutes % 60
    if remainingMinutes == 0 {
      return "\(hours)h"
    }
    return "\(hours)h \(remainingMinutes)m"
  }
}

public nonisolated struct PaneAgentArtifact: Equatable, Identifiable, Sendable {
  public let id: String
  public let title: String
  public let url: URL

  init(title: String, url: URL) {
    self.id = url.absoluteString
    self.title = title
    self.url = url
  }
}

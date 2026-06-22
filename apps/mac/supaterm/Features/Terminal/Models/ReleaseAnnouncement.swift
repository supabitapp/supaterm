import Foundation

public nonisolated struct ReleaseAnnouncementVersion: Comparable, Equatable, Hashable, Sendable {
  public let rawValue: String
  private let components: [Int]

  public init?(_ rawValue: String) {
    let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
    let parts = trimmed.split(separator: ".", omittingEmptySubsequences: false)
    let components = parts.compactMap { Int($0) }
    guard !trimmed.isEmpty, components.count == parts.count else { return nil }
    self.rawValue = trimmed
    self.components = components
  }

  public static func < (lhs: Self, rhs: Self) -> Bool {
    let count = max(lhs.components.count, rhs.components.count)
    for index in 0..<count {
      let left = index < lhs.components.count ? lhs.components[index] : 0
      let right = index < rhs.components.count ? rhs.components[index] : 0
      if left != right { return left < right }
    }
    return false
  }
}

public nonisolated struct ReleaseAnnouncement: Equatable, Identifiable, Sendable {
  public let id: AnnouncementID
  public let version: ReleaseAnnouncementVersion
  public let title: String
  public let message: String
  public let footer: String
  public let imageName: String

  public enum AnnouncementID: String, Sendable {
    case agentForking
  }

  public static let agentForking = Self(
    id: .agentForking,
    version: ReleaseAnnouncementVersion("1.3.4")!,
    title: "Fork sessions from the agent panel",
    message: "Forking session is now easier than ever using the agent panel. "
      + "Enable coding agents integration to try it.",
    footer: "Settings → Coding Agents",
    imageName: "git-fork"
  )
}

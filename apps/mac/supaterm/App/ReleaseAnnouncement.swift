import ComposableArchitecture
import Foundation
import SupatermCLIShared
import SupatermSupport

nonisolated struct ReleaseAnnouncementVersion: Comparable, Equatable, Hashable, Sendable {
  let rawValue: String
  private let components: [Int]

  init?(_ rawValue: String) {
    let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
    let parts = trimmed.split(separator: ".", omittingEmptySubsequences: false)
    let components = parts.compactMap { Int($0) }
    guard !trimmed.isEmpty, components.count == parts.count else { return nil }
    self.rawValue = trimmed
    self.components = components
  }

  static func < (lhs: Self, rhs: Self) -> Bool {
    let count = max(lhs.components.count, rhs.components.count)
    for index in 0..<count {
      let left = index < lhs.components.count ? lhs.components[index] : 0
      let right = index < rhs.components.count ? rhs.components[index] : 0
      if left != right { return left < right }
    }
    return false
  }
}

nonisolated struct ReleaseAnnouncement: Equatable, Identifiable, Sendable {
  let id: AnnouncementID
  let version: ReleaseAnnouncementVersion
  let title: String
  let message: String
  let footer: String
  let icon: Icon

  enum AnnouncementID: String, Sendable {
    case agentForking
    case colorTuning
    case finalBeta
  }

  enum Icon: Equatable, Sendable {
    case asset(String)
    case emoji(String)
  }

  static let agentForking = Self(
    id: .agentForking,
    version: ReleaseAnnouncementVersion("1.3.4")!,
    title: "Fork sessions from the agent panel",
    message: "Forking session is now easier than ever using the agent panel. "
      + "Enable coding agents integration to try it.",
    footer: "Settings → Coding Agents",
    icon: .asset("git-fork")
  )

  static let colorTuning = Self(
    id: .colorTuning,
    version: ReleaseAnnouncementVersion("26.1.0")!,
    title: "🎨 Color Tuning",
    message: "The sidebar now reads cleaner in light and dark mode.",
    footer: "Supaterm v26.1.0",
    icon: .asset("AppearanceAuto")
  )

  static let finalBeta = Self(
    id: .finalBeta,
    version: ReleaseAnnouncementVersion("26.3.0")!,
    title: "Final release of Supaterm Beta",
    message: "From Khoi:\n\n"
      + "This is the final release of the Supaterm Beta.\n\n"
      + "Thank you for using it, sharing feedback, and supporting the project throughout this stage. "
      + "I’m genuinely grateful to everyone who has been part of it.\n\n"
      + "The next version will be a complete redesign of the app, with a new UI and a much more polished "
      + "experience. It will be paid software, but beta supporters will receive a license at no cost.\n\n"
      + "Please message @khoiracle on X to claim yours, or if you know me personally, "
      + "reach out in person :D.\n\n"
      + "Thank you again. See you in the next version.",
    footer: "Supaterm v26.3.0",
    icon: .emoji("💙")
  )
}

nonisolated struct ReleaseAnnouncementStorageState: Codable, Equatable, Sendable {
  var acknowledgedVersion: String?
}

nonisolated struct ReleaseAnnouncementSyncResult: Equatable, Sendable {
  var announcement: ReleaseAnnouncement?
  var storageState: ReleaseAnnouncementStorageState
}

nonisolated enum ReleaseAnnouncementCatalog {
  static let firstAnnouncementBaseline = ReleaseAnnouncementVersion("1.3.2")!
  static let announcements: [ReleaseAnnouncement] = [
    .agentForking,
    .colorTuning,
    .finalBeta,
  ]

  static func synchronize(
    currentVersion rawCurrentVersion: String,
    storageState storedState: ReleaseAnnouncementStorageState?,
    hasExistingSupatermState: Bool,
    announcements: [ReleaseAnnouncement] = Self.announcements
  ) -> ReleaseAnnouncementSyncResult {
    guard let currentVersion = ReleaseAnnouncementVersion(rawCurrentVersion) else {
      return ReleaseAnnouncementSyncResult(
        announcement: nil,
        storageState: storedState ?? ReleaseAnnouncementStorageState()
      )
    }

    let state =
      storedState
      ?? initialStorageState(
        currentVersion: currentVersion,
        hasExistingSupatermState: hasExistingSupatermState
      )
    let acknowledgedVersion =
      state.acknowledgedVersion.flatMap(ReleaseAnnouncementVersion.init)
      ?? firstAnnouncementBaseline

    let announcement =
      announcements
      .filter { announcement in
        announcement.version > acknowledgedVersion && announcement.version <= currentVersion
      }
      .max { lhs, rhs in
        if lhs.version == rhs.version { return lhs.id.rawValue < rhs.id.rawValue }
        return lhs.version < rhs.version
      }

    return ReleaseAnnouncementSyncResult(
      announcement: announcement,
      storageState: state
    )
  }

  private static func initialStorageState(
    currentVersion: ReleaseAnnouncementVersion,
    hasExistingSupatermState: Bool
  ) -> ReleaseAnnouncementStorageState {
    let storedVersion =
      hasExistingSupatermState
      ? firstAnnouncementBaseline.rawValue
      : currentVersion.rawValue
    return ReleaseAnnouncementStorageState(
      acknowledgedVersion: storedVersion
    )
  }
}

nonisolated struct ReleaseAnnouncementClient: Sendable {
  var synchronize: @Sendable () -> ReleaseAnnouncement?
  var acknowledge: @Sendable (_ version: String) -> Void
}

extension ReleaseAnnouncementClient: DependencyKey {
  static let liveValue = Self(
    synchronize: {
      let result = ReleaseAnnouncementCatalog.synchronize(
        currentVersion: AppBuild.version,
        storageState: ReleaseAnnouncementStorage.load(),
        hasExistingSupatermState: ReleaseAnnouncementStorage.hasExistingSupatermState()
      )
      ReleaseAnnouncementStorage.save(result.storageState)
      return result.announcement
    },
    acknowledge: { version in
      var state = ReleaseAnnouncementStorage.load() ?? ReleaseAnnouncementStorageState()
      state.acknowledgedVersion = version
      ReleaseAnnouncementStorage.save(state)
    }
  )

  static let testValue = Self(
    synchronize: { nil },
    acknowledge: { _ in }
  )
}

extension DependencyValues {
  var releaseAnnouncementClient: ReleaseAnnouncementClient {
    get { self[ReleaseAnnouncementClient.self] }
    set { self[ReleaseAnnouncementClient.self] = newValue }
  }
}

nonisolated enum ReleaseAnnouncementStorage {
  static func defaultURL(
    homeDirectoryPath: String = NSHomeDirectory(),
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> URL {
    SupatermStateRoot.fileURL(
      "release-announcements.json",
      homeDirectoryPath: homeDirectoryPath,
      environment: environment
    )
  }

  static func load(url: URL = defaultURL()) -> ReleaseAnnouncementStorageState? {
    guard let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(ReleaseAnnouncementStorageState.self, from: data)
  }

  static func save(_ state: ReleaseAnnouncementStorageState, url: URL = defaultURL()) {
    guard let data = try? JSONEncoder.releaseAnnouncement.encode(state) else { return }
    try? FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try? data.write(to: url, options: .atomic)
  }

  static func hasExistingSupatermState(
    homeDirectoryPath: String = NSHomeDirectory(),
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> Bool {
    let urls = [
      SupatermSettings.defaultURL(homeDirectoryPath: homeDirectoryPath, environment: environment),
      SupatermSettings.legacyURL(homeDirectoryPath: homeDirectoryPath, environment: environment),
      TerminalSessionCatalog.defaultURL(homeDirectoryPath: homeDirectoryPath, environment: environment),
      TerminalSpaceCatalog.defaultURL(homeDirectoryPath: homeDirectoryPath, environment: environment),
    ]
    return urls.contains { FileManager.default.fileExists(atPath: $0.path) }
  }
}

extension JSONEncoder {
  fileprivate nonisolated static var releaseAnnouncement: JSONEncoder {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return encoder
  }
}

import ComposableArchitecture
import Foundation
import SupatermCLIShared
import SupatermSupport
import SupatermTerminalFeature

nonisolated struct ReleaseAnnouncementStorageState: Codable, Equatable, Sendable {
  var lastInstalledVersion: String?
  var acknowledgedVersion: String?
}

nonisolated struct ReleaseAnnouncementSyncResult: Equatable, Sendable {
  var announcement: ReleaseAnnouncement?
  var storageState: ReleaseAnnouncementStorageState
}

nonisolated enum ReleaseAnnouncementCatalog {
  static let firstAnnouncementBaseline = ReleaseAnnouncementVersion("1.3.2")!
  static let announcements: [ReleaseAnnouncement] = [
    .agentForking
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

    var state =
      storedState
      ?? initialStorageState(
        currentVersion: currentVersion,
        hasExistingSupatermState: hasExistingSupatermState
      )
    let previousInstalledVersion =
      state.lastInstalledVersion.flatMap(ReleaseAnnouncementVersion.init)
      ?? state.acknowledgedVersion.flatMap(ReleaseAnnouncementVersion.init)
      ?? currentVersion
    let acknowledgedVersion = state.acknowledgedVersion.flatMap(ReleaseAnnouncementVersion.init)
    let eligibilityFloor =
      acknowledgedVersion.map {
        max(previousInstalledVersion, $0)
      } ?? previousInstalledVersion
    state.lastInstalledVersion = currentVersion.rawValue

    let announcement =
      announcements
      .filter { announcement in
        announcement.version > eligibilityFloor && announcement.version <= currentVersion
      }
      .min { lhs, rhs in
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
      lastInstalledVersion: storedVersion,
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
      TerminalPinnedTabCatalog.defaultURL(homeDirectoryPath: homeDirectoryPath, environment: environment),
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

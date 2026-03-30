import Foundation
import Sharing

nonisolated struct AppPrefs: Codable, Equatable, Sendable {
  var appearanceMode: AppearanceMode
  var analyticsEnabled: Bool
  var crashReportsEnabled: Bool
  var updateChannel: UpdateChannel
  var updatesAutomaticallyCheckForUpdates: Bool
  var updatesAutomaticallyDownloadUpdates: Bool

  init(
    appearanceMode: AppearanceMode,
    analyticsEnabled: Bool,
    crashReportsEnabled: Bool,
    updateChannel: UpdateChannel,
    updatesAutomaticallyCheckForUpdates: Bool,
    updatesAutomaticallyDownloadUpdates: Bool
  ) {
    self.appearanceMode = appearanceMode
    self.analyticsEnabled = analyticsEnabled
    self.crashReportsEnabled = crashReportsEnabled
    self.updateChannel = updateChannel
    self.updatesAutomaticallyCheckForUpdates = updatesAutomaticallyCheckForUpdates
    self.updatesAutomaticallyDownloadUpdates =
      updatesAutomaticallyCheckForUpdates && updatesAutomaticallyDownloadUpdates
  }

  var updateSettings: UpdateSettings {
    UpdateSettings(
      updateChannel: updateChannel,
      automaticallyChecksForUpdates: updatesAutomaticallyCheckForUpdates,
      automaticallyDownloadsUpdates: updatesAutomaticallyDownloadUpdates
    )
  }

  static let `default` = Self(
    appearanceMode: .system,
    analyticsEnabled: true,
    crashReportsEnabled: true,
    updateChannel: .stable,
    updatesAutomaticallyCheckForUpdates: true,
    updatesAutomaticallyDownloadUpdates: false
  )

  static func defaultURL(homeDirectoryPath: String = NSHomeDirectory()) -> URL {
    URL(fileURLWithPath: homeDirectoryPath, isDirectory: true)
      .appendingPathComponent(".config", isDirectory: true)
      .appendingPathComponent("supaterm", isDirectory: true)
      .appendingPathComponent("appprefs.json", isDirectory: false)
  }

  static func fileStorageEncoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    return encoder
  }

  enum CodingKeys: String, CodingKey {
    case appearanceMode
    case analyticsEnabled
    case crashReportsEnabled
    case updateChannel
    case updatesAutomaticallyCheckForUpdates
    case updatesAutomaticallyDownloadUpdates
  }

  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      appearanceMode: try container.decodeIfPresent(AppearanceMode.self, forKey: .appearanceMode) ?? .system,
      analyticsEnabled: try container.decodeIfPresent(Bool.self, forKey: .analyticsEnabled) ?? true,
      crashReportsEnabled: try container.decodeIfPresent(Bool.self, forKey: .crashReportsEnabled) ?? true,
      updateChannel: try container.decodeIfPresent(UpdateChannel.self, forKey: .updateChannel) ?? .stable,
      updatesAutomaticallyCheckForUpdates:
        try container.decodeIfPresent(Bool.self, forKey: .updatesAutomaticallyCheckForUpdates) ?? true,
      updatesAutomaticallyDownloadUpdates:
        try container.decodeIfPresent(Bool.self, forKey: .updatesAutomaticallyDownloadUpdates) ?? false
    )
  }
}

extension SharedKey where Self == FileStorageKey<AppPrefs>.Default {
  static var appPrefs: Self {
    Self[
      .fileStorage(
        AppPrefs.defaultURL(),
        decoder: JSONDecoder(),
        encoder: AppPrefs.fileStorageEncoder()
      ),
      default: .default
    ]
  }
}

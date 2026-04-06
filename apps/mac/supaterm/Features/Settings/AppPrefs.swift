import Foundation
import Sharing

nonisolated struct AppPrefs: Codable, Equatable, Sendable {
  var appearanceMode: AppearanceMode
  var analyticsEnabled: Bool
  var crashReportsEnabled: Bool
  var restoreTerminalLayoutEnabled: Bool
  var systemNotificationsEnabled: Bool
  var updateChannel: UpdateChannel

  init(
    appearanceMode: AppearanceMode,
    analyticsEnabled: Bool,
    crashReportsEnabled: Bool,
    restoreTerminalLayoutEnabled: Bool = true,
    systemNotificationsEnabled: Bool = false,
    updateChannel: UpdateChannel
  ) {
    self.appearanceMode = appearanceMode
    self.analyticsEnabled = analyticsEnabled
    self.crashReportsEnabled = crashReportsEnabled
    self.restoreTerminalLayoutEnabled = restoreTerminalLayoutEnabled
    self.systemNotificationsEnabled = systemNotificationsEnabled
    self.updateChannel = updateChannel
  }

  static let `default` = Self(
    appearanceMode: .system,
    analyticsEnabled: true,
    crashReportsEnabled: true,
    restoreTerminalLayoutEnabled: true,
    systemNotificationsEnabled: false,
    updateChannel: .stable
  )

  static func defaultURL(homeDirectoryPath: String = NSHomeDirectory()) -> URL {
    URL(fileURLWithPath: homeDirectoryPath, isDirectory: true)
      .appendingPathComponent(".config", isDirectory: true)
      .appendingPathComponent("supaterm", isDirectory: true)
      .appendingPathComponent("settings.json", isDirectory: false)
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
    case restoreTerminalLayoutEnabled
    case systemNotificationsEnabled
    case updateChannel
  }

  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      appearanceMode: try container.decodeIfPresent(AppearanceMode.self, forKey: .appearanceMode) ?? .system,
      analyticsEnabled: try container.decodeIfPresent(Bool.self, forKey: .analyticsEnabled) ?? true,
      crashReportsEnabled: try container.decodeIfPresent(Bool.self, forKey: .crashReportsEnabled) ?? true,
      restoreTerminalLayoutEnabled:
        try container.decodeIfPresent(Bool.self, forKey: .restoreTerminalLayoutEnabled) ?? true,
      systemNotificationsEnabled:
        try container.decodeIfPresent(Bool.self, forKey: .systemNotificationsEnabled) ?? false,
      updateChannel: try container.decodeIfPresent(UpdateChannel.self, forKey: .updateChannel) ?? .stable
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

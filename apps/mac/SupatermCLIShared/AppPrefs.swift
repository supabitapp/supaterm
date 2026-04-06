import Foundation

public struct AppPrefs: Codable, Equatable, Sendable {
  public var appearanceMode: AppearanceMode
  public var analyticsEnabled: Bool
  public var crashReportsEnabled: Bool
  public var restoreTerminalLayoutEnabled: Bool
  public var systemNotificationsEnabled: Bool
  public var updateChannel: UpdateChannel

  public init(
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

  public static let `default` = Self(
    appearanceMode: .system,
    analyticsEnabled: true,
    crashReportsEnabled: true,
    restoreTerminalLayoutEnabled: true,
    systemNotificationsEnabled: false,
    updateChannel: .stable
  )

  public static func defaultURL(homeDirectoryPath: String = NSHomeDirectory()) -> URL {
    URL(fileURLWithPath: homeDirectoryPath, isDirectory: true)
      .appendingPathComponent(".config", isDirectory: true)
      .appendingPathComponent("supaterm", isDirectory: true)
      .appendingPathComponent("settings.json", isDirectory: false)
  }

  enum CodingKeys: String, CodingKey, CaseIterable {
    case appearanceMode
    case analyticsEnabled
    case crashReportsEnabled
    case restoreTerminalLayoutEnabled
    case systemNotificationsEnabled
    case updateChannel
  }

  public init(from decoder: any Decoder) throws {
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

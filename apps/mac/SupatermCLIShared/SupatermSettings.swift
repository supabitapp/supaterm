import Foundation

public struct SupatermSettings: Codable, Equatable, Sendable {
  public var appearanceMode: AppearanceMode
  public var analyticsEnabled: Bool
  public var crashReportsEnabled: Bool
  public var githubIntegrationEnabled: Bool
  public var glowingPaneRingEnabled: Bool
  public var restoreTerminalLayoutEnabled: Bool
  public var systemNotificationsEnabled: Bool
  public var updateChannel: UpdateChannel

  public init(
    appearanceMode: AppearanceMode,
    analyticsEnabled: Bool,
    crashReportsEnabled: Bool,
    githubIntegrationEnabled: Bool = true,
    glowingPaneRingEnabled: Bool = true,
    restoreTerminalLayoutEnabled: Bool = true,
    systemNotificationsEnabled: Bool = false,
    updateChannel: UpdateChannel
  ) {
    self.appearanceMode = appearanceMode
    self.analyticsEnabled = analyticsEnabled
    self.crashReportsEnabled = crashReportsEnabled
    self.githubIntegrationEnabled = githubIntegrationEnabled
    self.glowingPaneRingEnabled = glowingPaneRingEnabled
    self.restoreTerminalLayoutEnabled = restoreTerminalLayoutEnabled
    self.systemNotificationsEnabled = systemNotificationsEnabled
    self.updateChannel = updateChannel
  }

  public static let `default` = Self(
    appearanceMode: .system,
    analyticsEnabled: true,
    crashReportsEnabled: true,
    githubIntegrationEnabled: true,
    glowingPaneRingEnabled: true,
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
    case githubIntegrationEnabled
    case glowingPaneRingEnabled
    case restoreTerminalLayoutEnabled
    case systemNotificationsEnabled
    case updateChannel

    var schemaDescription: String {
      switch self {
      case .appearanceMode:
        return "App appearance mode."
      case .analyticsEnabled:
        return "Allow anonymous telemetry."
      case .crashReportsEnabled:
        return "Allow crash reports."
      case .githubIntegrationEnabled:
        return "Enable GitHub pull request integration in terminal tabs."
      case .glowingPaneRingEnabled:
        return "Show a glowing ring around panes with unread attention."
      case .restoreTerminalLayoutEnabled:
        return "Restore spaces, tabs, and panes on launch."
      case .systemNotificationsEnabled:
        return "Deliver desktop notifications for terminal activity."
      case .updateChannel:
        return "Select stable or tip updates."
      }
    }

    var schemaEnumValues: [String]? {
      switch self {
      case .appearanceMode:
        return AppearanceMode.allCases.map(\.rawValue)
      case .updateChannel:
        return UpdateChannel.allCases.map(\.rawValue)
      default:
        return nil
      }
    }
  }

  public init(from decoder: any Decoder) throws {
    let defaults = Self.default
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      appearanceMode:
        try container.decodeIfPresent(AppearanceMode.self, forKey: .appearanceMode) ?? defaults.appearanceMode,
      analyticsEnabled:
        try container.decodeIfPresent(Bool.self, forKey: .analyticsEnabled) ?? defaults.analyticsEnabled,
      crashReportsEnabled:
        try container.decodeIfPresent(Bool.self, forKey: .crashReportsEnabled) ?? defaults.crashReportsEnabled,
      githubIntegrationEnabled:
        try container.decodeIfPresent(Bool.self, forKey: .githubIntegrationEnabled)
          ?? defaults.githubIntegrationEnabled,
      glowingPaneRingEnabled:
        try container.decodeIfPresent(Bool.self, forKey: .glowingPaneRingEnabled)
          ?? defaults.glowingPaneRingEnabled,
      restoreTerminalLayoutEnabled:
        try container.decodeIfPresent(Bool.self, forKey: .restoreTerminalLayoutEnabled)
          ?? defaults.restoreTerminalLayoutEnabled,
      systemNotificationsEnabled:
        try container.decodeIfPresent(Bool.self, forKey: .systemNotificationsEnabled)
          ?? defaults.systemNotificationsEnabled,
      updateChannel: try container.decodeIfPresent(UpdateChannel.self, forKey: .updateChannel) ?? defaults.updateChannel
    )
  }

  public func encode(to encoder: any Encoder) throws {
    try JSONValue.object(persistedJSONObject()).encode(to: encoder)
  }

  func persistedJSONObject(includeSchema: Bool = true) -> [String: JSONValue] {
    var object: [String: JSONValue] = [:]
    if includeSchema {
      object[SupatermSettingsSchema.schemaKey] = .string(SupatermSettingsSchema.url)
    }
    for key in CodingKeys.allCases {
      object[key.rawValue] = value(for: key)
    }
    return object
  }

  func value(for key: CodingKeys) -> JSONValue {
    switch key {
    case .appearanceMode:
      return .string(appearanceMode.rawValue)
    case .analyticsEnabled:
      return .bool(analyticsEnabled)
    case .crashReportsEnabled:
      return .bool(crashReportsEnabled)
    case .githubIntegrationEnabled:
      return .bool(githubIntegrationEnabled)
    case .glowingPaneRingEnabled:
      return .bool(glowingPaneRingEnabled)
    case .restoreTerminalLayoutEnabled:
      return .bool(restoreTerminalLayoutEnabled)
    case .systemNotificationsEnabled:
      return .bool(systemNotificationsEnabled)
    case .updateChannel:
      return .string(updateChannel.rawValue)
    }
  }
}

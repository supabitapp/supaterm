import Foundation

public enum SupatermBottomBarModule: String, Codable, CaseIterable, Equatable, Hashable, Sendable {
  case directory
  case gitBranch = "git_branch"
  case gitStatus = "git_status"
  case paneTitle = "pane_title"
  case agent
  case exitStatus = "exit_status"
  case commandDuration = "command_duration"
  case time
}

public struct SupatermBottomBarSettings: Codable, Equatable, Hashable, Sendable {
  public var enabled: Bool
  public var left: [SupatermBottomBarModule]
  public var center: [SupatermBottomBarModule]
  public var right: [SupatermBottomBarModule]

  public init(
    enabled: Bool,
    left: [SupatermBottomBarModule],
    center: [SupatermBottomBarModule],
    right: [SupatermBottomBarModule]
  ) {
    self.enabled = enabled
    self.left = left
    self.center = center
    self.right = right
  }

  public init(from decoder: any Decoder) throws {
    let defaults = Self.default
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      enabled: try container.decodeIfPresent(Bool.self, forKey: .enabled) ?? defaults.enabled,
      left: try container.decodeIfPresent([SupatermBottomBarModule].self, forKey: .left) ?? defaults.left,
      center: try container.decodeIfPresent([SupatermBottomBarModule].self, forKey: .center) ?? defaults.center,
      right: try container.decodeIfPresent([SupatermBottomBarModule].self, forKey: .right) ?? defaults.right
    )
  }

  public static let `default` = Self(
    enabled: true,
    left: [.agent],
    center: [],
    right: []
  )

  public var modules: [SupatermBottomBarModule] {
    left + center + right
  }

  public var containsGitModule: Bool {
    modules.contains(.gitBranch) || modules.contains(.gitStatus)
  }

  public var containsTimeModule: Bool {
    modules.contains(.time)
  }

  private enum CodingKeys: String, CodingKey {
    case enabled
    case left
    case center
    case right
  }
}

public struct SupatermSettings: Codable, Equatable, Sendable {
  public var appearanceMode: AppearanceMode
  public var analyticsEnabled: Bool
  public var bottomBarSettings: SupatermBottomBarSettings
  public var crashReportsEnabled: Bool
  public var glowingPaneRingEnabled: Bool
  public var newTabPosition: NewTabPosition
  public var restoreTerminalLayoutEnabled: Bool
  public var systemNotificationsEnabled: Bool
  public var updateChannel: UpdateChannel

  public init(
    appearanceMode: AppearanceMode,
    analyticsEnabled: Bool,
    bottomBarSettings: SupatermBottomBarSettings = .default,
    crashReportsEnabled: Bool,
    glowingPaneRingEnabled: Bool = true,
    newTabPosition: NewTabPosition = .end,
    restoreTerminalLayoutEnabled: Bool = true,
    systemNotificationsEnabled: Bool = false,
    updateChannel: UpdateChannel
  ) {
    self.appearanceMode = appearanceMode
    self.analyticsEnabled = analyticsEnabled
    self.bottomBarSettings = bottomBarSettings
    self.crashReportsEnabled = crashReportsEnabled
    self.glowingPaneRingEnabled = glowingPaneRingEnabled
    self.newTabPosition = newTabPosition
    self.restoreTerminalLayoutEnabled = restoreTerminalLayoutEnabled
    self.systemNotificationsEnabled = systemNotificationsEnabled
    self.updateChannel = updateChannel
  }

  public static let `default` = Self(
    appearanceMode: .dark,
    analyticsEnabled: true,
    bottomBarSettings: .default,
    crashReportsEnabled: true,
    glowingPaneRingEnabled: true,
    newTabPosition: .end,
    restoreTerminalLayoutEnabled: true,
    systemNotificationsEnabled: false,
    updateChannel: .stable
  )

  public static func defaultURL(homeDirectoryPath: String = NSHomeDirectory()) -> URL {
    configDirectoryURL(homeDirectoryPath: homeDirectoryPath)
      .appendingPathComponent("settings.toml", isDirectory: false)
  }

  public static func legacyURL(homeDirectoryPath: String = NSHomeDirectory()) -> URL {
    configDirectoryURL(homeDirectoryPath: homeDirectoryPath)
      .appendingPathComponent("settings.json", isDirectory: false)
  }

  public init(from decoder: any Decoder) throws {
    let defaults = Self.default
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let appearance = try container.decodeIfPresent(PersistedAppearance.self, forKey: .appearance)
    let bottomBar = try container.decodeIfPresent(SupatermBottomBarSettings.self, forKey: .bottomBar)
    let privacy = try container.decodeIfPresent(PersistedPrivacy.self, forKey: .privacy)
    let notifications = try container.decodeIfPresent(PersistedNotifications.self, forKey: .notifications)
    let terminal = try container.decodeIfPresent(PersistedTerminal.self, forKey: .terminal)
    let updates = try container.decodeIfPresent(PersistedUpdates.self, forKey: .updates)

    self.init(
      appearanceMode: appearance?.mode ?? defaults.appearanceMode,
      analyticsEnabled: privacy?.analyticsEnabled ?? defaults.analyticsEnabled,
      bottomBarSettings: bottomBar ?? defaults.bottomBarSettings,
      crashReportsEnabled: privacy?.crashReportsEnabled ?? defaults.crashReportsEnabled,
      glowingPaneRingEnabled: notifications?.glowingPaneRing ?? defaults.glowingPaneRingEnabled,
      newTabPosition: terminal?.newTabPosition ?? defaults.newTabPosition,
      restoreTerminalLayoutEnabled: terminal?.restoreLayout ?? defaults.restoreTerminalLayoutEnabled,
      systemNotificationsEnabled: notifications?.systemNotifications ?? defaults.systemNotificationsEnabled,
      updateChannel: updates?.channel ?? defaults.updateChannel
    )
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(PersistedAppearance(mode: appearanceMode), forKey: .appearance)
    try container.encode(bottomBarSettings, forKey: .bottomBar)
    try container.encode(
      PersistedPrivacy(
        analyticsEnabled: analyticsEnabled,
        crashReportsEnabled: crashReportsEnabled
      ),
      forKey: .privacy
    )
    try container.encode(
      PersistedNotifications(
        glowingPaneRing: glowingPaneRingEnabled,
        systemNotifications: systemNotificationsEnabled
      ),
      forKey: .notifications
    )
    try container.encode(
      PersistedTerminal(
        newTabPosition: newTabPosition,
        restoreLayout: restoreTerminalLayoutEnabled
      ),
      forKey: .terminal
    )
    try container.encode(PersistedUpdates(channel: updateChannel), forKey: .updates)
  }
}

extension SupatermSettings {
  enum CodingKeys: String, CodingKey {
    case appearance
    case bottomBar = "bottom_bar"
    case privacy
    case notifications
    case terminal
    case updates
  }

  struct PersistedAppearance: Codable, Equatable, Sendable {
    let mode: AppearanceMode
  }

  struct PersistedPrivacy: Codable, Equatable, Sendable {
    let analyticsEnabled: Bool
    let crashReportsEnabled: Bool

    enum CodingKeys: String, CodingKey {
      case analyticsEnabled = "analytics_enabled"
      case crashReportsEnabled = "crash_reports_enabled"
    }
  }

  struct PersistedNotifications: Codable, Equatable, Sendable {
    let glowingPaneRing: Bool
    let systemNotifications: Bool

    enum CodingKeys: String, CodingKey {
      case glowingPaneRing = "glowing_pane_ring"
      case systemNotifications = "system_notifications"
    }
  }

  struct PersistedTerminal: Codable, Equatable, Sendable {
    let newTabPosition: NewTabPosition
    let restoreLayout: Bool

    enum CodingKeys: String, CodingKey {
      case newTabPosition = "new_tab_position"
      case restoreLayout = "restore_layout"
    }
  }

  struct PersistedUpdates: Codable, Equatable, Sendable {
    let channel: UpdateChannel
  }
}

extension SupatermSettings {
  fileprivate static func configDirectoryURL(homeDirectoryPath: String) -> URL {
    URL(fileURLWithPath: homeDirectoryPath, isDirectory: true)
      .appendingPathComponent(".config", isDirectory: true)
      .appendingPathComponent("supaterm", isDirectory: true)
  }
}

struct LegacySupatermSettingsFile: Decodable, Equatable, Sendable {
  var appearanceMode: AppearanceMode
  var analyticsEnabled: Bool
  var crashReportsEnabled: Bool
  var glowingPaneRingEnabled: Bool
  var newTabPosition: NewTabPosition
  var restoreTerminalLayoutEnabled: Bool
  var systemNotificationsEnabled: Bool
  var updateChannel: UpdateChannel

  init(from decoder: any Decoder) throws {
    let defaults = SupatermSettings.default
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.appearanceMode =
      try container.decodeIfPresent(AppearanceMode.self, forKey: .appearanceMode) ?? defaults.appearanceMode
    self.analyticsEnabled =
      try container.decodeIfPresent(Bool.self, forKey: .analyticsEnabled) ?? defaults.analyticsEnabled
    self.crashReportsEnabled =
      try container.decodeIfPresent(Bool.self, forKey: .crashReportsEnabled) ?? defaults.crashReportsEnabled
    self.glowingPaneRingEnabled =
      try container.decodeIfPresent(Bool.self, forKey: .glowingPaneRingEnabled) ?? defaults.glowingPaneRingEnabled
    self.newTabPosition =
      try container.decodeIfPresent(NewTabPosition.self, forKey: .newTabPosition) ?? defaults.newTabPosition
    self.restoreTerminalLayoutEnabled =
      try container.decodeIfPresent(Bool.self, forKey: .restoreTerminalLayoutEnabled)
      ?? defaults.restoreTerminalLayoutEnabled
    self.systemNotificationsEnabled =
      try container.decodeIfPresent(Bool.self, forKey: .systemNotificationsEnabled)
      ?? defaults.systemNotificationsEnabled
    self.updateChannel =
      try container.decodeIfPresent(UpdateChannel.self, forKey: .updateChannel) ?? defaults.updateChannel
  }

  var supatermSettings: SupatermSettings {
    SupatermSettings(
      appearanceMode: appearanceMode,
      analyticsEnabled: analyticsEnabled,
      crashReportsEnabled: crashReportsEnabled,
      glowingPaneRingEnabled: glowingPaneRingEnabled,
      newTabPosition: newTabPosition,
      restoreTerminalLayoutEnabled: restoreTerminalLayoutEnabled,
      systemNotificationsEnabled: systemNotificationsEnabled,
      updateChannel: updateChannel
    )
  }

  enum CodingKeys: String, CodingKey, CaseIterable {
    case appearanceMode
    case analyticsEnabled
    case crashReportsEnabled
    case glowingPaneRingEnabled
    case newTabPosition
    case restoreTerminalLayoutEnabled
    case systemNotificationsEnabled
    case updateChannel
    case updatesAutomaticallyCheckForUpdates
    case updatesAutomaticallyDownloadUpdates
  }
}

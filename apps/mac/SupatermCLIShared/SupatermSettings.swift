import Foundation

public struct SupatermSettings: Codable, Equatable, Sendable {
  public var appearanceMode: AppearanceMode
  public var analyticsEnabled: Bool
  public var codingAgentsShowIcons: Bool
  public var codingAgentsShowSpinner: Bool
  public var crashReportsEnabled: Bool
  public var glowingPaneRingEnabled: Bool
  public var newTabPosition: NewTabPosition
  public var restoreTerminalLayoutEnabled: Bool
  public var systemNotificationsEnabled: Bool
  public var updateChannel: UpdateChannel

  public init(
    appearanceMode: AppearanceMode,
    analyticsEnabled: Bool,
    codingAgentsShowIcons: Bool = true,
    codingAgentsShowSpinner: Bool = true,
    crashReportsEnabled: Bool,
    glowingPaneRingEnabled: Bool = true,
    newTabPosition: NewTabPosition = .end,
    restoreTerminalLayoutEnabled: Bool = true,
    systemNotificationsEnabled: Bool = false,
    updateChannel: UpdateChannel
  ) {
    self.appearanceMode = appearanceMode
    self.analyticsEnabled = analyticsEnabled
    self.codingAgentsShowIcons = codingAgentsShowIcons
    self.codingAgentsShowSpinner = codingAgentsShowSpinner
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
    codingAgentsShowIcons: true,
    codingAgentsShowSpinner: true,
    crashReportsEnabled: true,
    glowingPaneRingEnabled: true,
    newTabPosition: .end,
    restoreTerminalLayoutEnabled: true,
    systemNotificationsEnabled: false,
    updateChannel: .stable
  )

  public static func defaultURL(
    homeDirectoryPath: String = NSHomeDirectory(),
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> URL {
    SupatermStateRoot.fileURL(
      "settings.toml",
      homeDirectoryPath: homeDirectoryPath,
      environment: environment
    )
  }

  public static func legacyURL(
    homeDirectoryPath: String = NSHomeDirectory(),
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> URL {
    SupatermStateRoot.fileURL(
      "settings.json",
      homeDirectoryPath: homeDirectoryPath,
      environment: environment
    )
  }

  public init(from decoder: any Decoder) throws {
    let defaults = Self.default
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let appearance = try container.decodeIfPresent(PersistedAppearance.self, forKey: .appearance)
    let codingAgents = try container.decodeIfPresent(PersistedCodingAgents.self, forKey: .codingAgents)
    let privacy = try container.decodeIfPresent(PersistedPrivacy.self, forKey: .privacy)
    let notifications = try container.decodeIfPresent(PersistedNotifications.self, forKey: .notifications)
    let terminal = try container.decodeIfPresent(PersistedTerminal.self, forKey: .terminal)
    let updates = try container.decodeIfPresent(PersistedUpdates.self, forKey: .updates)

    self.init(
      appearanceMode: appearance?.mode ?? defaults.appearanceMode,
      analyticsEnabled: privacy?.analyticsEnabled ?? defaults.analyticsEnabled,
      codingAgentsShowIcons: codingAgents?.showIcons ?? defaults.codingAgentsShowIcons,
      codingAgentsShowSpinner: codingAgents?.showSpinner ?? defaults.codingAgentsShowSpinner,
      crashReportsEnabled: privacy?.crashReportsEnabled ?? defaults.crashReportsEnabled,
      glowingPaneRingEnabled: notifications?.glowingPaneRing ?? defaults.glowingPaneRingEnabled,
      newTabPosition: terminal?.newTabPosition ?? defaults.newTabPosition,
      restoreTerminalLayoutEnabled: terminal?.restoreLayout ?? defaults.restoreTerminalLayoutEnabled,
      systemNotificationsEnabled: notifications?.systemNotifications ?? defaults.systemNotificationsEnabled,
      updateChannel: updates?.channel ?? defaults.updateChannel
    )
  }

  public func encode(to encoder: any Encoder) throws {
    let defaults = Self.default
    var container = encoder.container(keyedBy: CodingKeys.self)

    if appearanceMode != defaults.appearanceMode {
      try container.encode(PersistedAppearance(mode: appearanceMode), forKey: .appearance)
    }
    if codingAgentsShowIcons != defaults.codingAgentsShowIcons
      || codingAgentsShowSpinner != defaults.codingAgentsShowSpinner
    {
      try container.encode(
        PersistedCodingAgents(
          showIcons: codingAgentsShowIcons,
          showSpinner: codingAgentsShowSpinner
        ),
        forKey: .codingAgents
      )
    }
    if analyticsEnabled != defaults.analyticsEnabled || crashReportsEnabled != defaults.crashReportsEnabled {
      try container.encode(
        PersistedPrivacy(
          analyticsEnabled: analyticsEnabled,
          crashReportsEnabled: crashReportsEnabled
        ),
        forKey: .privacy
      )
    }
    if glowingPaneRingEnabled != defaults.glowingPaneRingEnabled
      || systemNotificationsEnabled != defaults.systemNotificationsEnabled
    {
      try container.encode(
        PersistedNotifications(
          glowingPaneRing: glowingPaneRingEnabled,
          systemNotifications: systemNotificationsEnabled
        ),
        forKey: .notifications
      )
    }
    if newTabPosition != defaults.newTabPosition
      || restoreTerminalLayoutEnabled != defaults.restoreTerminalLayoutEnabled
    {
      try container.encode(
        PersistedTerminal(
          newTabPosition: newTabPosition,
          restoreLayout: restoreTerminalLayoutEnabled
        ),
        forKey: .terminal
      )
    }
    if updateChannel != defaults.updateChannel {
      try container.encode(PersistedUpdates(channel: updateChannel), forKey: .updates)
    }
  }
}

extension SupatermSettings {
  enum CodingKeys: String, CodingKey {
    case appearance
    case codingAgents = "coding_agents"
    case privacy
    case notifications
    case terminal
    case updates
  }

  struct PersistedAppearance: Codable, Equatable, Sendable {
    let mode: AppearanceMode

    init(mode: AppearanceMode) {
      self.mode = mode
    }

    init(from decoder: any Decoder) throws {
      let container = try decoder.container(keyedBy: CodingKeys.self)
      mode =
        try container.decodeIfPresent(AppearanceMode.self, forKey: .mode)
        ?? SupatermSettings.default.appearanceMode
    }

    enum CodingKeys: String, CodingKey {
      case mode
    }

    func encode(to encoder: any Encoder) throws {
      var container = encoder.container(keyedBy: CodingKeys.self)
      if mode != SupatermSettings.default.appearanceMode {
        try container.encode(mode, forKey: .mode)
      }
    }
  }

  struct PersistedCodingAgents: Codable, Equatable, Sendable {
    let showIcons: Bool
    let showSpinner: Bool

    init(showIcons: Bool, showSpinner: Bool) {
      self.showIcons = showIcons
      self.showSpinner = showSpinner
    }

    init(from decoder: any Decoder) throws {
      let container = try decoder.container(keyedBy: CodingKeys.self)
      showIcons =
        try container.decodeIfPresent(Bool.self, forKey: .showIcons)
        ?? SupatermSettings.default.codingAgentsShowIcons
      showSpinner =
        try container.decodeIfPresent(Bool.self, forKey: .showSpinner)
        ?? SupatermSettings.default.codingAgentsShowSpinner
    }

    enum CodingKeys: String, CodingKey {
      case showIcons = "show_icons"
      case showSpinner = "show_spinner"
    }

    func encode(to encoder: any Encoder) throws {
      var container = encoder.container(keyedBy: CodingKeys.self)
      if showIcons != SupatermSettings.default.codingAgentsShowIcons {
        try container.encode(showIcons, forKey: .showIcons)
      }
      if showSpinner != SupatermSettings.default.codingAgentsShowSpinner {
        try container.encode(showSpinner, forKey: .showSpinner)
      }
    }
  }

  struct PersistedPrivacy: Codable, Equatable, Sendable {
    let analyticsEnabled: Bool
    let crashReportsEnabled: Bool

    init(analyticsEnabled: Bool, crashReportsEnabled: Bool) {
      self.analyticsEnabled = analyticsEnabled
      self.crashReportsEnabled = crashReportsEnabled
    }

    init(from decoder: any Decoder) throws {
      let defaults = SupatermSettings.default
      let container = try decoder.container(keyedBy: CodingKeys.self)
      analyticsEnabled =
        try container.decodeIfPresent(Bool.self, forKey: .analyticsEnabled)
        ?? defaults.analyticsEnabled
      crashReportsEnabled =
        try container.decodeIfPresent(Bool.self, forKey: .crashReportsEnabled)
        ?? defaults.crashReportsEnabled
    }

    enum CodingKeys: String, CodingKey {
      case analyticsEnabled = "analytics_enabled"
      case crashReportsEnabled = "crash_reports_enabled"
    }

    func encode(to encoder: any Encoder) throws {
      let defaults = SupatermSettings.default
      var container = encoder.container(keyedBy: CodingKeys.self)

      if analyticsEnabled != defaults.analyticsEnabled {
        try container.encode(analyticsEnabled, forKey: .analyticsEnabled)
      }
      if crashReportsEnabled != defaults.crashReportsEnabled {
        try container.encode(crashReportsEnabled, forKey: .crashReportsEnabled)
      }
    }
  }

  struct PersistedNotifications: Codable, Equatable, Sendable {
    let glowingPaneRing: Bool
    let systemNotifications: Bool

    init(glowingPaneRing: Bool, systemNotifications: Bool) {
      self.glowingPaneRing = glowingPaneRing
      self.systemNotifications = systemNotifications
    }

    init(from decoder: any Decoder) throws {
      let defaults = SupatermSettings.default
      let container = try decoder.container(keyedBy: CodingKeys.self)
      glowingPaneRing =
        try container.decodeIfPresent(Bool.self, forKey: .glowingPaneRing)
        ?? defaults.glowingPaneRingEnabled
      systemNotifications =
        try container.decodeIfPresent(Bool.self, forKey: .systemNotifications)
        ?? defaults.systemNotificationsEnabled
    }

    enum CodingKeys: String, CodingKey {
      case glowingPaneRing = "glowing_pane_ring"
      case systemNotifications = "system_notifications"
    }

    func encode(to encoder: any Encoder) throws {
      let defaults = SupatermSettings.default
      var container = encoder.container(keyedBy: CodingKeys.self)

      if glowingPaneRing != defaults.glowingPaneRingEnabled {
        try container.encode(glowingPaneRing, forKey: .glowingPaneRing)
      }
      if systemNotifications != defaults.systemNotificationsEnabled {
        try container.encode(systemNotifications, forKey: .systemNotifications)
      }
    }
  }

  struct PersistedTerminal: Codable, Equatable, Sendable {
    let newTabPosition: NewTabPosition
    let restoreLayout: Bool

    init(newTabPosition: NewTabPosition, restoreLayout: Bool) {
      self.newTabPosition = newTabPosition
      self.restoreLayout = restoreLayout
    }

    init(from decoder: any Decoder) throws {
      let defaults = SupatermSettings.default
      let container = try decoder.container(keyedBy: CodingKeys.self)
      newTabPosition =
        try container.decodeIfPresent(NewTabPosition.self, forKey: .newTabPosition)
        ?? defaults.newTabPosition
      restoreLayout =
        try container.decodeIfPresent(Bool.self, forKey: .restoreLayout)
        ?? defaults.restoreTerminalLayoutEnabled
    }

    enum CodingKeys: String, CodingKey {
      case newTabPosition = "new_tab_position"
      case restoreLayout = "restore_layout"
    }

    func encode(to encoder: any Encoder) throws {
      let defaults = SupatermSettings.default
      var container = encoder.container(keyedBy: CodingKeys.self)

      if newTabPosition != defaults.newTabPosition {
        try container.encode(newTabPosition, forKey: .newTabPosition)
      }
      if restoreLayout != defaults.restoreTerminalLayoutEnabled {
        try container.encode(restoreLayout, forKey: .restoreLayout)
      }
    }
  }

  struct PersistedUpdates: Codable, Equatable, Sendable {
    let channel: UpdateChannel

    init(channel: UpdateChannel) {
      self.channel = channel
    }

    init(from decoder: any Decoder) throws {
      let container = try decoder.container(keyedBy: CodingKeys.self)
      channel =
        try container.decodeIfPresent(UpdateChannel.self, forKey: .channel)
        ?? SupatermSettings.default.updateChannel
    }

    enum CodingKeys: String, CodingKey {
      case channel
    }

    func encode(to encoder: any Encoder) throws {
      var container = encoder.container(keyedBy: CodingKeys.self)
      if channel != SupatermSettings.default.updateChannel {
        try container.encode(channel, forKey: .channel)
      }
    }
  }
}

struct LegacySupatermSettingsFile: Decodable, Equatable, Sendable {
  var appearanceMode: AppearanceMode
  var analyticsEnabled: Bool
  var codingAgentsShowIcons: Bool
  var codingAgentsShowSpinner: Bool
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
    self.codingAgentsShowIcons = defaults.codingAgentsShowIcons
    self.codingAgentsShowSpinner = defaults.codingAgentsShowSpinner
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
      codingAgentsShowIcons: codingAgentsShowIcons,
      codingAgentsShowSpinner: codingAgentsShowSpinner,
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

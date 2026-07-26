import Foundation

public struct SupatermSettings: Codable, Equatable, Sendable {
  public var appearanceMode: AppearanceMode
  public var analyticsEnabled: Bool
  public var codingAgentsShowPanel: Bool
  public var codingAgentsShowIcons: Bool
  public var codingAgentsShowSpinner: Bool
  public var crashReportsEnabled: Bool
  public var glowingPaneRingEnabled: Bool
  public var restoreTerminalLayoutEnabled: Bool
  public var shortcutOverrides: [SupatermShortcutID: SupatermShortcutOverride]
  public var systemNotificationsEnabled: Bool
  public var updateChannel: UpdateChannel
  public var verboseLoggingEnabled: Bool
  public var zmxSessionsEnabled: Bool

  public init(
    appearanceMode: AppearanceMode,
    analyticsEnabled: Bool,
    codingAgentsShowPanel: Bool = true,
    codingAgentsShowIcons: Bool = true,
    codingAgentsShowSpinner: Bool = true,
    crashReportsEnabled: Bool,
    glowingPaneRingEnabled: Bool = true,
    restoreTerminalLayoutEnabled: Bool = true,
    shortcutOverrides: [SupatermShortcutID: SupatermShortcutOverride] = [:],
    systemNotificationsEnabled: Bool = false,
    updateChannel: UpdateChannel,
    verboseLoggingEnabled: Bool = false,
    zmxSessionsEnabled: Bool = true
  ) {
    self.appearanceMode = appearanceMode
    self.analyticsEnabled = analyticsEnabled
    self.codingAgentsShowPanel = codingAgentsShowPanel
    self.codingAgentsShowIcons = codingAgentsShowIcons
    self.codingAgentsShowSpinner = codingAgentsShowSpinner
    self.crashReportsEnabled = crashReportsEnabled
    self.glowingPaneRingEnabled = glowingPaneRingEnabled
    self.restoreTerminalLayoutEnabled = restoreTerminalLayoutEnabled
    self.shortcutOverrides = shortcutOverrides
    self.systemNotificationsEnabled = systemNotificationsEnabled
    self.updateChannel = updateChannel
    self.verboseLoggingEnabled = verboseLoggingEnabled
    self.zmxSessionsEnabled = zmxSessionsEnabled
  }

  public static let `default` = Self(
    appearanceMode: .dark,
    analyticsEnabled: true,
    codingAgentsShowPanel: true,
    codingAgentsShowIcons: true,
    codingAgentsShowSpinner: true,
    crashReportsEnabled: true,
    glowingPaneRingEnabled: true,
    restoreTerminalLayoutEnabled: true,
    systemNotificationsEnabled: false,
    updateChannel: .stable,
    verboseLoggingEnabled: false,
    zmxSessionsEnabled: true
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
    let logging = try container.decodeIfPresent(PersistedLogging.self, forKey: .logging)
    let notifications = try container.decodeIfPresent(PersistedNotifications.self, forKey: .notifications)
    let shortcuts =
      try container.decodeIfPresent(
        [SupatermShortcutID: SupatermShortcutOverride].self,
        forKey: .shortcuts
      )
    let terminal = try container.decodeIfPresent(PersistedTerminal.self, forKey: .terminal)
    let updates = try container.decodeIfPresent(PersistedUpdates.self, forKey: .updates)

    self.init(
      appearanceMode: appearance?.mode ?? defaults.appearanceMode,
      analyticsEnabled: privacy?.analyticsEnabled ?? defaults.analyticsEnabled,
      codingAgentsShowPanel: codingAgents?.showPanel ?? defaults.codingAgentsShowPanel,
      codingAgentsShowIcons: codingAgents?.showIcons ?? defaults.codingAgentsShowIcons,
      codingAgentsShowSpinner: codingAgents?.showSpinner ?? defaults.codingAgentsShowSpinner,
      crashReportsEnabled: privacy?.crashReportsEnabled ?? defaults.crashReportsEnabled,
      glowingPaneRingEnabled: notifications?.glowingPaneRing ?? defaults.glowingPaneRingEnabled,
      restoreTerminalLayoutEnabled: terminal?.restoreLayout ?? defaults.restoreTerminalLayoutEnabled,
      shortcutOverrides: shortcuts ?? defaults.shortcutOverrides,
      systemNotificationsEnabled: notifications?.systemNotifications ?? defaults.systemNotificationsEnabled,
      updateChannel: updates?.channel ?? defaults.updateChannel,
      verboseLoggingEnabled: logging?.verboseEnabled ?? defaults.verboseLoggingEnabled,
      zmxSessionsEnabled: terminal?.zmxSessionsEnabled ?? defaults.zmxSessionsEnabled
    )
  }

  public func encode(to encoder: any Encoder) throws {
    let defaults = Self.default
    var container = encoder.container(keyedBy: CodingKeys.self)

    if appearanceMode != defaults.appearanceMode {
      try container.encode(PersistedAppearance(mode: appearanceMode), forKey: .appearance)
    }
    if codingAgentsShowPanel != defaults.codingAgentsShowPanel
      || codingAgentsShowIcons != defaults.codingAgentsShowIcons
      || codingAgentsShowSpinner != defaults.codingAgentsShowSpinner
    {
      try container.encode(
        PersistedCodingAgents(
          showPanel: codingAgentsShowPanel,
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
    if verboseLoggingEnabled != defaults.verboseLoggingEnabled {
      try container.encode(
        PersistedLogging(verboseEnabled: verboseLoggingEnabled),
        forKey: .logging
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
    if restoreTerminalLayoutEnabled != defaults.restoreTerminalLayoutEnabled
      || zmxSessionsEnabled != defaults.zmxSessionsEnabled
    {
      try container.encode(
        PersistedTerminal(
          restoreLayout: restoreTerminalLayoutEnabled,
          zmxSessionsEnabled: zmxSessionsEnabled
        ),
        forKey: .terminal
      )
    }
    if shortcutOverrides != defaults.shortcutOverrides {
      try container.encode(shortcutOverrides, forKey: .shortcuts)
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
    case logging
    case privacy
    case notifications
    case shortcuts
    case terminal
    case updates
  }

  enum AppearanceKeys: String, CodingKey {
    case mode
  }

  enum CodingAgentKeys: String, CodingKey {
    case showPanel = "show_panel"
    case showIcons = "show_icons"
    case showSpinner = "show_spinner"
  }

  enum PrivacyKeys: String, CodingKey {
    case analyticsEnabled = "analytics_enabled"
    case crashReportsEnabled = "crash_reports_enabled"
  }

  enum LoggingKeys: String, CodingKey {
    case verboseEnabled = "verbose_enabled"
  }

  enum NotificationKeys: String, CodingKey {
    case glowingPaneRing = "glowing_pane_ring"
    case systemNotifications = "system_notifications"
  }

  enum TerminalKeys: String, CodingKey {
    case restoreLayout = "restore_layout"
    case terminateSessionsOnQuit = "terminate_sessions_on_quit"
    case zmxSessionsEnabled = "zmx_sessions_enabled"
  }

  enum UpdateKeys: String, CodingKey {
    case channel
  }

  struct PersistedAppearance: Codable, Equatable, Sendable {
    let mode: AppearanceMode

    init(mode: AppearanceMode) {
      self.mode = mode
    }

    init(from decoder: any Decoder) throws {
      let container = try decoder.container(keyedBy: AppearanceKeys.self)
      mode =
        try container.decodeIfPresent(AppearanceMode.self, forKey: .mode)
        ?? SupatermSettings.default.appearanceMode
    }

    func encode(to encoder: any Encoder) throws {
      var container = encoder.container(keyedBy: AppearanceKeys.self)
      if mode != SupatermSettings.default.appearanceMode {
        try container.encode(mode, forKey: .mode)
      }
    }
  }

  struct PersistedCodingAgents: Codable, Equatable, Sendable {
    let showPanel: Bool
    let showIcons: Bool
    let showSpinner: Bool

    init(showPanel: Bool, showIcons: Bool, showSpinner: Bool) {
      self.showPanel = showPanel
      self.showIcons = showIcons
      self.showSpinner = showSpinner
    }

    init(from decoder: any Decoder) throws {
      let container = try decoder.container(keyedBy: CodingAgentKeys.self)
      showPanel =
        try container.decodeIfPresent(Bool.self, forKey: .showPanel)
        ?? SupatermSettings.default.codingAgentsShowPanel
      showIcons =
        try container.decodeIfPresent(Bool.self, forKey: .showIcons)
        ?? SupatermSettings.default.codingAgentsShowIcons
      showSpinner =
        try container.decodeIfPresent(Bool.self, forKey: .showSpinner)
        ?? SupatermSettings.default.codingAgentsShowSpinner
    }

    func encode(to encoder: any Encoder) throws {
      var container = encoder.container(keyedBy: CodingAgentKeys.self)
      if showPanel != SupatermSettings.default.codingAgentsShowPanel {
        try container.encode(showPanel, forKey: .showPanel)
      }
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
      let container = try decoder.container(keyedBy: PrivacyKeys.self)
      analyticsEnabled =
        try container.decodeIfPresent(Bool.self, forKey: .analyticsEnabled)
        ?? defaults.analyticsEnabled
      crashReportsEnabled =
        try container.decodeIfPresent(Bool.self, forKey: .crashReportsEnabled)
        ?? defaults.crashReportsEnabled
    }

    func encode(to encoder: any Encoder) throws {
      let defaults = SupatermSettings.default
      var container = encoder.container(keyedBy: PrivacyKeys.self)

      if analyticsEnabled != defaults.analyticsEnabled {
        try container.encode(analyticsEnabled, forKey: .analyticsEnabled)
      }
      if crashReportsEnabled != defaults.crashReportsEnabled {
        try container.encode(crashReportsEnabled, forKey: .crashReportsEnabled)
      }
    }
  }

  struct PersistedLogging: Codable, Equatable, Sendable {
    let verboseEnabled: Bool

    init(verboseEnabled: Bool) {
      self.verboseEnabled = verboseEnabled
    }

    init(from decoder: any Decoder) throws {
      let container = try decoder.container(keyedBy: LoggingKeys.self)
      verboseEnabled =
        try container.decodeIfPresent(Bool.self, forKey: .verboseEnabled)
        ?? SupatermSettings.default.verboseLoggingEnabled
    }

    func encode(to encoder: any Encoder) throws {
      var container = encoder.container(keyedBy: LoggingKeys.self)
      if verboseEnabled != SupatermSettings.default.verboseLoggingEnabled {
        try container.encode(verboseEnabled, forKey: .verboseEnabled)
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
      let container = try decoder.container(keyedBy: NotificationKeys.self)
      glowingPaneRing =
        try container.decodeIfPresent(Bool.self, forKey: .glowingPaneRing)
        ?? defaults.glowingPaneRingEnabled
      systemNotifications =
        try container.decodeIfPresent(Bool.self, forKey: .systemNotifications)
        ?? defaults.systemNotificationsEnabled
    }

    func encode(to encoder: any Encoder) throws {
      let defaults = SupatermSettings.default
      var container = encoder.container(keyedBy: NotificationKeys.self)

      if glowingPaneRing != defaults.glowingPaneRingEnabled {
        try container.encode(glowingPaneRing, forKey: .glowingPaneRing)
      }
      if systemNotifications != defaults.systemNotificationsEnabled {
        try container.encode(systemNotifications, forKey: .systemNotifications)
      }
    }
  }

  struct PersistedTerminal: Codable, Equatable, Sendable {
    let restoreLayout: Bool
    let zmxSessionsEnabled: Bool

    init(
      restoreLayout: Bool,
      zmxSessionsEnabled: Bool
    ) {
      self.restoreLayout = restoreLayout
      self.zmxSessionsEnabled = zmxSessionsEnabled
    }

    init(from decoder: any Decoder) throws {
      let defaults = SupatermSettings.default
      let container = try decoder.container(keyedBy: TerminalKeys.self)
      restoreLayout =
        try container.decodeIfPresent(Bool.self, forKey: .restoreLayout)
        ?? defaults.restoreTerminalLayoutEnabled
      let legacyTerminateSessionsOnQuit = try container.decodeIfPresent(Bool.self, forKey: .terminateSessionsOnQuit)
      zmxSessionsEnabled =
        try container.decodeIfPresent(Bool.self, forKey: .zmxSessionsEnabled)
        ?? legacyTerminateSessionsOnQuit.map { !$0 }
        ?? defaults.zmxSessionsEnabled
    }

    func encode(to encoder: any Encoder) throws {
      let defaults = SupatermSettings.default
      var container = encoder.container(keyedBy: TerminalKeys.self)

      if restoreLayout != defaults.restoreTerminalLayoutEnabled {
        try container.encode(restoreLayout, forKey: .restoreLayout)
      }
      if zmxSessionsEnabled != defaults.zmxSessionsEnabled {
        try container.encode(zmxSessionsEnabled, forKey: .zmxSessionsEnabled)
      }
    }
  }

  struct PersistedUpdates: Codable, Equatable, Sendable {
    let channel: UpdateChannel

    init(channel: UpdateChannel) {
      self.channel = channel
    }

    init(from decoder: any Decoder) throws {
      let container = try decoder.container(keyedBy: UpdateKeys.self)
      channel =
        try container.decodeIfPresent(UpdateChannel.self, forKey: .channel)
        ?? SupatermSettings.default.updateChannel
    }

    func encode(to encoder: any Encoder) throws {
      var container = encoder.container(keyedBy: UpdateKeys.self)
      if channel != SupatermSettings.default.updateChannel {
        try container.encode(channel, forKey: .channel)
      }
    }
  }

}

struct LegacySupatermSettingsFile: Decodable, Equatable, Sendable {
  var appearanceMode: AppearanceMode
  var analyticsEnabled: Bool
  var codingAgentsShowPanel: Bool
  var codingAgentsShowIcons: Bool
  var codingAgentsShowSpinner: Bool
  var crashReportsEnabled: Bool
  var glowingPaneRingEnabled: Bool
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
    self.codingAgentsShowPanel = defaults.codingAgentsShowPanel
    self.codingAgentsShowIcons = defaults.codingAgentsShowIcons
    self.codingAgentsShowSpinner = defaults.codingAgentsShowSpinner
    self.crashReportsEnabled =
      try container.decodeIfPresent(Bool.self, forKey: .crashReportsEnabled) ?? defaults.crashReportsEnabled
    self.glowingPaneRingEnabled =
      try container.decodeIfPresent(Bool.self, forKey: .glowingPaneRingEnabled) ?? defaults.glowingPaneRingEnabled
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
      codingAgentsShowPanel: codingAgentsShowPanel,
      codingAgentsShowIcons: codingAgentsShowIcons,
      codingAgentsShowSpinner: codingAgentsShowSpinner,
      crashReportsEnabled: crashReportsEnabled,
      glowingPaneRingEnabled: glowingPaneRingEnabled,
      restoreTerminalLayoutEnabled: restoreTerminalLayoutEnabled,
      systemNotificationsEnabled: systemNotificationsEnabled,
      updateChannel: updateChannel,
      zmxSessionsEnabled: SupatermSettings.default.zmxSessionsEnabled
    )
  }

  enum CodingKeys: String, CodingKey, CaseIterable {
    case appearanceMode
    case analyticsEnabled
    case crashReportsEnabled
    case glowingPaneRingEnabled
    case restoreTerminalLayoutEnabled
    case systemNotificationsEnabled
    case updateChannel
    case updatesAutomaticallyCheckForUpdates
    case updatesAutomaticallyDownloadUpdates
  }
}

extension SupatermSettings {
  public var terminatesSessionsOnQuit: Bool {
    !zmxSessionsEnabled
  }
}

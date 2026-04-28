import Foundation

public struct SupatermSettings: Codable, Equatable, Sendable {
  public var appearanceMode: AppearanceMode
  public var analyticsEnabled: Bool
  public var codingAgentsShowIcons: Bool
  public var computerUseAlwaysFloatAgentCursor: Bool
  public var computerUseCursorMotion: SupatermComputerUseCursorMotion
  public var computerUseMaxImageDimension: Int
  public var computerUseShowAgentCursor: Bool
  public var computerUseSnapshotMode: SupatermComputerUseSnapshotMode
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
    computerUseAlwaysFloatAgentCursor: Bool = false,
    computerUseCursorMotion: SupatermComputerUseCursorMotion = .default,
    computerUseMaxImageDimension: Int = 1600,
    computerUseShowAgentCursor: Bool = true,
    computerUseSnapshotMode: SupatermComputerUseSnapshotMode = .som,
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
    self.computerUseAlwaysFloatAgentCursor = computerUseAlwaysFloatAgentCursor
    self.computerUseCursorMotion = computerUseCursorMotion
    self.computerUseMaxImageDimension = computerUseMaxImageDimension
    self.computerUseShowAgentCursor = computerUseShowAgentCursor
    self.computerUseSnapshotMode = computerUseSnapshotMode
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
    computerUseAlwaysFloatAgentCursor: false,
    computerUseCursorMotion: .default,
    computerUseMaxImageDimension: 1600,
    computerUseShowAgentCursor: true,
    computerUseSnapshotMode: .som,
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
    let computerUse = try container.decodeIfPresent(PersistedComputerUse.self, forKey: .computerUse)
    let privacy = try container.decodeIfPresent(PersistedPrivacy.self, forKey: .privacy)
    let notifications = try container.decodeIfPresent(PersistedNotifications.self, forKey: .notifications)
    let terminal = try container.decodeIfPresent(PersistedTerminal.self, forKey: .terminal)
    let updates = try container.decodeIfPresent(PersistedUpdates.self, forKey: .updates)

    self.init(
      appearanceMode: appearance?.mode ?? defaults.appearanceMode,
      analyticsEnabled: privacy?.analyticsEnabled ?? defaults.analyticsEnabled,
      codingAgentsShowIcons: codingAgents?.showIcons ?? defaults.codingAgentsShowIcons,
      computerUseAlwaysFloatAgentCursor: computerUse?.alwaysFloatAgentCursor
        ?? defaults.computerUseAlwaysFloatAgentCursor,
      computerUseCursorMotion: computerUse?.cursorMotion ?? defaults.computerUseCursorMotion,
      computerUseMaxImageDimension: computerUse?.maxImageDimension ?? defaults.computerUseMaxImageDimension,
      computerUseShowAgentCursor: computerUse?.showAgentCursor ?? defaults.computerUseShowAgentCursor,
      computerUseSnapshotMode: computerUse?.snapshotMode ?? defaults.computerUseSnapshotMode,
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
    if codingAgentsShowIcons != defaults.codingAgentsShowIcons {
      try container.encode(PersistedCodingAgents(showIcons: codingAgentsShowIcons), forKey: .codingAgents)
    }
    if computerUseAlwaysFloatAgentCursor != defaults.computerUseAlwaysFloatAgentCursor
      || computerUseCursorMotion != defaults.computerUseCursorMotion
      || computerUseMaxImageDimension != defaults.computerUseMaxImageDimension
      || computerUseShowAgentCursor != defaults.computerUseShowAgentCursor
      || computerUseSnapshotMode != defaults.computerUseSnapshotMode
    {
      try container.encode(
        PersistedComputerUse(
          alwaysFloatAgentCursor: computerUseAlwaysFloatAgentCursor,
          cursorMotion: computerUseCursorMotion,
          maxImageDimension: computerUseMaxImageDimension,
          showAgentCursor: computerUseShowAgentCursor,
          snapshotMode: computerUseSnapshotMode
        ),
        forKey: .computerUse
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
    case computerUse = "computer_use"
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
      mode = try container.decodeIfPresent(AppearanceMode.self, forKey: .mode)
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

    init(showIcons: Bool) {
      self.showIcons = showIcons
    }

    init(from decoder: any Decoder) throws {
      let container = try decoder.container(keyedBy: CodingKeys.self)
      showIcons = try container.decodeIfPresent(Bool.self, forKey: .showIcons)
        ?? SupatermSettings.default.codingAgentsShowIcons
    }

    enum CodingKeys: String, CodingKey {
      case showIcons = "show_icons"
    }

    func encode(to encoder: any Encoder) throws {
      var container = encoder.container(keyedBy: CodingKeys.self)
      if showIcons != SupatermSettings.default.codingAgentsShowIcons {
        try container.encode(showIcons, forKey: .showIcons)
      }
    }
  }

  struct PersistedComputerUse: Codable, Equatable, Sendable {
    let alwaysFloatAgentCursor: Bool
    let cursorMotion: SupatermComputerUseCursorMotion
    let maxImageDimension: Int
    let showAgentCursor: Bool
    let snapshotMode: SupatermComputerUseSnapshotMode

    init(
      alwaysFloatAgentCursor: Bool = false,
      cursorMotion: SupatermComputerUseCursorMotion = .default,
      maxImageDimension: Int = 1600,
      showAgentCursor: Bool,
      snapshotMode: SupatermComputerUseSnapshotMode = .som
    ) {
      self.alwaysFloatAgentCursor = alwaysFloatAgentCursor
      self.cursorMotion = cursorMotion
      self.maxImageDimension = maxImageDimension
      self.showAgentCursor = showAgentCursor
      self.snapshotMode = snapshotMode
    }

    init(from decoder: any Decoder) throws {
      let container = try decoder.container(keyedBy: CodingKeys.self)
      alwaysFloatAgentCursor =
        try container.decodeIfPresent(Bool.self, forKey: .alwaysFloatAgentCursor) ?? false
      cursorMotion = SupatermComputerUseCursorMotion(
        startHandle: try container.decodeIfPresent(Double.self, forKey: .cursorStartHandle)
          ?? SupatermComputerUseCursorMotion.default.startHandle,
        endHandle: try container.decodeIfPresent(Double.self, forKey: .cursorEndHandle)
          ?? SupatermComputerUseCursorMotion.default.endHandle,
        arcSize: try container.decodeIfPresent(Double.self, forKey: .cursorArcSize)
          ?? SupatermComputerUseCursorMotion.default.arcSize,
        arcFlow: try container.decodeIfPresent(Double.self, forKey: .cursorArcFlow)
          ?? SupatermComputerUseCursorMotion.default.arcFlow,
        spring: try container.decodeIfPresent(Double.self, forKey: .cursorSpring)
          ?? SupatermComputerUseCursorMotion.default.spring,
        glideDurationMilliseconds: try container.decodeIfPresent(Int.self, forKey: .cursorGlideDurationMilliseconds)
          ?? SupatermComputerUseCursorMotion.default.glideDurationMilliseconds,
        dwellAfterClickMilliseconds: try container.decodeIfPresent(
          Int.self,
          forKey: .cursorDwellAfterClickMilliseconds
        ) ?? SupatermComputerUseCursorMotion.default.dwellAfterClickMilliseconds,
        idleHideMilliseconds: try container.decodeIfPresent(Int.self, forKey: .cursorIdleHideMilliseconds)
          ?? SupatermComputerUseCursorMotion.default.idleHideMilliseconds
      )
      maxImageDimension =
        try container.decodeIfPresent(Int.self, forKey: .maxImageDimension) ?? 1600
      showAgentCursor = try container.decodeIfPresent(Bool.self, forKey: .showAgentCursor) ?? true
      snapshotMode =
        try container.decodeIfPresent(
          SupatermComputerUseSnapshotMode.self,
          forKey: .snapshotMode
        ) ?? .som
    }

    enum CodingKeys: String, CodingKey {
      case alwaysFloatAgentCursor = "always_float_agent_cursor"
      case cursorArcFlow = "cursor_arc_flow"
      case cursorArcSize = "cursor_arc_size"
      case cursorDwellAfterClickMilliseconds = "cursor_dwell_after_click_ms"
      case cursorEndHandle = "cursor_end_handle"
      case cursorGlideDurationMilliseconds = "cursor_glide_duration_ms"
      case cursorIdleHideMilliseconds = "cursor_idle_hide_ms"
      case cursorSpring = "cursor_spring"
      case cursorStartHandle = "cursor_start_handle"
      case maxImageDimension = "max_image_dimension"
      case showAgentCursor = "show_agent_cursor"
      case snapshotMode = "snapshot_mode"
    }

    func encode(to encoder: any Encoder) throws {
      let defaults = SupatermSettings.default
      let defaultMotion = defaults.computerUseCursorMotion
      var container = encoder.container(keyedBy: CodingKeys.self)

      if alwaysFloatAgentCursor != defaults.computerUseAlwaysFloatAgentCursor {
        try container.encode(alwaysFloatAgentCursor, forKey: .alwaysFloatAgentCursor)
      }
      if cursorMotion.arcFlow != defaultMotion.arcFlow {
        try container.encode(cursorMotion.arcFlow, forKey: .cursorArcFlow)
      }
      if cursorMotion.arcSize != defaultMotion.arcSize {
        try container.encode(cursorMotion.arcSize, forKey: .cursorArcSize)
      }
      if cursorMotion.dwellAfterClickMilliseconds != defaultMotion.dwellAfterClickMilliseconds {
        try container.encode(
          cursorMotion.dwellAfterClickMilliseconds,
          forKey: .cursorDwellAfterClickMilliseconds
        )
      }
      if cursorMotion.endHandle != defaultMotion.endHandle {
        try container.encode(cursorMotion.endHandle, forKey: .cursorEndHandle)
      }
      if cursorMotion.glideDurationMilliseconds != defaultMotion.glideDurationMilliseconds {
        try container.encode(cursorMotion.glideDurationMilliseconds, forKey: .cursorGlideDurationMilliseconds)
      }
      if cursorMotion.idleHideMilliseconds != defaultMotion.idleHideMilliseconds {
        try container.encode(cursorMotion.idleHideMilliseconds, forKey: .cursorIdleHideMilliseconds)
      }
      if cursorMotion.spring != defaultMotion.spring {
        try container.encode(cursorMotion.spring, forKey: .cursorSpring)
      }
      if cursorMotion.startHandle != defaultMotion.startHandle {
        try container.encode(cursorMotion.startHandle, forKey: .cursorStartHandle)
      }
      if maxImageDimension != defaults.computerUseMaxImageDimension {
        try container.encode(maxImageDimension, forKey: .maxImageDimension)
      }
      if showAgentCursor != defaults.computerUseShowAgentCursor {
        try container.encode(showAgentCursor, forKey: .showAgentCursor)
      }
      if snapshotMode != defaults.computerUseSnapshotMode {
        try container.encode(snapshotMode, forKey: .snapshotMode)
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
      analyticsEnabled = try container.decodeIfPresent(Bool.self, forKey: .analyticsEnabled)
        ?? defaults.analyticsEnabled
      crashReportsEnabled = try container.decodeIfPresent(Bool.self, forKey: .crashReportsEnabled)
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
      glowingPaneRing = try container.decodeIfPresent(Bool.self, forKey: .glowingPaneRing)
        ?? defaults.glowingPaneRingEnabled
      systemNotifications = try container.decodeIfPresent(Bool.self, forKey: .systemNotifications)
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
      newTabPosition = try container.decodeIfPresent(NewTabPosition.self, forKey: .newTabPosition)
        ?? defaults.newTabPosition
      restoreLayout = try container.decodeIfPresent(Bool.self, forKey: .restoreLayout)
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
      channel = try container.decodeIfPresent(UpdateChannel.self, forKey: .channel)
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
  var computerUseAlwaysFloatAgentCursor: Bool
  var computerUseCursorMotion: SupatermComputerUseCursorMotion
  var computerUseMaxImageDimension: Int
  var computerUseShowAgentCursor: Bool
  var computerUseSnapshotMode: SupatermComputerUseSnapshotMode
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
    self.computerUseAlwaysFloatAgentCursor = defaults.computerUseAlwaysFloatAgentCursor
    self.computerUseCursorMotion = defaults.computerUseCursorMotion
    self.computerUseMaxImageDimension = defaults.computerUseMaxImageDimension
    self.computerUseShowAgentCursor = defaults.computerUseShowAgentCursor
    self.computerUseSnapshotMode = defaults.computerUseSnapshotMode
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
      computerUseAlwaysFloatAgentCursor: computerUseAlwaysFloatAgentCursor,
      computerUseCursorMotion: computerUseCursorMotion,
      computerUseMaxImageDimension: computerUseMaxImageDimension,
      computerUseShowAgentCursor: computerUseShowAgentCursor,
      computerUseSnapshotMode: computerUseSnapshotMode,
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

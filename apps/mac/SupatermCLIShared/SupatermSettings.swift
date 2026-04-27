import Foundation

public struct SupatermSettings: Codable, Equatable, Sendable {
  public var appearanceMode: AppearanceMode
  public var analyticsEnabled: Bool
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
    let computerUse = try container.decodeIfPresent(PersistedComputerUse.self, forKey: .computerUse)
    let privacy = try container.decodeIfPresent(PersistedPrivacy.self, forKey: .privacy)
    let notifications = try container.decodeIfPresent(PersistedNotifications.self, forKey: .notifications)
    let terminal = try container.decodeIfPresent(PersistedTerminal.self, forKey: .terminal)
    let updates = try container.decodeIfPresent(PersistedUpdates.self, forKey: .updates)

    self.init(
      appearanceMode: appearance?.mode ?? defaults.appearanceMode,
      analyticsEnabled: privacy?.analyticsEnabled ?? defaults.analyticsEnabled,
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
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(PersistedAppearance(mode: appearanceMode), forKey: .appearance)
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
    case computerUse = "computer_use"
    case privacy
    case notifications
    case terminal
    case updates
  }

  struct PersistedAppearance: Codable, Equatable, Sendable {
    let mode: AppearanceMode
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
      var container = encoder.container(keyedBy: CodingKeys.self)
      try container.encode(alwaysFloatAgentCursor, forKey: .alwaysFloatAgentCursor)
      try container.encode(cursorMotion.arcFlow, forKey: .cursorArcFlow)
      try container.encode(cursorMotion.arcSize, forKey: .cursorArcSize)
      try container.encode(
        cursorMotion.dwellAfterClickMilliseconds,
        forKey: .cursorDwellAfterClickMilliseconds
      )
      try container.encode(cursorMotion.endHandle, forKey: .cursorEndHandle)
      try container.encode(cursorMotion.glideDurationMilliseconds, forKey: .cursorGlideDurationMilliseconds)
      try container.encode(cursorMotion.idleHideMilliseconds, forKey: .cursorIdleHideMilliseconds)
      try container.encode(cursorMotion.spring, forKey: .cursorSpring)
      try container.encode(cursorMotion.startHandle, forKey: .cursorStartHandle)
      try container.encode(maxImageDimension, forKey: .maxImageDimension)
      try container.encode(showAgentCursor, forKey: .showAgentCursor)
      try container.encode(snapshotMode, forKey: .snapshotMode)
    }
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

struct LegacySupatermSettingsFile: Decodable, Equatable, Sendable {
  var appearanceMode: AppearanceMode
  var analyticsEnabled: Bool
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

import Foundation
import SupatermCLIShared

public enum SupatermSettingsCommandError: Error, Equatable, LocalizedError, Sendable {
  case invalidKey(String)
  case invalidValue(key: String, value: String, allowedValues: [String])

  public var errorDescription: String? {
    switch self {
    case .invalidKey(let key):
      return "Unknown config key `\(key)`."
    case .invalidValue(let key, let value, let allowedValues):
      return "Invalid value `\(value)` for `\(key)`. Expected one of: \(allowedValues.joined(separator: ", "))."
    }
  }
}

public enum SupatermSettingsKey: String, CaseIterable, Codable, Equatable, Sendable {
  case appearanceMode = "appearance.mode"
  case terminalRestoreLayout = "terminal.restore_layout"
  case terminalSessionPersistenceEnabled = "terminal.session_persistence"
  case notificationsSystemNotifications = "notifications.system_notifications"
  case notificationsGlowingPaneRing = "notifications.glowing_pane_ring"
  case codingAgentsShowPanel = "coding_agents.show_panel"
  case privacyAnalyticsEnabled = "privacy.analytics_enabled"
  case privacyCrashReportsEnabled = "privacy.crash_reports_enabled"
  case updatesChannel = "updates.channel"
  case loggingVerboseEnabled = "logging.verbose_enabled"

  public init(path: String) throws {
    guard let key = Self(rawValue: path) else {
      throw SupatermSettingsCommandError.invalidKey(path)
    }
    self = key
  }

  public var valueKind: SupatermSettingsValueKind {
    switch self {
    case .appearanceMode,
      .updatesChannel:
      return .string
    case .terminalRestoreLayout,
      .terminalSessionPersistenceEnabled,
      .notificationsSystemNotifications,
      .notificationsGlowingPaneRing,
      .codingAgentsShowPanel,
      .privacyAnalyticsEnabled,
      .privacyCrashReportsEnabled,
      .loggingVerboseEnabled:
      return .bool
    }
  }

  public var allowedValues: [String] {
    switch self {
    case .appearanceMode:
      return AppearanceMode.allCases.map(\.rawValue)
    case .updatesChannel:
      return UpdateChannel.allCases.map(\.rawValue)
    case .terminalRestoreLayout,
      .terminalSessionPersistenceEnabled,
      .notificationsSystemNotifications,
      .notificationsGlowingPaneRing,
      .codingAgentsShowPanel,
      .privacyAnalyticsEnabled,
      .privacyCrashReportsEnabled,
      .loggingVerboseEnabled:
      return ["true", "false"]
    }
  }

  public func value(in settings: SupatermSettings) -> String {
    switch self {
    case .appearanceMode:
      return settings.appearanceMode.rawValue
    case .terminalRestoreLayout:
      return string(settings.restoreTerminalLayoutEnabled)
    case .terminalSessionPersistenceEnabled:
      return string(settings.sessionPersistenceEnabled)
    case .notificationsSystemNotifications:
      return string(settings.systemNotificationsEnabled)
    case .notificationsGlowingPaneRing:
      return string(settings.glowingPaneRingEnabled)
    case .codingAgentsShowPanel:
      return string(settings.codingAgentsShowPanel)
    case .privacyAnalyticsEnabled:
      return string(settings.analyticsEnabled)
    case .privacyCrashReportsEnabled:
      return string(settings.crashReportsEnabled)
    case .updatesChannel:
      return settings.updateChannel.rawValue
    case .loggingVerboseEnabled:
      return string(settings.verboseLoggingEnabled)
    }
  }

  public var defaultValue: String {
    value(in: .default)
  }

  public func set(_ rawValue: String, in settings: inout SupatermSettings) throws {
    switch self {
    case .appearanceMode:
      settings.appearanceMode = try parsedEnum(AppearanceMode.self, rawValue: rawValue)
    case .terminalRestoreLayout:
      settings.restoreTerminalLayoutEnabled = try parsedBool(rawValue)
    case .terminalSessionPersistenceEnabled:
      settings.sessionPersistenceEnabled = try parsedBool(rawValue)
    case .notificationsSystemNotifications:
      settings.systemNotificationsEnabled = try parsedBool(rawValue)
    case .notificationsGlowingPaneRing:
      settings.glowingPaneRingEnabled = try parsedBool(rawValue)
    case .codingAgentsShowPanel:
      settings.codingAgentsShowPanel = try parsedBool(rawValue)
    case .privacyAnalyticsEnabled:
      settings.analyticsEnabled = try parsedBool(rawValue)
    case .privacyCrashReportsEnabled:
      settings.crashReportsEnabled = try parsedBool(rawValue)
    case .updatesChannel:
      settings.updateChannel = try parsedEnum(UpdateChannel.self, rawValue: rawValue)
    case .loggingVerboseEnabled:
      settings.verboseLoggingEnabled = try parsedBool(rawValue)
    }
  }

  public func reset(in settings: inout SupatermSettings) {
    switch self {
    case .appearanceMode:
      settings.appearanceMode = SupatermSettings.default.appearanceMode
    case .terminalRestoreLayout:
      settings.restoreTerminalLayoutEnabled = SupatermSettings.default.restoreTerminalLayoutEnabled
    case .terminalSessionPersistenceEnabled:
      settings.sessionPersistenceEnabled = SupatermSettings.default.sessionPersistenceEnabled
    case .notificationsSystemNotifications:
      settings.systemNotificationsEnabled = SupatermSettings.default.systemNotificationsEnabled
    case .notificationsGlowingPaneRing:
      settings.glowingPaneRingEnabled = SupatermSettings.default.glowingPaneRingEnabled
    case .codingAgentsShowPanel:
      settings.codingAgentsShowPanel = SupatermSettings.default.codingAgentsShowPanel
    case .privacyAnalyticsEnabled:
      settings.analyticsEnabled = SupatermSettings.default.analyticsEnabled
    case .privacyCrashReportsEnabled:
      settings.crashReportsEnabled = SupatermSettings.default.crashReportsEnabled
    case .updatesChannel:
      settings.updateChannel = SupatermSettings.default.updateChannel
    case .loggingVerboseEnabled:
      settings.verboseLoggingEnabled = SupatermSettings.default.verboseLoggingEnabled
    }
  }

  public func mutationWarnings() -> [String] {
    switch self {
    case .terminalSessionPersistenceEnabled:
      return ["Restart Supaterm for session persistence changes to take effect."]
    case .notificationsSystemNotifications:
      return ["macOS notification permission may still be required."]
    default:
      return []
    }
  }

  private func string(_ value: Bool) -> String {
    value ? "true" : "false"
  }

  private func parsedBool(_ rawValue: String) throws -> Bool {
    let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    switch value {
    case "true":
      return true
    case "false":
      return false
    default:
      throw SupatermSettingsCommandError.invalidValue(
        key: self.rawValue,
        value: rawValue,
        allowedValues: allowedValues
      )
    }
  }

  private func parsedEnum<Value: RawRepresentable>(
    _ type: Value.Type,
    rawValue: String
  ) throws -> Value where Value.RawValue == String {
    let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard let parsed = Value(rawValue: value) else {
      throw SupatermSettingsCommandError.invalidValue(
        key: self.rawValue,
        value: rawValue,
        allowedValues: allowedValues
      )
    }
    return parsed
  }
}

public enum SupatermSettingsRegistry {
  public static func entry(
    for key: SupatermSettingsKey,
    settings: SupatermSettings
  ) -> SupatermSettingsEntry {
    let value = key.value(in: settings)
    return SupatermSettingsEntry(
      key: key.rawValue,
      value: value,
      defaultValue: key.defaultValue,
      valueKind: key.valueKind,
      allowedValues: key.allowedValues,
      isDefault: value == key.defaultValue
    )
  }

  public static func list(
    settings: SupatermSettings,
    path: String,
    changedOnly: Bool,
    warnings: [String] = []
  ) -> SupatermSettingsListResult {
    let entries = SupatermSettingsKey.allCases
      .map { entry(for: $0, settings: settings) }
      .filter { !changedOnly || !$0.isDefault }
    return SupatermSettingsListResult(path: path, entries: entries, warnings: warnings)
  }

  public static func get(
    key rawKey: String,
    settings: SupatermSettings,
    path: String,
    warnings: [String] = []
  ) throws -> SupatermSettingsGetResult {
    let key = try SupatermSettingsKey(path: rawKey)
    return SupatermSettingsGetResult(
      path: path,
      entry: entry(for: key, settings: settings),
      warnings: warnings
    )
  }

  public static func set(
    _ request: SupatermSettingsSetRequest,
    settings: SupatermSettings,
    path: String
  ) throws -> (settings: SupatermSettings, result: SupatermSettingsMutationResult) {
    let key = try SupatermSettingsKey(path: request.key)
    let oldValue = key.value(in: settings)
    var updatedSettings = settings
    try key.set(request.value, in: &updatedSettings)
    let value = key.value(in: updatedSettings)
    return (
      updatedSettings,
      SupatermSettingsMutationResult(
        path: path,
        key: key.rawValue,
        oldValue: oldValue,
        value: value,
        defaultValue: key.defaultValue,
        isDefault: value == key.defaultValue,
        warnings: oldValue == value ? [] : key.mutationWarnings()
      )
    )
  }

  public static func reset(
    _ request: SupatermSettingsResetRequest,
    settings: SupatermSettings,
    path: String
  ) throws -> (settings: SupatermSettings, result: SupatermSettingsMutationResult) {
    let key = try SupatermSettingsKey(path: request.key)
    let oldValue = key.value(in: settings)
    var updatedSettings = settings
    key.reset(in: &updatedSettings)
    let value = key.value(in: updatedSettings)
    return (
      updatedSettings,
      SupatermSettingsMutationResult(
        path: path,
        key: key.rawValue,
        oldValue: oldValue,
        value: value,
        defaultValue: key.defaultValue,
        isDefault: true,
        warnings: oldValue == value ? [] : key.mutationWarnings()
      )
    )
  }
}

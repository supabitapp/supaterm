import Foundation
import SupatermCLIShared
import TOML

public enum SupatermSettingsCodec {
  public static func decode(_ data: Data) throws -> SupatermSettings {
    if isEmptyToml(data) {
      return .default
    }
    return try decoder().decode(SupatermSettings.self, from: data)
  }

  public static func decodeLegacyJSON(_ data: Data) throws -> SupatermSettings {
    try JSONDecoder().decode(LegacySupatermSettingsFile.self, from: data).supatermSettings
  }

  public static func encode(_ settings: SupatermSettings) throws -> Data {
    if settings == .default {
      return Data()
    }
    return try encoder().encode(settings)
  }

  static func unknownKeyWarnings(in data: Data) throws -> [String] {
    if isEmptyToml(data) {
      return []
    }
    return try decoder().decode(SupatermSettingsUnknownKeyAudit.self, from: data).warnings
  }

  static func needsTerminalZmxKeyMigration(in data: Data) throws -> Bool {
    if isEmptyToml(data) {
      return false
    }
    return try decoder().decode(TerminalZmxMigrationAudit.self, from: data).isNeeded
  }

  public static func decoder() -> TOMLDecoder {
    let decoder = TOMLDecoder()
    return decoder
  }

  public static func encoder() -> TOMLEncoder {
    let encoder = TOMLEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    return encoder
  }

  private static func isEmptyToml(_ data: Data) -> Bool {
    guard let string = String(data: data, encoding: .utf8) else { return false }
    return string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }
}

public struct SupatermSettingsMigration {
  let environment: [String: String]
  let fileManager: FileManager
  let homeDirectoryURL: URL

  public init(
    homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser,
    environment: [String: String] = ProcessInfo.processInfo.environment,
    fileManager: FileManager = .default
  ) {
    self.environment = environment
    self.homeDirectoryURL = homeDirectoryURL
    self.fileManager = fileManager
  }

  public func migrateIfNeeded() throws {
    let settingsURL = SupatermStateRoot.settingsFileURL(
      homeDirectoryPath: homeDirectoryURL.path,
      environment: environment
    )
    let legacyURL = SupatermStateRoot.legacySettingsFileURL(
      homeDirectoryPath: homeDirectoryURL.path,
      environment: environment
    )

    if fileManager.fileExists(atPath: settingsURL.path) {
      guard let data = try? Data(contentsOf: settingsURL) else { return }
      guard let settings = try? SupatermSettingsCodec.decode(data) else { return }
      if try SupatermSettingsCodec.needsTerminalZmxKeyMigration(in: data) {
        let tomlData = try SupatermSettingsCodec.encode(settings)
        _ = try SupatermSettingsCodec.decode(tomlData)
        try tomlData.write(to: settingsURL, options: .atomic)
      }
      try removeItemIfExists(at: legacyURL)
      return
    }

    guard fileManager.fileExists(atPath: legacyURL.path) else { return }
    guard let legacyData = try? Data(contentsOf: legacyURL) else { return }
    guard let settings = try? SupatermSettingsCodec.decodeLegacyJSON(legacyData) else { return }

    let tomlData = try SupatermSettingsCodec.encode(settings)
    _ = try SupatermSettingsCodec.decode(tomlData)
    try fileManager.createDirectory(
      at: settingsURL.deletingLastPathComponent(),
      withIntermediateDirectories: true,
      attributes: nil
    )
    try tomlData.write(to: settingsURL, options: .atomic)
    try removeItemIfExists(at: legacyURL)
  }

  private func removeItemIfExists(at url: URL) throws {
    guard fileManager.fileExists(atPath: url.path) else { return }
    try fileManager.removeItem(at: url)
  }
}

public struct SupatermSettingsValidator {
  let environment: [String: String]
  let fileManager: FileManager
  let homeDirectoryURL: URL

  public init(
    homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser,
    environment: [String: String] = ProcessInfo.processInfo.environment,
    fileManager: FileManager = .default
  ) {
    self.environment = environment
    self.homeDirectoryURL = homeDirectoryURL
    self.fileManager = fileManager
  }

  public func validate(path explicitPath: URL? = nil) -> SupatermSettingsValidationResult {
    let isDefaultPath = explicitPath == nil
    let path =
      explicitPath
      ?? SupatermStateRoot.settingsFileURL(
        homeDirectoryPath: homeDirectoryURL.path,
        environment: environment
      )

    guard fileManager.fileExists(atPath: path.path) else {
      var warnings: [String] = []
      var errors: [String] = []
      if isDefaultPath {
        let legacyURL = SupatermStateRoot.legacySettingsFileURL(
          homeDirectoryPath: homeDirectoryURL.path,
          environment: environment
        )
        if fileManager.fileExists(atPath: legacyURL.path) {
          warnings.append("Legacy settings file found at \(legacyURL.path). Run Supaterm to migrate it.")
        }
      } else {
        errors.append("Config file not found at \(path.path).")
      }
      return SupatermSettingsValidationResult(
        path: path.path,
        status: .missing,
        warnings: warnings,
        errors: errors
      )
    }

    do {
      let data = try Data(contentsOf: path)
      _ = try SupatermSettingsCodec.decode(data)
      return SupatermSettingsValidationResult(
        path: path.path,
        status: .valid,
        warnings: try SupatermSettingsCodec.unknownKeyWarnings(in: data),
        errors: []
      )
    } catch {
      return SupatermSettingsValidationResult(
        path: path.path,
        status: .invalid,
        warnings: [],
        errors: [error.localizedDescription]
      )
    }
  }
}

private struct SupatermSettingsUnknownKeyAudit: Decodable {
  let warnings: [String]

  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: AnyCodingKey.self)
    var warnings: [String] = []

    warnings.append(
      contentsOf: Self.unknownKeys(
        in: container,
        allowedKeys: [
          "appearance",
          "coding_agents",
          "logging",
          "notifications",
          "privacy",
          "shortcuts",
          "terminal",
          "updates",
        ],
        prefix: nil
      )
    )

    warnings.append(
      contentsOf: try Self.unknownShortcutKeys(in: container)
    )
    warnings.append(
      contentsOf: try Self.unknownNestedKeys(
        in: container,
        section: "appearance",
        allowedKeys: ["mode"]
      )
    )
    warnings.append(
      contentsOf: try Self.unknownNestedKeys(
        in: container,
        section: "coding_agents",
        allowedKeys: ["show_panel"]
      )
    )
    warnings.append(
      contentsOf: try Self.unknownNestedKeys(
        in: container,
        section: "logging",
        allowedKeys: ["verbose_enabled"]
      )
    )
    warnings.append(
      contentsOf: try Self.unknownNestedKeys(
        in: container,
        section: "privacy",
        allowedKeys: ["analytics_enabled", "crash_reports_enabled"]
      )
    )
    warnings.append(
      contentsOf: try Self.unknownNestedKeys(
        in: container,
        section: "notifications",
        allowedKeys: ["glowing_pane_ring", "system_notifications", "tab_move_haptics"]
      )
    )
    warnings.append(
      contentsOf: try Self.unknownNestedKeys(
        in: container,
        section: "terminal",
        allowedKeys: [
          "restore_layout",
          "terminate_sessions_on_quit",
          "zmx_sessions_enabled",
        ]
      )
    )
    warnings.append(contentsOf: try Self.unknownNestedKeys(in: container, section: "updates", allowedKeys: ["channel"]))

    self.warnings = warnings.sorted()
  }

  private static func unknownNestedKeys(
    in container: KeyedDecodingContainer<AnyCodingKey>,
    section: String,
    allowedKeys: Set<String>
  ) throws -> [String] {
    guard let key = AnyCodingKey(stringValue: section) else {
      return []
    }
    guard container.contains(key) else {
      return []
    }
    let nested = try container.nestedContainer(keyedBy: AnyCodingKey.self, forKey: key)
    return unknownKeys(in: nested, allowedKeys: allowedKeys, prefix: section)
  }

  private static func unknownShortcutKeys(
    in container: KeyedDecodingContainer<AnyCodingKey>
  ) throws -> [String] {
    guard let shortcutsKey = AnyCodingKey(stringValue: "shortcuts"),
      container.contains(shortcutsKey)
    else {
      return []
    }
    let shortcuts = try container.nestedContainer(keyedBy: AnyCodingKey.self, forKey: shortcutsKey)
    return try shortcuts.allKeys.flatMap { shortcutKey in
      let shortcut = try shortcuts.nestedContainer(keyedBy: AnyCodingKey.self, forKey: shortcutKey)
      return unknownKeys(
        in: shortcut,
        allowedKeys: ["enabled", "key_code", "modifiers"],
        prefix: "shortcuts.\(shortcutKey.stringValue)"
      )
    }
  }

  private static func unknownKeys(
    in container: KeyedDecodingContainer<AnyCodingKey>,
    allowedKeys: Set<String>,
    prefix: String?
  ) -> [String] {
    container.allKeys
      .map(\.stringValue)
      .filter { !allowedKeys.contains($0) }
      .sorted()
      .map { key in
        let path = prefix.map { "\($0).\(key)" } ?? key
        return "Unknown config key `\(path)`."
      }
  }
}

private struct TerminalZmxMigrationAudit: Decodable {
  let isNeeded: Bool

  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: AnyCodingKey.self)
    guard let terminalKey = AnyCodingKey(stringValue: "terminal"), container.contains(terminalKey) else {
      isNeeded = false
      return
    }
    let terminal = try container.nestedContainer(keyedBy: AnyCodingKey.self, forKey: terminalKey)
    guard let legacyKey = AnyCodingKey(stringValue: "terminate_sessions_on_quit") else {
      isNeeded = false
      return
    }
    isNeeded = terminal.contains(legacyKey)
  }
}

private struct AnyCodingKey: CodingKey, Hashable {
  var stringValue: String
  var intValue: Int?

  init?(stringValue: String) {
    self.stringValue = stringValue
    self.intValue = nil
  }

  init?(intValue: Int) {
    self.stringValue = "\(intValue)"
    self.intValue = intValue
  }
}

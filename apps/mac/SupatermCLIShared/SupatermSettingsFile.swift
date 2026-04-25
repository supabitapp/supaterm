import Foundation
import TOML

public enum SupatermSettingsValidationStatus: String, Codable, Sendable {
  case invalid
  case missing
  case valid
}

public struct SupatermSettingsValidationResult: Codable, Equatable, Sendable {
  public let path: String
  public let status: SupatermSettingsValidationStatus
  public let warnings: [String]
  public let errors: [String]

  public init(
    path: String,
    status: SupatermSettingsValidationStatus,
    warnings: [String],
    errors: [String]
  ) {
    self.path = path
    self.status = status
    self.warnings = warnings
    self.errors = errors
  }

  public var isFailure: Bool {
    !errors.isEmpty || status == .invalid
  }
}

public enum SupatermSettingsCodec {
  public static func decode(_ data: Data) throws -> SupatermSettings {
    try decoder().decode(SupatermSettings.self, from: data)
  }

  public static func decodeLegacyJSON(_ data: Data) throws -> SupatermSettings {
    try JSONDecoder().decode(LegacySupatermSettingsFile.self, from: data).supatermSettings
  }

  public static func encode(_ settings: SupatermSettings) throws -> Data {
    try encoder().encode(settings)
  }

  static func unknownKeyWarnings(in data: Data) throws -> [String] {
    try decoder().decode(SupatermSettingsUnknownKeyAudit.self, from: data).warnings
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

  public static func migrateDefaultSettingsIfNeeded() {
    try? Self().migrateIfNeeded()
  }

  public func migrateIfNeeded() throws {
    let settingsURL = SupatermSettings.defaultURL(
      homeDirectoryPath: homeDirectoryURL.path,
      environment: environment
    )
    let legacyURL = SupatermSettings.legacyURL(
      homeDirectoryPath: homeDirectoryURL.path,
      environment: environment
    )

    if fileManager.fileExists(atPath: settingsURL.path) {
      guard let data = try? Data(contentsOf: settingsURL) else { return }
      guard (try? SupatermSettingsCodec.decode(data)) != nil else { return }
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
      ?? SupatermSettings.defaultURL(
        homeDirectoryPath: homeDirectoryURL.path,
        environment: environment
      )

    guard fileManager.fileExists(atPath: path.path) else {
      var warnings: [String] = []
      var errors: [String] = []
      if isDefaultPath {
        let legacyURL = SupatermSettings.legacyURL(
          homeDirectoryPath: homeDirectoryURL.path,
          environment: environment
        )
        if fileManager.fileExists(atPath: legacyURL.path) {
          warnings.append("Legacy settings file found at \(legacyURL.path). Run Supaterm to migrate it.")
        }
      } else {
        errors.append("Config file not found at \(path.path).")
      }
      return .init(
        path: path.path,
        status: .missing,
        warnings: warnings,
        errors: errors
      )
    }

    do {
      let data = try Data(contentsOf: path)
      _ = try SupatermSettingsCodec.decode(data)
      return .init(
        path: path.path,
        status: .valid,
        warnings: try SupatermSettingsCodec.unknownKeyWarnings(in: data),
        errors: []
      )
    } catch {
      return .init(
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
        allowedKeys: ["appearance", "notifications", "privacy", "terminal", "updates"],
        prefix: nil
      )
    )

    warnings.append(contentsOf: try Self.unknownNestedKeys(in: container, section: "appearance", allowedKeys: ["mode"]))
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
        allowedKeys: ["glowing_pane_ring", "system_notifications"]
      )
    )
    warnings.append(
      contentsOf: try Self.unknownNestedKeys(
        in: container,
        section: "terminal",
        allowedKeys: ["new_tab_position", "restore_layout"]
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

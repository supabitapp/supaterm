import Foundation

public enum SupatermSettingsSchema {
  public static let url = "https://supaterm.com/data/supaterm-settings.schema.json"

  public static func jsonString() throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    return String(decoding: try encoder.encode(schemaObject()), as: UTF8.self)
  }

  private static func schemaObject() -> JSONValue {
    .object([
      "$schema": .string("https://json-schema.org/draft/2020-12/schema"),
      "$id": .string(url),
      "title": .string("supaterm settings.json"),
      "description": .string("User-level Supaterm settings."),
      "type": .string("object"),
      "additionalProperties": .bool(false),
      "properties": .object(properties()),
    ])
  }

  private static func properties() -> [String: JSONValue] {
    var properties = [
      "$schema": schemaProperty(
        type: "string",
        defaultValue: .string(url),
        description: "Optional schema URL for editor completion and validation.",
        format: "uri"
      )
    ]
    for key in AppPrefs.CodingKeys.allCases {
      properties[key.rawValue] = schemaProperty(for: key)
    }
    return properties
  }

  private static func schemaProperty(for key: AppPrefs.CodingKeys) -> JSONValue {
    switch key {
    case .appearanceMode:
      return schemaProperty(
        type: "string",
        defaultValue: .string(AppPrefs.default.appearanceMode.rawValue),
        description: "App appearance mode.",
        enumValues: AppearanceMode.allCases.map(\.rawValue)
      )
    case .analyticsEnabled:
      return schemaProperty(
        type: "boolean",
        defaultValue: .bool(AppPrefs.default.analyticsEnabled),
        description: "Allow anonymous telemetry."
      )
    case .crashReportsEnabled:
      return schemaProperty(
        type: "boolean",
        defaultValue: .bool(AppPrefs.default.crashReportsEnabled),
        description: "Allow crash reports."
      )
    case .restoreTerminalLayoutEnabled:
      return schemaProperty(
        type: "boolean",
        defaultValue: .bool(AppPrefs.default.restoreTerminalLayoutEnabled),
        description: "Restore spaces, tabs, and panes on launch."
      )
    case .systemNotificationsEnabled:
      return schemaProperty(
        type: "boolean",
        defaultValue: .bool(AppPrefs.default.systemNotificationsEnabled),
        description: "Deliver desktop notifications for terminal activity."
      )
    case .updateChannel:
      return schemaProperty(
        type: "string",
        defaultValue: .string(AppPrefs.default.updateChannel.rawValue),
        description: "Select stable or tip updates.",
        enumValues: UpdateChannel.allCases.map(\.rawValue)
      )
    }
  }

  private static func schemaProperty(
    type: String,
    defaultValue: JSONValue,
    description: String,
    format: String? = nil,
    enumValues: [String]? = nil
  ) -> JSONValue {
    var object: [String: JSONValue] = [
      "type": .string(type),
      "default": defaultValue,
      "description": .string(description),
    ]
    if let format {
      object["format"] = .string(format)
    }
    if let enumValues {
      object["enum"] = .array(enumValues.map(JSONValue.string))
    }
    return .object(object)
  }
}

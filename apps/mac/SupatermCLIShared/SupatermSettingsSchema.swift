import Foundation

public enum SupatermSettingsSchema {
  static let schemaKey = "$schema"
  public static let url = "https://supaterm.com/data/supaterm-settings.schema.json"

  public static func jsonString() throws -> String {
    try schemaObject().stableJSONString()
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
      schemaKey: schemaProperty(
        defaultValue: .string(url),
        description: "Optional schema URL for editor completion and validation.",
        format: "uri"
      )
    ]
    for key in SupatermSettings.CodingKeys.allCases {
      properties[key.rawValue] = schemaProperty(for: key)
    }
    return properties
  }

  private static func schemaProperty(for key: SupatermSettings.CodingKeys) -> JSONValue {
    let defaultValue = SupatermSettings.default.value(for: key)
    return schemaProperty(
      defaultValue: defaultValue,
      description: key.schemaDescription,
      enumValues: key.schemaEnumValues
    )
  }

  private static func schemaProperty(
    defaultValue: JSONValue,
    description: String,
    format: String? = nil,
    enumValues: [String]? = nil
  ) -> JSONValue {
    var object: [String: JSONValue] = [
      "type": .string(jsonSchemaType(for: defaultValue)),
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

  private static func jsonSchemaType(for value: JSONValue) -> String {
    switch value {
    case .null:
      return "null"
    case .bool:
      return "boolean"
    case .int:
      return "integer"
    case .double:
      return "number"
    case .string:
      return "string"
    case .array:
      return "array"
    case .object:
      return "object"
    }
  }
}

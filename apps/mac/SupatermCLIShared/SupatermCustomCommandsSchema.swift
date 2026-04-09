import Foundation

public enum SupatermCustomCommandsSchema {
  static let schemaKey = "$schema"
  public static let url = "https://supaterm.com/data/supaterm-custom-commands.schema.json"

  public static func jsonString() throws -> String {
    try schemaObject().stableJSONString()
  }

  private static func schemaObject() -> JSONValue {
    .object([
      "$schema": .string("https://json-schema.org/draft/2020-12/schema"),
      "$id": .string(url),
      "title": .string("supaterm.json"),
      "description": .string("User-defined command palette commands and workspaces for Supaterm."),
      "type": .string("object"),
      "additionalProperties": .bool(false),
      "properties": .object(properties()),
      "$defs": .object(definitions()),
      "required": .array([.string("commands")]),
    ])
  }

  private static func properties() -> [String: JSONValue] {
    [
      schemaKey: schemaProperty(
        defaultValue: .string(url),
        description: "Optional schema URL for editor completion and validation.",
        format: "uri"
      ),
      "commands": .object([
        "type": .string("array"),
        "description": .string("The command-palette commands available in this scope."),
        "items": .object([
          "$ref": .string("#/$defs/command"),
        ]),
      ]),
    ]
  }

  private static func definitions() -> [String: JSONValue] {
    [
      "command": commandDefinition(),
      "simpleCommand": simpleCommandDefinition(),
      "workspaceCommand": workspaceCommandDefinition(),
      "workspace": workspaceDefinition(),
      "tab": tabDefinition(),
      "pane": paneDefinition(),
      "leafPane": leafPaneDefinition(),
      "splitPane": splitPaneDefinition(),
    ]
  }

  private static func commandDefinition() -> JSONValue {
    .object([
      "oneOf": .array([
        .object(["$ref": .string("#/$defs/simpleCommand")]),
        .object(["$ref": .string("#/$defs/workspaceCommand")]),
      ]),
    ])
  }

  private static func simpleCommandDefinition() -> JSONValue {
    .object([
      "type": .string("object"),
      "additionalProperties": .bool(false),
      "properties": .object(baseCommandProperties(kind: "command", extras: [
        "command": .object([
          "type": .string("string"),
          "description": .string("Shell text to send to the focused pane."),
        ]),
      ])),
      "required": .array([.string("id"), .string("kind"), .string("name"), .string("command")]),
    ])
  }

  private static func workspaceCommandDefinition() -> JSONValue {
    .object([
      "type": .string("object"),
      "additionalProperties": .bool(false),
      "properties": .object(baseCommandProperties(kind: "workspace", extras: [
        "restartBehavior": .object([
          "type": .string("string"),
          "description": .string("What to do when a space with the same name already exists."),
          "default": .string(SupatermWorkspaceRestartBehavior.focusExisting.rawValue),
          "enum": .array(SupatermWorkspaceRestartBehavior.allCases.map { .string($0.rawValue) }),
        ]),
        "workspace": .object([
          "$ref": .string("#/$defs/workspace"),
        ]),
      ])),
      "required": .array([.string("id"), .string("kind"), .string("name"), .string("workspace")]),
    ])
  }

  private static func workspaceDefinition() -> JSONValue {
    .object([
      "type": .string("object"),
      "additionalProperties": .bool(false),
      "properties": .object([
        "spaceName": .object([
          "type": .string("string"),
          "description": .string("The target space name for this workspace."),
        ]),
        "tabs": .object([
          "type": .string("array"),
          "items": .object(["$ref": .string("#/$defs/tab")]),
        ]),
      ]),
      "required": .array([.string("spaceName"), .string("tabs")]),
    ])
  }

  private static func tabDefinition() -> JSONValue {
    .object([
      "type": .string("object"),
      "additionalProperties": .bool(false),
      "properties": .object([
        "title": .object([
          "type": .string("string"),
          "description": .string("The locked title for the tab."),
        ]),
        "cwd": .object([
          "type": .string("string"),
          "description": .string("Optional working directory for panes in this tab."),
        ]),
        "selected": .object([
          "type": .string("boolean"),
          "default": .bool(false),
          "description": .string("Whether this tab should be selected after launch."),
        ]),
        "rootPane": .object([
          "$ref": .string("#/$defs/pane"),
        ]),
      ]),
      "required": .array([.string("title"), .string("rootPane")]),
    ])
  }

  private static func paneDefinition() -> JSONValue {
    .object([
      "oneOf": .array([
        .object(["$ref": .string("#/$defs/leafPane")]),
        .object(["$ref": .string("#/$defs/splitPane")]),
      ]),
    ])
  }

  private static func leafPaneDefinition() -> JSONValue {
    .object([
      "type": .string("object"),
      "additionalProperties": .bool(false),
      "properties": .object([
        "type": .object([
          "type": .string("string"),
          "const": .string("leaf"),
        ]),
        "title": .object([
          "type": .string("string"),
        ]),
        "cwd": .object([
          "type": .string("string"),
        ]),
        "command": .object([
          "type": .string("string"),
        ]),
        "focus": .object([
          "type": .string("boolean"),
          "default": .bool(false),
        ]),
        "env": .object([
          "type": .string("object"),
          "additionalProperties": .object([
            "type": .string("string"),
          ]),
          "default": .object([:]),
        ]),
      ]),
      "required": .array([.string("type")]),
    ])
  }

  private static func splitPaneDefinition() -> JSONValue {
    .object([
      "type": .string("object"),
      "additionalProperties": .bool(false),
      "properties": .object([
        "type": .object([
          "type": .string("string"),
          "const": .string("split"),
        ]),
        "direction": .object([
          "type": .string("string"),
          "enum": .array(SupatermWorkspaceSplitDirection.allCases.map { .string($0.rawValue) }),
        ]),
        "ratio": .object([
          "type": .string("number"),
          "default": .double(0.5),
        ]),
        "first": .object([
          "$ref": .string("#/$defs/pane"),
        ]),
        "second": .object([
          "$ref": .string("#/$defs/pane"),
        ]),
      ]),
      "required": .array([.string("type"), .string("direction"), .string("first"), .string("second")]),
    ])
  }

  private static func baseCommandProperties(
    kind: String,
    extras: [String: JSONValue]
  ) -> [String: JSONValue] {
    var properties: [String: JSONValue] = [
      "id": .object([
        "type": .string("string"),
        "description": .string("Stable command identifier used for local-over-global overrides."),
      ]),
      "kind": .object([
        "type": .string("string"),
        "const": .string(kind),
      ]),
      "name": .object([
        "type": .string("string"),
        "description": .string("Visible title in the command palette."),
      ]),
      "description": .object([
        "type": .string("string"),
        "description": .string("Optional subtitle in the command palette."),
      ]),
      "keywords": .object([
        "type": .string("array"),
        "items": .object(["type": .string("string")]),
        "default": .array([]),
        "description": .string("Extra search terms for fuzzy matching."),
      ]),
    ]
    for (key, value) in extras {
      properties[key] = value
    }
    return properties
  }

  private static func schemaProperty(
    defaultValue: JSONValue,
    description: String,
    format: String? = nil
  ) -> JSONValue {
    var object: [String: JSONValue] = [
      "type": .string(jsonSchemaType(for: defaultValue)),
      "default": defaultValue,
      "description": .string(description),
    ]
    if let format {
      object["format"] = .string(format)
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

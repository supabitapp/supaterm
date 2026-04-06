import Foundation
import Testing

@testable import SupatermCLIShared

struct SupatermSettingsSchemaTests {
  @Test
  func generatedSchemaMatchesCurrentAppPrefsShape() throws {
    let data = Data(try SupatermSettingsSchema.jsonString().utf8)
    let value = try JSONDecoder().decode(JSONValue.self, from: data)
    let object = try #require(value.objectValue)
    let properties = try #require(object["properties"]?.objectValue)
    let appearanceMode = try #require(properties["appearanceMode"]?.objectValue)
    let updateChannel = try #require(properties["updateChannel"]?.objectValue)
    let expectedKeys = Set(SupatermSettings.CodingKeys.allCases.map(\.rawValue)).union(["$schema"])

    #expect(object["$id"]?.stringValue == SupatermSettingsSchema.url)
    #expect(object["additionalProperties"]?.boolValue == false)
    #expect(Set(properties.keys) == expectedKeys)
    #expect(appearanceMode["default"]?.stringValue == SupatermSettings.default.appearanceMode.rawValue)
    #expect(appearanceMode["enum"]?.arrayValue == AppearanceMode.allCases.map { .string($0.rawValue) })
    #expect(updateChannel["default"]?.stringValue == SupatermSettings.default.updateChannel.rawValue)
    #expect(updateChannel["enum"]?.arrayValue == UpdateChannel.allCases.map { .string($0.rawValue) })
  }

  @Test
  func committedWebSchemaMatchesGeneratedSchema() throws {
    let fileURL = repoRootURL()
      .appendingPathComponent("apps/supaterm.com")
      .appendingPathComponent("public/data/supaterm-settings.schema.json")
    let committedSchema = try String(contentsOf: fileURL, encoding: .utf8)
    let generatedSchema = try SupatermSettingsSchema.jsonString() + "\n"

    #expect(committedSchema == generatedSchema)
  }

  private func repoRootURL(filePath: StaticString = #filePath) -> URL {
    URL(fileURLWithPath: "\(filePath)")
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
  }
}

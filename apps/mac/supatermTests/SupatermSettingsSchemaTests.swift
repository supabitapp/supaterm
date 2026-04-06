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
    let expectedKeys = Set(AppPrefs.CodingKeys.allCases.map(\.rawValue)).union(["$schema"])

    #expect(object["$id"]?.stringValue == SupatermSettingsSchema.url)
    #expect(object["additionalProperties"]?.boolValue == false)
    #expect(Set(properties.keys) == expectedKeys)
    #expect(appearanceMode["default"]?.stringValue == AppPrefs.default.appearanceMode.rawValue)
    #expect(appearanceMode["enum"]?.arrayValue == AppearanceMode.allCases.map { .string($0.rawValue) })
    #expect(updateChannel["default"]?.stringValue == AppPrefs.default.updateChannel.rawValue)
    #expect(updateChannel["enum"]?.arrayValue == UpdateChannel.allCases.map { .string($0.rawValue) })
  }
}

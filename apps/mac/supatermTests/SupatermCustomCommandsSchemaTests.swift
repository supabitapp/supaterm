import Foundation
import Testing

@testable import SupatermCLIShared

struct SupatermCustomCommandsSchemaTests {
  @Test
  func generatedSchemaHasCommandsArrayAndExpectedKinds() throws {
    let data = Data(try SupatermCustomCommandsSchema.jsonString().utf8)
    let value = try JSONDecoder().decode(JSONValue.self, from: data)
    let object = try #require(value.objectValue)
    let properties = try #require(object["properties"]?.objectValue)
    let commands = try #require(properties["commands"]?.objectValue)
    let definitions = try #require(object["$defs"]?.objectValue)
    let workspaceCommand = try #require(definitions["workspaceCommand"]?.objectValue)
    let workspaceProperties = try #require(workspaceCommand["properties"]?.objectValue)
    let restartBehavior = try #require(workspaceProperties["restartBehavior"]?.objectValue)

    #expect(object["$id"]?.stringValue == SupatermCustomCommandsSchema.url)
    #expect(commands["type"]?.stringValue == "array")
    #expect(
      restartBehavior["enum"]?.arrayValue == SupatermWorkspaceRestartBehavior.allCases.map { .string($0.rawValue) })
  }

  @Test
  func committedWebSchemaMatchesGeneratedSchema() throws {
    let fileURL = repoRootURL()
      .appendingPathComponent("apps/supaterm.com")
      .appendingPathComponent("public/data/supaterm-custom-commands.schema.json")
    let committedSchema = try JSONDecoder().decode(
      JSONValue.self,
      from: Data(try String(contentsOf: fileURL, encoding: .utf8).utf8)
    )
    let generatedSchema = try JSONDecoder().decode(
      JSONValue.self,
      from: Data(try SupatermCustomCommandsSchema.jsonString().utf8)
    )

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

import Foundation
import SupatermCLIShared
import Testing

@testable import supaterm

struct TerminalSpaceCatalogTests {
  @Test
  func decoderRejectsPreviousSchema() throws {
    let data = Data("{\"version\":1}".utf8)

    #expect(throws: DecodingError.self) {
      try JSONDecoder().decode(TerminalSpaceCatalog.self, from: data)
    }
  }

  @Test
  func directoryURLsRoundTripThroughCurrentSchema() throws {
    let project = TerminalProjectItem(
      directoryURL: URL(fileURLWithPath: "/tmp/Workspace", isDirectory: true)
    )
    let space = PersistedTerminalSpace(name: "A", projects: [project])
    let catalog = TerminalSpaceCatalog(defaultSelectedSpaceID: space.id, spaces: [space])

    let data = try TerminalSpaceCatalog.fileStorageEncoder().encode(catalog)
    let decoded = try JSONDecoder().decode(TerminalSpaceCatalog.self, from: data)

    #expect(decoded == catalog)
  }

  @Test
  func defaultURLUsesConfigDirectoryUnderProvidedHomeDirectory() {
    let homeDirectory = "/tmp/SupatermTests/Home"

    #expect(
      TerminalSpaceCatalog.defaultURL(homeDirectoryPath: homeDirectory, environment: [:])
        == URL(fileURLWithPath: homeDirectory, isDirectory: true)
        .appendingPathComponent(".config", isDirectory: true)
        .appendingPathComponent("supaterm", isDirectory: true)
        .appendingPathComponent("spaces.json", isDirectory: false)
    )
  }

  @Test
  func defaultURLUsesStateHomeWhenPresent() {
    #expect(
      TerminalSpaceCatalog.defaultURL(
        homeDirectoryPath: "/tmp/ignored",
        environment: [SupatermCLIEnvironment.stateHomeKey: "/tmp/supaterm-dev"]
      ).path == "/tmp/supaterm-dev/spaces.json"
    )
  }

  @Test
  func sanitizedFallsBackToDefaultCatalogWhenCatalogIsMissingOrInvalid() {
    let invalidSpace = PersistedTerminalSpace(name: "   ")

    let catalog = TerminalSpaceCatalog.sanitized(
      TerminalSpaceCatalog(
        defaultSelectedSpaceID: invalidSpace.id,
        spaces: [invalidSpace]
      )
    )

    #expect(catalog.spaces.map(\.name) == ["1"])
    #expect(catalog.defaultSelectedSpaceID == catalog.spaces[0].id)
  }

  @Test
  func sanitizedFallsBackToFirstSpaceWhenPersistedDefaultIsMissing() {
    let firstSpace = PersistedTerminalSpace(
      id: TerminalSpaceID(rawValue: UUID(uuidString: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA")!),
      name: "A"
    )
    let secondSpace = PersistedTerminalSpace(
      id: TerminalSpaceID(rawValue: UUID(uuidString: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB")!),
      name: "B"
    )

    let catalog = TerminalSpaceCatalog.sanitized(
      TerminalSpaceCatalog(
        defaultSelectedSpaceID: TerminalSpaceID(),
        spaces: [firstSpace, secondSpace]
      )
    )

    #expect(catalog.defaultSelectedSpaceID == firstSpace.id)
    #expect(catalog.spaces.map(\.name) == ["A", "B"])
  }
}

import Foundation
import SupatermCLIShared
import Testing

@testable import supaterm

struct TerminalSpaceCatalogTests {
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
      .init(
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
      .init(
        defaultSelectedSpaceID: TerminalSpaceID(),
        spaces: [firstSpace, secondSpace]
      )
    )

    #expect(catalog.defaultSelectedSpaceID == firstSpace.id)
    #expect(catalog.spaces.map(\.name) == ["A", "B"])
  }
}

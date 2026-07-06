import Foundation
import SupaTheme
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
      TerminalSpaceCatalog(
        defaultSelectedSpaceID: invalidSpace.id,
        spaces: [invalidSpace]
      )
    )

    #expect(catalog.spaces.map(\.name) == ["1"])
    #expect(catalog.spaces.map(\.themeID) == [Theme.default.id])
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

  @Test
  func sanitizedPreservesValidThemesAndNormalizesUnknownThemes() {
    let firstSpace = PersistedTerminalSpace(
      id: TerminalSpaceID(rawValue: UUID(uuidString: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA")!),
      name: "A",
      themeID: Theme.steelBlue.id
    )
    let secondSpace = PersistedTerminalSpace(
      id: TerminalSpaceID(rawValue: UUID(uuidString: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB")!),
      name: "B",
      themeID: "missing-theme"
    )

    let catalog = TerminalSpaceCatalog.sanitized(
      TerminalSpaceCatalog(
        defaultSelectedSpaceID: firstSpace.id,
        spaces: [firstSpace, secondSpace]
      )
    )

    #expect(catalog.spaces.map(\.themeID) == [Theme.steelBlue.id, Theme.default.id])
  }

  @Test
  func persistedSpaceDecodesMissingThemeAsDefaultTheme() throws {
    let data = Data(
      #"""
      {
        "defaultSelectedSpaceID": {
          "rawValue": "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA"
        },
        "spaces": [
          {
            "id": {
              "rawValue": "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA"
            },
            "name": "A"
          }
        ]
      }
      """#.utf8
    )

    let catalog = try JSONDecoder().decode(TerminalSpaceCatalog.self, from: data)

    #expect(catalog.spaces.map(\.themeID) == [Theme.default.id])
  }

  @Test
  func createThemeSelectionFallsBackToAllThemesWhenAllAreUsed() {
    let selectedThemeID = TerminalSpaceThemeSelection.randomThemeID(
      usedThemeIDs: Theme.curated.map(\.id),
      randomIndex: { count in
        #expect(count == Theme.curated.count)
        return Theme.curated.firstIndex(where: { $0.id == Theme.steelBlue.id })!
      }
    )

    #expect(selectedThemeID == Theme.steelBlue.id)
  }
}

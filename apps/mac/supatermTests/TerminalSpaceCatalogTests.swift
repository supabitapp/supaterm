import Foundation
import SupaTheme
import SupatermCLIShared
import Testing

@testable import supaterm

struct TerminalSpaceCatalogTests {
  @Test
  func spacesJSONWithoutColorDecodesAsNeutral() throws {
    let json = Data(
      """
      {"defaultSelectedSpaceID":{"rawValue":"00000000-0000-0000-0000-000000000001"},"spaces":\
      [{"id":{"rawValue":"00000000-0000-0000-0000-000000000001"},"name":"Space 1"}]}
      """.utf8
    )
    let catalog = try JSONDecoder().decode(TerminalSpaceCatalog.self, from: json)
    #expect(catalog.spaces.map(\.color) == [.neutral])
  }

  @Test
  func spaceColorRoundTripsThroughJSON() throws {
    let space = TerminalSpaceItem(name: "Work", color: .green)
    let data = try TerminalSpaceCatalog.fileStorageEncoder().encode(
      TerminalSpaceCatalog(defaultSelectedSpaceID: space.id, spaces: [space])
    )
    let decoded = try JSONDecoder().decode(TerminalSpaceCatalog.self, from: data)
    #expect(decoded.spaces.map(\.color) == [.green])
  }

  @Test
  func sanitizedPreservesSpaceColor() {
    let space = TerminalSpaceItem(name: "  Work  ", color: .purple)

    let catalog = TerminalSpaceCatalog.sanitized(
      TerminalSpaceCatalog(defaultSelectedSpaceID: space.id, spaces: [space])
    )

    #expect(catalog.spaces.map(\.color) == [.purple])
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
  func defaultSpaceIdentityIsStableAcrossLaunches() {
    #expect(
      TerminalSpaceCatalog.default.defaultSelectedSpaceID
        == TerminalSpaceID(rawValue: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!)
    )
  }

  @Test
  func sanitizedFallsBackToDefaultCatalogWhenCatalogIsMissingOrInvalid() {
    let invalidSpace = TerminalSpaceItem(name: "   ")

    let catalog = TerminalSpaceCatalog.sanitized(
      TerminalSpaceCatalog(
        defaultSelectedSpaceID: invalidSpace.id,
        spaces: [invalidSpace]
      )
    )

    #expect(catalog.spaces.map(\.name) == ["Space 1"])
    #expect(catalog.defaultSelectedSpaceID == catalog.spaces[0].id)
  }

  @Test
  func sanitizedFallsBackToFirstSpaceWhenPersistedDefaultIsMissing() {
    let firstSpace = TerminalSpaceItem(
      id: TerminalSpaceID(rawValue: UUID(uuidString: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA")!),
      name: "A"
    )
    let secondSpace = TerminalSpaceItem(
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
  func movingSpaceUsesAnInsertionBoundary() {
    let spaces = [
      TerminalSpaceItem(name: "A"),
      TerminalSpaceItem(name: "B"),
      TerminalSpaceItem(name: "C"),
      TerminalSpaceItem(name: "D"),
    ]
    var catalog = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)

    let movedToEnd = catalog.moveSpace(spaces[1].id, toInsertionIndex: 4)
    #expect(movedToEnd)
    #expect(catalog.spaces.map(\.name) == ["A", "C", "D", "B"])
    let movedToStart = catalog.moveSpace(spaces[3].id, toInsertionIndex: 0)
    #expect(movedToStart)
    #expect(catalog.spaces.map(\.name) == ["D", "A", "C", "B"])
  }

  @Test
  func movingSpaceToItsOwnBoundaryDoesNothing() {
    let spaces = [TerminalSpaceItem(name: "A"), TerminalSpaceItem(name: "B")]
    var catalog = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)

    let didMove = catalog.moveSpace(spaces[0].id, toInsertionIndex: 1)
    #expect(!didMove)
    #expect(catalog.spaces.map(\.name) == ["A", "B"])
  }
}

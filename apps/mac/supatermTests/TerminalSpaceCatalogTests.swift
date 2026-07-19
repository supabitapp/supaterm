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
  func defaultSpaceIdentityIsStableAcrossLaunches() {
    #expect(
      TerminalSpaceCatalog.default.defaultSelectedSpaceID
        == TerminalSpaceID(rawValue: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!)
    )
    #expect(
      TerminalSpaceCatalog.default.spaces[0].projects.first(where: \.isHome)?.id
        == TerminalProjectID.home(for: TerminalSpaceCatalog.default.defaultSelectedSpaceID)
    )
    #expect(TerminalSpaceCatalog.default.version == TerminalSpaceCatalog.currentVersion)
  }

  @Test
  func catalogRejectsPreviousVersion() {
    let data = Data(
      """
      {"version":0,"defaultSelectedSpaceID":{"rawValue":"00000000-0000-0000-0000-000000000001"},"spaces":[]}
      """.utf8
    )

    #expect(throws: DecodingError.self) {
      try JSONDecoder().decode(TerminalSpaceCatalog.self, from: data)
    }
  }

  @Test
  func sanitizedFallsBackToDefaultCatalogWhenCatalogIsMissingOrInvalid() {
    let invalidSpace = PersistedTerminalSpace(name: "   ")

    let catalog = TerminalSpaceCatalog.sanitized(
      TerminalSpaceCatalog(
        defaultSelectedSpaceID: invalidSpace.id,
        spaces: [invalidSpace]
      ),
      homeDirectoryPath: "/Users/khoi"
    )

    #expect(catalog.spaces.map(\.name) == ["1"])
    #expect(catalog.defaultSelectedSpaceID == catalog.spaces[0].id)
    #expect(catalog.spaces[0].projects.first(where: \.isHome)?.folderPath == "/Users/khoi")
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
  func sanitizedGuaranteesExactlyOneStableHomeProject() throws {
    let spaceID = TerminalSpaceID()
    let firstHomeID = TerminalProjectID()
    let catalog = TerminalSpaceCatalog.sanitized(
      TerminalSpaceCatalog(
        defaultSelectedSpaceID: spaceID,
        spaces: [
          PersistedTerminalSpace(
            id: spaceID,
            name: "A",
            projects: [
              TerminalProjectItem(
                id: firstHomeID,
                folderPath: "/wrong",
                isPinned: true,
                kind: .home
              ),
              TerminalProjectItem(
                folderPath: "/also-wrong",
                kind: .home
              ),
              TerminalProjectItem(folderPath: "/work/repo"),
            ]
          )
        ]
      ),
      homeDirectoryPath: "/Users/khoi"
    )

    let projects = try #require(catalog.spaces.first?.projects)
    let homeProjects = projects.filter(\.isHome)
    #expect(homeProjects.count == 1)
    #expect(homeProjects[0].id == firstHomeID)
    #expect(homeProjects[0].folderPath == "/Users/khoi")
    #expect(homeProjects[0].isPinned)
  }

  @Test
  func orderedProjectsFloatPinnedAndComputeDisambiguatedNames() throws {
    let spaceID = TerminalSpaceID()
    let first = TerminalProjectItem(folderPath: "/work/alpha/repo")
    let second = TerminalProjectItem(folderPath: "/work/beta/repo", isPinned: true)
    let home = TerminalProjectItem.home(for: spaceID, folderPath: "/Users/khoi")
    let catalog = TerminalSpaceCatalog.sanitized(
      TerminalSpaceCatalog(
        defaultSelectedSpaceID: spaceID,
        spaces: [
          PersistedTerminalSpace(
            id: spaceID,
            name: "A",
            projects: [first, home, second]
          )
        ]
      ),
      homeDirectoryPath: "/Users/khoi"
    )

    #expect(catalog.orderedProjects(in: spaceID).map(\.id) == [second.id, first.id, home.id])
    #expect(catalog.displayName(for: home.id, in: spaceID) == "Home")
    #expect(catalog.displayName(for: first.id, in: spaceID) == "repo (alpha)")
    #expect(catalog.displayName(for: second.id, in: spaceID) == "repo (beta)")
  }
}

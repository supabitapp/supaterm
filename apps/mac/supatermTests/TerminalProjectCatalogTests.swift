import Foundation
import SupaTheme
import SupatermCLIShared
import Testing

@testable import supaterm

struct TerminalProjectCatalogTests {
  @Test
  func validationNormalizesOneProject() throws {
    let project = TerminalProject(
      name: "  Work  ",
      rootPath: "~/code/work",
      color: .purple,
      isPinned: true
    )

    let catalog = try TerminalProjectCatalog(projects: [project]).validated(
      homeDirectoryPath: "/Users/test"
    )

    #expect(catalog.projects.map(\.name) == ["Work"])
    #expect(catalog.projects.map(\.rootPath) == ["/Users/test/code/work"])
    #expect(catalog.projects.map(\.color) == [.purple])
    #expect(catalog.projects.map(\.isPinned) == [true])
  }

  @Test
  func validationRejectsInvalidNames() {
    #expect(throws: TerminalProjectCatalogError.emptyName) {
      try TerminalProjectCatalog(projects: [TerminalProject(name: "  ")]).validated()
    }
    #expect(throws: TerminalProjectCatalogError.duplicateName("work")) {
      try TerminalProjectCatalog(
        projects: [TerminalProject(name: "Work"), TerminalProject(name: " work ")]
      ).validated()
    }
  }

  @Test
  func validationRejectsInvalidAndDuplicateRoots() throws {
    #expect(throws: TerminalProjectCatalogError.relativeRootPath("work")) {
      try TerminalProjectCatalog(projects: [TerminalProject(name: "Work", rootPath: "work")])
        .validated()
    }

    let container = FileManager.default.temporaryDirectory.appending(
      path: UUID().uuidString,
      directoryHint: .isDirectory
    )
    let directory = container.appending(path: "work", directoryHint: .isDirectory)
    let alias = container.appending(path: "alias", directoryHint: .isDirectory)
    let file = container.appending(path: "file")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: directory)
    try Data().write(to: file)
    defer { try? FileManager.default.removeItem(at: container) }

    #expect(throws: TerminalProjectCatalogError.nonDirectoryRoot(file.path)) {
      try TerminalProjectCatalog(projects: [TerminalProject(name: "File", rootPath: file.path)])
        .validated()
    }
    #expect(throws: TerminalProjectCatalogError.duplicateRoot(directory.resolvingSymlinksInPath().path)) {
      try TerminalProjectCatalog(
        projects: [
          TerminalProject(name: "Work", rootPath: directory.path),
          TerminalProject(name: "Alias", rootPath: alias.path),
        ]
      ).validated()
    }

    let missing = container.appending(path: "missing", directoryHint: .isDirectory)
    let lexicalAlias = container.appending(path: "nested/../missing", directoryHint: .isDirectory)
    #expect(throws: TerminalProjectCatalogError.duplicateRoot(missing.path)) {
      try TerminalProjectCatalog(
        projects: [
          TerminalProject(name: "Missing", rootPath: missing.path),
          TerminalProject(name: "Missing Alias", rootPath: lexicalAlias.path),
        ]
      ).validated()
    }
  }

  @Test
  func catalogUsesProjectsStateFileAndSortedJSON() throws {
    let project = TerminalProject(
      id: TerminalProjectID(
        rawValue: UUID(uuidString: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA")!
      ),
      name: "Work"
    )
    let data = try TerminalProjectCatalog.fileStorageEncoder().encode(
      TerminalProjectCatalog(projects: [project])
    )

    #expect(project.color == .neutral)
    let json = try #require(String(bytes: data, encoding: .utf8))
    let expected =
      "{\"projects\":[{\"color\":\"neutral\",\"id\":{\"rawValue\":\"AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA\"},"
      + "\"isPinned\":false,\"name\":\"Work\"}]}"
    #expect(json == expected)
    #expect(
      TerminalProjectCatalog.defaultURL(
        homeDirectoryPath: "/tmp/ignored",
        environment: [SupatermCLIEnvironment.stateHomeKey: "/tmp/supaterm-dev"]
      ).path == "/tmp/supaterm-dev/projects.json"
    )
  }

  @Test
  func validationAndMutationsKeepProjectsInPinLanes() throws {
    let pinnedA = TerminalProject(name: "Pinned A", isPinned: true)
    let regularA = TerminalProject(name: "Regular A")
    let pinnedB = TerminalProject(name: "Pinned B", isPinned: true)
    let regularB = TerminalProject(name: "Regular B")
    var catalog = try TerminalProjectCatalog(
      projects: [regularA, pinnedA, regularB, pinnedB]
    ).validated()

    #expect(catalog.projects.map(\.name) == ["Pinned A", "Pinned B", "Regular A", "Regular B"])
    let pinnedRegularA = catalog.setPinned(regularA.id, isPinned: true)
    #expect(pinnedRegularA)
    #expect(catalog.projects.map(\.name) == ["Pinned A", "Pinned B", "Regular A", "Regular B"])
    let unpinnedA = catalog.setPinned(pinnedA.id, isPinned: false)
    #expect(unpinnedA)
    #expect(catalog.projects.map(\.name) == ["Pinned B", "Regular A", "Regular B", "Pinned A"])
    let unchangedA = catalog.setPinned(pinnedA.id, isPinned: false)
    #expect(!unchangedA)
    let movedPinnedB = catalog.reorderProject(pinnedB.id, toLaneIndex: 1)
    #expect(movedPinnedB)
    #expect(catalog.projects.map(\.name) == ["Regular A", "Pinned B", "Regular B", "Pinned A"])
    let movedRegularA = catalog.reorderProject(pinnedA.id, toLaneIndex: 0)
    #expect(movedRegularA)
    #expect(catalog.projects.map(\.name) == ["Regular A", "Pinned B", "Pinned A", "Regular B"])
  }
}

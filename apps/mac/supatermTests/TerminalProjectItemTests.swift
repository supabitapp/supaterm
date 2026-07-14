import Foundation
import Testing

@testable import supaterm

struct TerminalProjectItemTests {
  @Test
  func canonicalizesDirectoryURLAndDerivesDisplayName() {
    let directoryURL = URL(
      fileURLWithPath: "/tmp/supaterm-project-item-tests/Parent/../Workspace",
      isDirectory: false
    )
    let canonicalDirectoryURL = URL(
      fileURLWithPath: "/tmp/supaterm-project-item-tests/Workspace",
      isDirectory: true
    ).standardizedFileURL.resolvingSymlinksInPath()

    let project = TerminalProjectItem(directoryURL: directoryURL)

    #expect(project.directoryURL == canonicalDirectoryURL)
    #expect(TerminalProjectItem.canonicalDirectoryURL(project.directoryURL) == project.directoryURL)
    #expect(project.displayName == "Workspace")
  }

  @Test
  func catalogKeepsOneProjectPerCanonicalDirectoryURL() {
    let directoryURL = URL(
      fileURLWithPath: "/tmp/supaterm-project-item-tests/Workspace",
      isDirectory: true
    )
    let first = TerminalProjectItem(directoryURL: directoryURL)
    let duplicate = TerminalProjectItem(
      directoryURL: directoryURL.appendingPathComponent("..", isDirectory: true)
        .appendingPathComponent("Workspace", isDirectory: true),
      isPinned: true
    )
    let space = PersistedTerminalSpace(name: "A", projects: [first, duplicate])

    let catalog = TerminalSpaceCatalog.sanitized(
      TerminalSpaceCatalog(defaultSelectedSpaceID: space.id, spaces: [space])
    )

    #expect(catalog.spaces[0].projects == [first])
  }

  @Test
  func catalogPreservesSpaceWithoutProjects() {
    let space = PersistedTerminalSpace(name: "A", projects: [])

    let catalog = TerminalSpaceCatalog.sanitized(
      TerminalSpaceCatalog(defaultSelectedSpaceID: space.id, spaces: [space])
    )

    #expect(catalog.spaces[0].projects.isEmpty)
  }
}

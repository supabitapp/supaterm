import Foundation
import Testing

@testable import supaterm

struct TerminalWorkspaceCatalogTests {
  @Test
  func defaultURLUsesConfigDirectoryUnderProvidedHomeDirectory() {
    let homeDirectory = "/tmp/SupatermTests/Home"

    #expect(
      TerminalWorkspaceCatalog.defaultURL(homeDirectoryPath: homeDirectory)
        == URL(fileURLWithPath: homeDirectory, isDirectory: true)
        .appendingPathComponent(".config", isDirectory: true)
        .appendingPathComponent("supaterm", isDirectory: true)
        .appendingPathComponent("workspaces.json", isDirectory: false)
    )
  }

  @Test
  func sanitizedFallsBackToDefaultCatalogWhenCatalogIsMissingOrInvalid() {
    let invalidWorkspace = PersistedTerminalWorkspace(name: "   ")

    let catalog = TerminalWorkspaceCatalog.sanitized(
      .init(
        defaultSelectedWorkspaceID: invalidWorkspace.id,
        workspaces: [invalidWorkspace]
      )
    )

    #expect(catalog.workspaces.map(\.name) == ["A"])
    #expect(catalog.defaultSelectedWorkspaceID == catalog.workspaces[0].id)
  }

  @Test
  func sanitizedFallsBackToFirstWorkspaceWhenPersistedDefaultIsMissing() {
    let firstWorkspace = PersistedTerminalWorkspace(
      id: TerminalWorkspaceID(rawValue: UUID(uuidString: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA")!),
      name: "A"
    )
    let secondWorkspace = PersistedTerminalWorkspace(
      id: TerminalWorkspaceID(rawValue: UUID(uuidString: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB")!),
      name: "B"
    )

    let catalog = TerminalWorkspaceCatalog.sanitized(
      .init(
        defaultSelectedWorkspaceID: TerminalWorkspaceID(),
        workspaces: [firstWorkspace, secondWorkspace]
      )
    )

    #expect(catalog.defaultSelectedWorkspaceID == firstWorkspace.id)
    #expect(catalog.workspaces.map(\.name) == ["A", "B"])
  }
}

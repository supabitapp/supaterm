import Foundation
import Testing

@testable import supaterm

struct TerminalWorkspaceStoreTests {
  @Test
  func defaultURLUsesConfigDirectoryUnderProvidedHomeDirectory() {
    let homeDirectory = "/tmp/SupatermTests/Home"

    #expect(
      TerminalWorkspaceStore.defaultURL(homeDirectoryPath: homeDirectory)
        == URL(fileURLWithPath: homeDirectory, isDirectory: true)
        .appendingPathComponent(".config", isDirectory: true)
        .appendingPathComponent("supaterm", isDirectory: true)
        .appendingPathComponent("workspaces.json", isDirectory: false)
    )
  }

  @Test
  func saveAndLoadRoundTripSnapshot() throws {
    let rootURL = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    let fileURL =
      rootURL
      .appendingPathComponent(".config", isDirectory: true)
      .appendingPathComponent("supaterm", isDirectory: true)
      .appendingPathComponent("workspaces.json", isDirectory: false)
    let workspace = PersistedTerminalWorkspace(
      id: TerminalWorkspaceID(rawValue: UUID(uuidString: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA")!),
      name: "A"
    )
    let snapshot = TerminalWorkspaceSnapshot(
      selectedWorkspaceID: workspace.id,
      workspaces: [workspace]
    )

    TerminalWorkspaceStore.saveSnapshot(snapshot, fileURL: fileURL)
    let loadedSnapshot = TerminalWorkspaceStore.loadSnapshot(fileURL: fileURL)

    #expect(loadedSnapshot == snapshot)
  }
}

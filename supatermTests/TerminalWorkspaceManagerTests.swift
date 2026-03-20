import Foundation
import Testing

@testable import supaterm

@MainActor
struct TerminalWorkspaceManagerTests {
  @Test
  func bootstrapUsesCatalogDefaultSelectionWhenInitialSelectionMissing() {
    let manager = TerminalWorkspaceManager()
    let catalog = makeCatalog(["A", "B"], defaultSelectedIndex: 1)

    manager.bootstrap(from: catalog, initialSelectedWorkspaceID: nil)

    #expect(manager.workspaces.map(\.name) == ["A", "B"])
    #expect(manager.selectedWorkspaceID == catalog.workspaces[1].id)
  }

  @Test
  func bootstrapPrefersProvidedInitialSelectionWhenItExists() {
    let manager = TerminalWorkspaceManager()
    let catalog = makeCatalog(["A", "B"], defaultSelectedIndex: 1)

    manager.bootstrap(from: catalog, initialSelectedWorkspaceID: catalog.workspaces[0].id)

    #expect(manager.selectedWorkspaceID == catalog.workspaces[0].id)
  }

  @Test
  func nextDefaultWorkspaceNameUsesSpreadsheetSequence() {
    let manager = TerminalWorkspaceManager()
    let catalog = makeCatalog(["A", "B", "C"])

    manager.bootstrap(from: catalog, initialSelectedWorkspaceID: nil)

    #expect(manager.nextDefaultWorkspaceName() == "D")
  }

  @Test
  func isNameAvailableRejectsEmptyAndDuplicateNames() {
    let manager = TerminalWorkspaceManager()
    let catalog = makeCatalog(["A", "B"])

    manager.bootstrap(from: catalog, initialSelectedWorkspaceID: nil)

    #expect(manager.isNameAvailable("   ") == false)
    #expect(manager.isNameAvailable("a") == false)
    #expect(manager.isNameAvailable("Shell"))
  }

  @Test
  func applyCatalogReselectsPreviousWorkspaceAndReturnsRemovedTabs() {
    let manager = TerminalWorkspaceManager()
    let catalog = makeCatalog(["A", "B", "C"])
    manager.bootstrap(from: catalog, initialSelectedWorkspaceID: catalog.workspaces[2].id)
    let removedTabID = manager.tabManager(for: catalog.workspaces[2].id)?
      .createTab(title: "Terminal 1", icon: "terminal")

    let updatedCatalog = TerminalWorkspaceCatalog(
      defaultSelectedWorkspaceID: catalog.workspaces[0].id,
      workspaces: Array(catalog.workspaces.dropLast())
    )
    let diff = manager.applyCatalog(updatedCatalog)

    #expect(diff.removedTabIDs == [removedTabID].compactMap { $0 })
    #expect(manager.workspaces.map(\.name) == ["A", "B"])
    #expect(manager.selectedWorkspaceID == catalog.workspaces[1].id)
  }

  private func makeCatalog(
    _ workspaceNames: [String],
    defaultSelectedIndex: Int = 0
  ) -> TerminalWorkspaceCatalog {
    let workspaces = workspaceNames.map { PersistedTerminalWorkspace(name: $0) }
    return TerminalWorkspaceCatalog(
      defaultSelectedWorkspaceID: workspaces[defaultSelectedIndex].id,
      workspaces: workspaces
    )
  }
}

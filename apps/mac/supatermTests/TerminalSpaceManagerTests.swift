import Foundation
import Testing

@testable import supaterm

@MainActor
struct TerminalSpaceManagerTests {
  @Test
  func bootstrapUsesCatalogDefaultSelectionWhenInitialSelectionMissing() {
    let manager = TerminalSpaceManager()
    let catalog = makeCatalog(["A", "B"], defaultSelectedIndex: 1)

    manager.bootstrap(from: catalog, initialSelectedSpaceID: nil)

    #expect(manager.spaces.map(\.name) == ["A", "B"])
    #expect(manager.selectedSpaceID == catalog.spaces[1].id)
  }

  @Test
  func bootstrapPrefersProvidedInitialSelectionWhenItExists() {
    let manager = TerminalSpaceManager()
    let catalog = makeCatalog(["A", "B"], defaultSelectedIndex: 1)

    manager.bootstrap(from: catalog, initialSelectedSpaceID: catalog.spaces[0].id)

    #expect(manager.selectedSpaceID == catalog.spaces[0].id)
  }

  @Test
  func nextDefaultSpaceNameUsesSpreadsheetSequence() {
    let manager = TerminalSpaceManager()
    let catalog = makeCatalog(["A", "B", "C"])

    manager.bootstrap(from: catalog, initialSelectedSpaceID: nil)

    #expect(manager.nextDefaultSpaceName() == "D")
  }

  @Test
  func isNameAvailableRejectsEmptyAndDuplicateNames() {
    let manager = TerminalSpaceManager()
    let catalog = makeCatalog(["A", "B"])

    manager.bootstrap(from: catalog, initialSelectedSpaceID: nil)

    #expect(manager.isNameAvailable("   ") == false)
    #expect(manager.isNameAvailable("a") == false)
    #expect(manager.isNameAvailable("Shell"))
  }

  @Test
  func applyCatalogReselectsPreviousSpaceAndReturnsRemovedTabs() {
    let manager = TerminalSpaceManager()
    let catalog = makeCatalog(["A", "B", "C"])
    manager.bootstrap(from: catalog, initialSelectedSpaceID: catalog.spaces[2].id)
    let removedTabID = manager.tabManager(for: catalog.spaces[2].id)?
      .createTab(title: "Terminal 1", icon: "terminal")

    let updatedCatalog = TerminalSpaceCatalog(
      defaultSelectedSpaceID: catalog.spaces[0].id,
      spaces: Array(catalog.spaces.dropLast())
    )
    let diff = manager.applyCatalog(updatedCatalog)

    #expect(diff.removedTabIDs == [removedTabID].compactMap { $0 })
    #expect(manager.spaces.map(\.name) == ["A", "B"])
    #expect(manager.selectedSpaceID == catalog.spaces[1].id)
  }

  private func makeCatalog(
    _ spaceNames: [String],
    defaultSelectedIndex: Int = 0
  ) -> TerminalSpaceCatalog {
    let spaces = spaceNames.map { PersistedTerminalSpace(name: $0) }
    return TerminalSpaceCatalog(
      defaultSelectedSpaceID: spaces[defaultSelectedIndex].id,
      spaces: spaces
    )
  }
}

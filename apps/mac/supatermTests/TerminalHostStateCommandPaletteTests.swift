import ComposableArchitecture
import Foundation
import Testing

@testable import supaterm

@MainActor
struct TerminalHostStateCommandPaletteTests {
  @Test
  func commandPaletteSnapshotReflectsWindowSelectionWithoutFocusedSurface() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let host = TerminalHostState(managesTerminalSurfaces: false)
      let tabManager = try #require(host.spaceManager.activeTabManager)
      let mainTabID = tabManager.createTab(title: "Main", icon: nil)
      let logsTabID = tabManager.createTab(title: "Logs", icon: "doc.plaintext")
      tabManager.selectTab(mainTabID)

      let snapshot = host.commandPaletteSnapshot

      #expect(snapshot.selectedSpaceID == host.selectedSpaceID)
      #expect(snapshot.selectedTabID == mainTabID)
      #expect(snapshot.visibleTabs.map(\.id) == [mainTabID, logsTabID])
      #expect(!snapshot.hasFocusedSurface)
      #expect(snapshot.ghosttyCommands.isEmpty)
    }
  }

  @Test
  func commandPaletteSnapshotResolvesGhosttyShortcutDisplays() throws {
    let runtime = try makeGhosttyRuntime(
      """
      keybind = super+shift+y=open_config
      command-palette-entry = title:Open Config,description:Open the configuration file.,action:open_config
      """
    )
    let host = TerminalHostState(runtime: runtime, managesTerminalSurfaces: false)

    let snapshot = host.commandPaletteSnapshot

    #expect(snapshot.ghosttyCommands.contains(where: { $0.action == "open_config" }))
    #expect(snapshot.ghosttyShortcutDisplayByAction["open_config"] == "⌘⇧Y")
  }
}

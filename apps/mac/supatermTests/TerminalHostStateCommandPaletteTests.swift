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

  @Test
  func commandPaletteSnapshotFiltersUnsupportedWindowActions() throws {
    let runtime = try makeGhosttyRuntime(
      [
        "keybind = super+shift+y=open_config",
        "keybind = super+ctrl+f=toggle_fullscreen",
        "command-palette-entry = title:Open Config,description:Open the configuration file.,action:open_config",
        "command-palette-entry = title:Next Window,description:Focus the next window.,action:goto_window:next",
        "command-palette-entry = title:Reset Window Size,"
          + "description:Return the window to its default size.,action:reset_window_size",
        "command-palette-entry = title:Toggle Quick Terminal,"
          + "description:Toggle the quick terminal window.,action:toggle_quick_terminal",
        "command-palette-entry = title:Toggle Fullscreen,"
          + "description:Toggle the fullscreen state of the current window.,action:toggle_fullscreen",
        "command-palette-entry = title:Toggle Maximize,"
          + "description:Toggle the maximized state of the current window.,action:toggle_maximize",
        "command-palette-entry = title:Toggle Float On Top,"
          + "description:Toggle whether the current window floats above others.,action:toggle_window_float_on_top",
      ].joined(separator: "\n")
    )
    let host = TerminalHostState(runtime: runtime, managesTerminalSurfaces: false)

    let snapshot = host.commandPaletteSnapshot

    #expect(snapshot.ghosttyCommands.contains(where: { $0.action == "open_config" }))
    #expect(!snapshot.ghosttyCommands.contains(where: { $0.actionKey == "goto_window" }))
    #expect(!snapshot.ghosttyCommands.contains(where: { $0.actionKey == "reset_window_size" }))
    #expect(!snapshot.ghosttyCommands.contains(where: { $0.actionKey == "toggle_fullscreen" }))
    #expect(!snapshot.ghosttyCommands.contains(where: { $0.actionKey == "toggle_maximize" }))
    #expect(!snapshot.ghosttyCommands.contains(where: { $0.actionKey == "toggle_quick_terminal" }))
    #expect(!snapshot.ghosttyCommands.contains(where: { $0.actionKey == "toggle_window_float_on_top" }))
    #expect(snapshot.ghosttyShortcutDisplayByAction["open_config"] == "⌘⇧Y")
    #expect(snapshot.ghosttyShortcutDisplayByAction["goto_window:next"] == nil)
    #expect(snapshot.ghosttyShortcutDisplayByAction["reset_window_size"] == nil)
    #expect(snapshot.ghosttyShortcutDisplayByAction["toggle_fullscreen"] == nil)
    #expect(snapshot.ghosttyShortcutDisplayByAction["toggle_quick_terminal"] == nil)
    #expect(snapshot.ghosttyShortcutDisplayByAction["toggle_window_float_on_top"] == nil)
  }
}

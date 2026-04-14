import ComposableArchitecture
import Foundation
import Testing

@testable import supaterm

@MainActor
struct TerminalHostStateCommandPaletteTests {
  @Test
  func commandPaletteGhosttyShortcutDisplaysResolveForSupportedCommands() throws {
    let runtime = try makeGhosttyRuntime(
      """
      keybind = super+shift+y=open_config
      command-palette-entry = title:Open Config,description:Open the configuration file.,action:open_config
      """
    )
    let host = TerminalHostState(runtime: runtime, managesTerminalSurfaces: false)

    let commands = host.commandPaletteGhosttyCommands()
    let shortcuts = host.commandPaletteGhosttyShortcutDisplayByAction()

    #expect(commands.contains(where: { $0.action == "open_config" }))
    #expect(shortcuts["open_config"] == "⌘⇧Y")
  }

  @Test
  func commandPaletteGhosttyCommandsFilterUnsupportedWindowActions() throws {
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

    let commands = host.commandPaletteGhosttyCommands()
    let shortcuts = host.commandPaletteGhosttyShortcutDisplayByAction()

    #expect(commands.contains(where: { $0.action == "open_config" }))
    #expect(!commands.contains(where: { $0.actionKey == "goto_window" }))
    #expect(!commands.contains(where: { $0.actionKey == "reset_window_size" }))
    #expect(!commands.contains(where: { $0.actionKey == "toggle_fullscreen" }))
    #expect(!commands.contains(where: { $0.actionKey == "toggle_maximize" }))
    #expect(!commands.contains(where: { $0.actionKey == "toggle_quick_terminal" }))
    #expect(!commands.contains(where: { $0.actionKey == "toggle_window_float_on_top" }))
    #expect(shortcuts["open_config"] == "⌘⇧Y")
    #expect(shortcuts["goto_window:next"] == nil)
    #expect(shortcuts["reset_window_size"] == nil)
    #expect(shortcuts["toggle_fullscreen"] == nil)
    #expect(shortcuts["toggle_quick_terminal"] == nil)
    #expect(shortcuts["toggle_window_float_on_top"] == nil)
  }

  @Test
  func commandPaletteFocusTargetsEmitStablePaneRows() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let host = TerminalHostState()
      host.handleCommand(.ensureInitialTab(focusing: false, startupInput: nil))

      let firstSurfaceID = try #require(host.selectedSurfaceView?.id)
      host.selectedSurfaceView?.bridge.state.title = "ping 1.1.1.1"
      host.selectedSurfaceView?.bridge.state.pwd = "/Users/Developer/Projects/network"

      _ = try host.createPane(
        .init(
          initialInput: nil,
          direction: .right,
          focus: false,
          equalize: false,
          target: .contextPane(firstSurfaceID)
        )
      )

      let tabID = try #require(host.selectedTabID)
      let secondSurface = try #require(host.trees[tabID]?.leaves().last)
      secondSurface.bridge.state.title = nil
      secondSurface.bridge.state.titleOverride = nil
      secondSurface.bridge.state.pwd = nil

      let windowControllerID = UUID(uuidString: "00000000-0000-0000-0000-000000000901")!
      let targets = host.commandPaletteFocusTargets(windowControllerID: windowControllerID)

      #expect(targets.map(\.surfaceID) == [firstSurfaceID, secondSurface.id])
      #expect(targets.map(\.windowControllerID) == [windowControllerID, windowControllerID])
      #expect(targets.map(\.title) == ["ping 1.1.1.1", "Pane 2"])
      #expect(targets.map(\.subtitle) == ["~/Projects/network", nil])
      #expect(targets.allSatisfy { $0.tone == host.selectedTab?.tone })
    }
  }
}

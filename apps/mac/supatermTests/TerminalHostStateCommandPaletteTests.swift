import AppKit
import ComposableArchitecture
import Foundation
import Observation
import Synchronization
import Testing

@testable import supaterm

@MainActor
struct TerminalHostStateCommandPaletteTests {
  @Test
  func commandPaletteShortcutDisplaysResolveOnlyForCuratedActions() throws {
    let runtime = try makeGhosttyRuntime(
      """
      keybind = super+shift+y=new_split:right
      keybind = super+shift+u=new_tab
      command-palette-entry = title:Custom Command,description:Custom action.,action:open_config:os_open
      """
    )
    let host = TerminalHostState.test(runtime: runtime, managesTerminalSurfaces: false)

    let shortcuts = host.commandPaletteGhosttyShortcutDisplayByAction()

    #expect(shortcuts["new_split:right"] == "⌘⇧Y")
    #expect(shortcuts["new_tab"] == nil)
    #expect(shortcuts["open_config:os_open"] == nil)
  }

  @Test
  func keyboardLayoutChangeInvalidatesCommandPaletteShortcutHints() async throws {
    _ = NSApplication.shared
    let runtime = try makeGhosttyRuntime(
      """
      keybind = super+shift+y=new_split:right
      """
    )
    let host = TerminalHostState.test(runtime: runtime, managesTerminalSurfaces: false)
    let invalidationCount = Mutex(0)

    _ = withObservationTracking {
      host.commandPaletteGhosttyShortcutDisplayByAction()
    } onChange: {
      invalidationCount.withLock { $0 += 1 }
    }

    NotificationCenter.default.post(
      name: NSTextInputContext.keyboardSelectionDidChangeNotification,
      object: nil
    )
    for _ in 0..<5 {
      await Task.yield()
    }

    #expect(invalidationCount.withLock { $0 } == 1)
  }

  @Test
  func commandPaletteFocusTargetsEmitStablePaneRows() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let host = TerminalHostState.test()
      let homeDirectoryPath = FileManager.default.homeDirectoryForCurrentUser.path
      host.ensureInitialTab(focusing: false, startupCommand: nil)

      let firstSurfaceID = try #require(host.selectedSurfaceView?.id)
      host.selectedSurfaceView?.bridge.state.title = "ping 1.1.1.1"
      host.selectedSurfaceView?.bridge.state.pwd = "\(homeDirectoryPath)/Projects/network"

      _ = try host.createPane(
        TerminalCreatePaneRequest(
          startupCommand: nil,
          direction: .right,
          focus: false,
          equalize: false,
          target: .pane(firstSurfaceID)
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
    }
  }
}

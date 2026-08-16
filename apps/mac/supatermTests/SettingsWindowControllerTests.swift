import AppKit
import ComposableArchitecture
import Testing

@testable import SupatermSettingsFeature
@testable import supaterm

@MainActor
struct SettingsWindowControllerTests {
  @Test
  func windowUsesUnifiedSettingsChrome() throws {
    try withSettingsWindowDependencies {
      let controller = SettingsWindowController()
      let window = try #require(controller.window)

      #expect(window.styleMask.contains(.fullSizeContentView))
      #expect(window.title.isEmpty)
      #expect(window.titleVisibility == .hidden)
      #expect(window.titlebarAppearsTransparent)
      #expect(window.toolbarStyle == .unified)
      #expect(window.toolbar != nil)
      #expect(window.contentMinSize.width == 750)
      #expect(window.contentMinSize.height >= 500)
      #expect(window.contentRect(forFrameRect: window.frame).size == NSSize(width: 800, height: 600))
    }
  }

  @Test
  func initialWindowCentersRelativeToSourceWindowAndConstrainsToVisibleFrameWhenNoSavedFrameExists() throws {
    try withSettingsWindowDependencies {
      NSWindow.removeFrame(usingName: "SupatermSettingsWindow")
      defer { NSWindow.removeFrame(usingName: "SupatermSettingsWindow") }

      let sourceWindow = NSWindow(
        contentRect: NSRect(x: 240, y: 180, width: 1_200, height: 800),
        styleMask: [.titled],
        backing: .buffered,
        defer: false
      )
      let controller = SettingsWindowController()
      controller.show(tab: .general, relativeTo: sourceWindow)
      defer { controller.window?.orderOut(nil) }
      let frame = try #require(controller.window?.frame)
      let visibleFrame = sourceWindow.screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? sourceWindow.frame
      let centeredOrigin = NSPoint(
        x: sourceWindow.frame.midX - frame.width / 2,
        y: sourceWindow.frame.midY - frame.height / 2
      )
      let expectedOrigin = NSPoint(
        x: min(max(centeredOrigin.x, visibleFrame.minX), visibleFrame.maxX - frame.width),
        y: min(max(centeredOrigin.y, visibleFrame.minY), visibleFrame.maxY - frame.height)
      )

      #expect(frame.origin == expectedOrigin)
    }
  }

  @Test
  func showSelectsRequestedTab() {
    withSettingsWindowDependencies {
      initializeGhosttyForTests()
      let controller = SettingsWindowController()
      controller.show(tab: .about)
      defer { controller.window?.orderOut(nil) }

      #expect(controller.store.selectedTab == .about)

      controller.show(tab: .notifications)

      #expect(controller.store.selectedTab == .notifications)

      controller.show(tab: .codingAgents)

      #expect(controller.store.selectedTab == .codingAgents)

      controller.show(tab: .terminal)

      #expect(controller.store.selectedTab == .terminal)
    }
  }
}

@MainActor
private func withSettingsWindowDependencies<Result>(
  _ operation: () throws -> Result
) rethrows -> Result {
  try withDependencies {
    $0.claudeSettingsClient.integrationHealth = { .absent }
    $0.codexSettingsClient.integrationHealth = { .absent }
    $0.defaultFileStorage = .inMemory
    $0.ghosttyTerminalSettingsClient.load = { terminalSettingsSnapshot() }
    $0.piSettingsClient.integrationHealth = { .absent }
    $0.shortcutSettingsClient.terminalReservedDisplays = { [] }
    $0.updateClient.observe = { AsyncStream { $0.finish() } }
    $0.updateClient.start = {}
  } operation: {
    try operation()
  }
}

import AppKit
import Testing

@testable import supaterm

@MainActor
struct WindowChromeConfigurationTests {
  @Test
  func applyHidesNativeTrafficLights() {
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1_440, height: 900),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    window.toolbar = NSToolbar(identifier: "test-toolbar")
    window.titleVisibility = .visible
    window.titlebarAppearsTransparent = false
    window.isMovableByWindowBackground = false

    WindowChromeConfiguration.apply(to: window)

    #expect(window.titleVisibility == .hidden)
    #expect(window.titlebarAppearsTransparent)
    #expect(window.titlebarSeparatorStyle == .none)
    #expect(window.toolbar == nil)
    #expect(window.isMovableByWindowBackground)
    #expect(window.standardWindowButton(.closeButton)?.isHidden == true)
    #expect(window.standardWindowButton(.miniaturizeButton)?.isHidden == true)
    #expect(window.standardWindowButton(.zoomButton)?.isHidden == true)
  }
}

import AppKit
import Testing

@testable import supaterm

@MainActor
struct WindowChromeConfigurationTests {
  @Test
  func customTrafficLightMetricsMatchUnifiedTitlebar() throws {
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1_440, height: 900),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    window.toolbar = NSToolbar(identifier: "test-toolbar")
    window.toolbarStyle = .unified

    let frameView = try #require(window.contentView?.superview)
    frameView.layoutSubtreeIfNeeded()
    let closeButton = try #require(window.standardWindowButton(.closeButton))
    let minimizeButton = try #require(window.standardWindowButton(.miniaturizeButton))
    let closeFrame = frameView.convert(closeButton.bounds, from: closeButton)
    let minimizeFrame = frameView.convert(minimizeButton.bounds, from: minimizeButton)

    #expect(closeFrame.minX == WindowTrafficLightMetrics.edgePadding)
    #expect(frameView.bounds.maxY - closeFrame.maxY == WindowTrafficLightMetrics.edgePadding)
    #expect(closeFrame.width == WindowTrafficLightMetrics.buttonSize)
    #expect(minimizeFrame.minX - closeFrame.maxX == WindowTrafficLightMetrics.buttonSpacing)
  }

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
    #expect(window.isMovableByWindowBackground == false)
    #expect(window.standardWindowButton(.closeButton)?.isHidden == true)
    #expect(window.standardWindowButton(.miniaturizeButton)?.isHidden == true)
    #expect(window.standardWindowButton(.zoomButton)?.isHidden == true)
  }

  @Test
  func titleApplierNamesTheWindowAndFollowsChanges() throws {
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1_440, height: 900),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    let contentView = try #require(window.contentView)
    let applier = WindowTitleApplierView()
    applier.appliedTitle = "Research"

    contentView.addSubview(applier)
    #expect(window.title == "Research")

    applier.appliedTitle = "Shipping"
    #expect(window.title == "Shipping")
  }
}

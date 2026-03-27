import AppKit
import Testing

@testable import supaterm

@MainActor
struct SettingsWindowControllerTests {
  @Test
  func initialWindowCentersRelativeToSourceWindowAndConstrainsToVisibleFrameWhenNoSavedFrameExists() throws {
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

  @Test
  func initialWindowRestoresSavedFrameWhenPresent() throws {
    NSWindow.removeFrame(usingName: "SupatermSettingsWindow")
    defer { NSWindow.removeFrame(usingName: "SupatermSettingsWindow") }

    let seedController = SettingsWindowController()
    let seedWindow = try #require(seedController.window)
    let savedFrame = NSRect(x: 111, y: 222, width: 777, height: 690)
    seedWindow.setFrame(savedFrame, display: false)
    seedWindow.saveFrame(usingName: "SupatermSettingsWindow")

    let controller = SettingsWindowController()
    let frame = try #require(controller.window?.frame)

    #expect(frame == savedFrame)
  }

  @Test
  func windowUsesSupportedMinimumContentSize() throws {
    NSWindow.removeFrame(usingName: "SupatermSettingsWindow")
    defer { NSWindow.removeFrame(usingName: "SupatermSettingsWindow") }

    let controller = SettingsWindowController()
    let window = try #require(controller.window)

    #expect(window.contentMinSize == SettingsWindowController.minimumContentSize)
  }

  @Test
  func restoredFrameClampsToMinimumContentSizeWhenSavedFrameIsTooNarrow() throws {
    NSWindow.removeFrame(usingName: "SupatermSettingsWindow")
    defer { NSWindow.removeFrame(usingName: "SupatermSettingsWindow") }

    let seedController = SettingsWindowController()
    let seedWindow = try #require(seedController.window)
    let savedFrame = NSRect(x: 111, y: 222, width: 520, height: 690)
    seedWindow.setFrame(savedFrame, display: false)
    seedWindow.saveFrame(usingName: "SupatermSettingsWindow")

    let controller = SettingsWindowController()
    let window = try #require(controller.window)
    let restoredContentWidth = window.contentRect(forFrameRect: window.frame).width

    #expect(restoredContentWidth >= SettingsWindowController.minimumContentSize.width)
  }
}

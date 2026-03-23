import AppKit
import Testing

@testable import supaterm

@MainActor
struct SettingsWindowControllerTests {
  @Test
  func initialWindowCentersRelativeToSourceWindowWhenNoSavedFrameExists() throws {
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
    let expectedOrigin = NSPoint(
      x: sourceWindow.frame.midX - frame.width / 2,
      y: sourceWindow.frame.midY - frame.height / 2
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
}

import AppKit
import Testing

@testable import supaterm

@MainActor
struct SettingsWindowControllerTests {
  @Test
  func initialWindowCentersWhenNoSavedFrameExists() throws {
    NSWindow.removeFrame(usingName: "SupatermSettingsWindow")
    defer { NSWindow.removeFrame(usingName: "SupatermSettingsWindow") }

    let controller = SettingsWindowController()
    let frame = try #require(controller.window?.frame)

    #expect(frame.origin != .zero)
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

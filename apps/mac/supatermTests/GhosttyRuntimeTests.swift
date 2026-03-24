import AppKit
import Foundation
import GhosttyKit
import Testing

@testable import supaterm

@MainActor
struct GhosttyRuntimeTests {
  @Test
  func foregroundColorReadsConfiguredForeground() throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #101010
      foreground = #123456
      """
    )

    #expect(hexString(runtime.foregroundColor()) == "#123456")
  }

  @Test
  func paletteColorsExposeConfiguredPaletteEntries() throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #101010
      foreground = #E0E0E0
      palette = 12=#3366FF
      """
    )

    #expect(runtime.paletteColors().count == 256)
    #expect(hexString(runtime.paletteColors()[12]) == "#3366FF")
  }

  @Test
  func notificationAttentionColorPrefersBrightBlueWhenItQualifies() throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #101010
      foreground = #E0E0E0
      palette = 12=#3366FF
      palette = 14=#607080
      palette = 13=#4A4A4A
      palette = 4=#303030
      palette = 6=#404040
      palette = 5=#505050
      """
    )

    #expect(hexString(runtime.notificationAttentionColor()) == "#3366FF")
  }

  @Test
  func notificationAttentionColorSkipsLowContrastCandidates() throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #101010
      foreground = #E0E0E0
      palette = 12=#171717
      palette = 14=#00AACC
      palette = 13=#777777
      palette = 4=#202020
      palette = 6=#252525
      palette = 5=#2A2A2A
      """
    )

    #expect(hexString(runtime.notificationAttentionColor()) == "#00AACC")
  }

  @Test
  func notificationAttentionColorFallsBackToForegroundWhenCandidatesFail() throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #101010
      foreground = #E0E0E0
      palette = 12=#171717
      palette = 14=#202020
      palette = 13=#2A2A2A
      palette = 4=#303030
      palette = 6=#383838
      palette = 5=#404040
      """
    )

    #expect(hexString(runtime.notificationAttentionColor()) == "#E0E0E0")
  }

  @Test
  func dispatchAppActionRoutesSupportedActions() {
    let app = NSApplication.shared
    let previousDelegate = app.delegate
    let delegate = GhosttyAppActionPerformerSpy()
    app.delegate = delegate
    defer {
      app.delegate = previousDelegate
    }

    #expect(GhosttyRuntime.dispatchAppAction(.init(tag: GHOSTTY_ACTION_NEW_WINDOW, action: .init())))
    #expect(GhosttyRuntime.dispatchAppAction(.init(tag: GHOSTTY_ACTION_CLOSE_ALL_WINDOWS, action: .init())))
    #expect(GhosttyRuntime.dispatchAppAction(.init(tag: GHOSTTY_ACTION_CHECK_FOR_UPDATES, action: .init())))
    #expect(GhosttyRuntime.dispatchAppAction(.init(tag: GHOSTTY_ACTION_OPEN_CONFIG, action: .init())))
    #expect(GhosttyRuntime.dispatchAppAction(.init(tag: GHOSTTY_ACTION_QUIT, action: .init())))

    #expect(delegate.newWindowCount == 1)
    #expect(delegate.closeAllWindowsCount == 1)
    #expect(delegate.checkForUpdatesCount == 1)
    #expect(delegate.openConfigCount == 1)
    #expect(delegate.quitCount == 1)
  }

  @Test
  func dispatchAppActionReturnsFalseForUnsupportedActions() {
    #expect(!GhosttyRuntime.dispatchAppAction(.init(tag: GHOSTTY_ACTION_PRESENT_TERMINAL, action: .init())))
  }

  private func hexString(_ color: NSColor) -> String {
    let rgb = color.usingColorSpace(.sRGB) ?? color
    let red = Int(round(rgb.redComponent * 255))
    let green = Int(round(rgb.greenComponent * 255))
    let blue = Int(round(rgb.blueComponent * 255))
    return String(format: "#%02X%02X%02X", red, green, blue)
  }
}

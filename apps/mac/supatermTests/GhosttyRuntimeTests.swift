import AppKit
import Foundation
import GhosttyKit
import Testing

@testable import supaterm

@MainActor
struct GhosttyRuntimeTests {
  @Test
  func notificationAttentionColorPrefersBrightestBlueCandidate() throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #101010
      foreground = #E0E0E0
      palette = 4=#458588
      palette = 12=#83A598
      """
    )

    #expect(hexString(runtime.notificationAttentionColor()) == "#83A598")
  }

  @Test
  func notificationAttentionColorUsesBrightBlueWhenBlueFails() throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #101010
      foreground = #E0E0E0
      palette = 4=#171717
      palette = 12=#83A598
      """
    )

    #expect(hexString(runtime.notificationAttentionColor()) == "#83A598")
  }

  @Test
  func notificationAttentionColorUsesBlueWhenBrightBlueFails() throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #101010
      foreground = #E0E0E0
      palette = 4=#458588
      palette = 12=#1F1F1F
      """
    )

    #expect(hexString(runtime.notificationAttentionColor()) == "#458588")
  }

  @Test
  func notificationAttentionColorFallsBackToForegroundWhenBlueCandidatesFail() throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #101010
      foreground = #E0E0E0
      palette = 4=#171717
      palette = 12=#202020
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

  @Test
  func reloadAppConfigUsesOriginalExplicitConfigPath() throws {
    let fixture = try makePersistentGhosttyRuntime(
      """
      background = #101010
      foreground = #E0E0E0
      """
    )
    defer {
      fixture.cleanup()
    }

    #expect(hexString(fixture.runtime.backgroundColor()) == "#101010")

    try """
    background = #202020
    foreground = #E0E0E0
    """
    .write(to: fixture.configURL, atomically: true, encoding: .utf8)

    fixture.runtime.reloadAppConfig()

    #expect(hexString(fixture.runtime.backgroundColor()) == "#202020")
  }

  @Test
  func splitPreserveZoomOnNavigationReadsNavigationFlag() throws {
    let runtime = try makeGhosttyRuntime(
      """
      split-preserve-zoom = navigation
      """
    )

    #expect(runtime.splitPreserveZoomOnNavigation())
  }

  @Test
  func splitPreserveZoomOnNavigationDefaultsToDisabled() throws {
    let runtime = try makeGhosttyRuntime("")

    #expect(!runtime.splitPreserveZoomOnNavigation())
  }

  @Test
  func wakeupAfterRuntimeDeallocationIsIgnored() throws {
    let userdataBits: UInt?
    do {
      let runtime = try makeGhosttyRuntime(
        """
        background = #101010
        foreground = #E0E0E0
        """
      )
      userdataBits = runtime.appUserdataBitsForTesting()
    }

    GhosttyRuntime.wakeupForTesting(userdataBits: userdataBits)
  }

  @Test
  func actionCallbackReturnsHandledResultOffMainThread() async throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #101010
      foreground = #E0E0E0
      """
    )
    let app = NSApplication.shared
    let previousDelegate = app.delegate
    let delegate = GhosttyAppActionPerformerSpy()
    app.delegate = delegate
    defer {
      app.delegate = previousDelegate
    }

    let action = ghostty_action_s(tag: GHOSTTY_ACTION_NEW_WINDOW, action: .init())
    let target = ghostty_target_s(tag: GHOSTTY_TARGET_APP, target: .init())
    let appBits = runtime.appBitsForTesting()
    let result = await Task.detached {
      GhosttyRuntime.actionCallbackForTesting(appBits, target, action)
    }.value

    #expect(result)
    #expect(delegate.newWindowCount == 1)
  }

  private func hexString(_ color: NSColor) -> String {
    let rgb = color.usingColorSpace(.sRGB) ?? color
    let red = Int(round(rgb.redComponent * 255))
    let green = Int(round(rgb.greenComponent * 255))
    let blue = Int(round(rgb.blueComponent * 255))
    return String(format: "#%02X%02X%02X", red, green, blue)
  }
}

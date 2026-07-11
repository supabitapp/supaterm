import AppKit
import Carbon.HIToolbox
import Foundation
import GhosttyKit
import Synchronization
import Testing

@testable import supaterm

@MainActor
struct GhosttyRuntimeTests {
  @Test
  func runtimeCreatedWhileApplicationIsInactiveRejectsNonGlobalBinding() throws {
    let app = NSApplication.shared
    let previousDelegate = app.delegate
    let delegate = GhosttyAppActionPerformerSpy()
    app.delegate = delegate
    defer {
      app.delegate = previousDelegate
    }

    let runtime = try makeGhosttyRuntime(
      """
      keybind = super+shift+0=toggle_visibility
      """,
      applicationIsActive: { false }
    )
    let event = try GhosttyGlobalKeyEvent(
      #require(
        NSEvent.keyEvent(
          with: .keyDown,
          location: .zero,
          modifierFlags: [.command, .shift],
          timestamp: 0,
          windowNumber: 0,
          context: nil,
          characters: ")",
          charactersIgnoringModifiers: "0",
          isARepeat: false,
          keyCode: UInt16(kVK_ANSI_0)
        )
      )
    )

    #expect(!runtime.handleGlobalKeyEvent(event))
    #expect(delegate.toggleVisibilityCount == 0)
  }

  @Test
  func opinionatedStringContentsReturnsStringBeforeImageData() throws {
    let pasteboard = makePasteboard()
    pasteboard.declareTypes([.string, .supatermPNGImage], owner: nil)
    pasteboard.setString("echo hello", forType: .string)
    pasteboard.setData(try makeImageData(.png), forType: .supatermPNGImage)

    #expect(pasteboard.getOpinionatedStringContents() == "echo hello")
  }

  @Test
  func writeImageToTempFileWritesPNGData() throws {
    let pasteboard = makePasteboard()
    pasteboard.declareTypes([.supatermPNGImage], owner: nil)
    pasteboard.setData(try makeImageData(.png), forType: .supatermPNGImage)

    let path = try unescapedPath(pasteboard.writeImageToTempFile())
    defer { try? FileManager.default.removeItem(atPath: path) }

    #expect(path.contains("/supaterm-pasted-images/pasted-"))
    #expect(path.hasSuffix(".png"))
    #expect(FileManager.default.fileExists(atPath: path))
  }

  @Test
  func writeImageToTempFileConvertsTIFFDataToPNG() throws {
    let pasteboard = makePasteboard()
    pasteboard.declareTypes([.supatermTIFFImage], owner: nil)
    pasteboard.setData(try makeImageData(.tiff), forType: .supatermTIFFImage)

    let path = try unescapedPath(pasteboard.writeImageToTempFile())
    defer { try? FileManager.default.removeItem(atPath: path) }

    let data = try Data(contentsOf: URL(fileURLWithPath: path))
    #expect(Array(data.prefix(8)) == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  }

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
  func shellIntegrationPlanUsesGhosttyZshIntegration() throws {
    let runtime = try makeGhosttyRuntime(
      """
      shell-integration = detect
      """
    )

    let plan = runtime.shellIntegrationPlan(for: "/bin/zsh")

    #expect(plan.plannedCommand == nil)
    #expect(
      plan.environmentVariables.contains {
        $0.key == "ZDOTDIR" && $0.value.hasSuffix("/shell-integration/zsh")
      }
    )
  }

  @Test
  func shellIntegrationPlanRespectsDisabledShellIntegration() throws {
    let runtime = try makeGhosttyRuntime(
      """
      shell-integration = none
      """
    )

    #expect(runtime.shellIntegrationPlan(for: "/bin/zsh") == .empty)
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
  func splitDividerColorUsesConfiguredValue() throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #101010
      split-divider-color = #123456
      """
    )

    #expect(hexString(runtime.splitDividerColor()) == "#123456")
  }

  @Test
  func splitDividerColorFallsBackToDimmedBackground() throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #101010
      """
    )

    #expect(hexString(runtime.splitDividerColor()) == "#0A0A0A")
  }

  @Test
  func unfocusedSplitDimmingUsesConfiguredFillAndOpacity() throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #101010
      unfocused-split-fill = #202020
      unfocused-split-opacity = 0.42
      """
    )

    #expect(hexString(runtime.unfocusedSplitDimmingColor()) == "#202020")
    #expect(abs(runtime.unfocusedSplitDimmingOpacity() - 0.58) < 0.0001)
  }

  @Test
  func unfocusedSplitDimmingFallsBackToBackgroundAndDefaultOpacity() throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #101010
      """
    )

    #expect(hexString(runtime.unfocusedSplitDimmingColor()) == "#101010")
    #expect(abs(runtime.unfocusedSplitDimmingOpacity() - 0.3) < 0.0001)
  }

  @Test
  func globalKeybindDetectionRequiresGlobalPrefix() throws {
    let runtime = try makeGhosttyRuntime(
      """
      keybind = super+shift+0=toggle_visibility
      """
    )

    #expect(!runtime.hasGlobalKeybinds())
  }

  @Test
  func globalKeybindDetectionReadsGhosttyConfig() throws {
    let runtime = try makeGhosttyRuntime(
      """
      keybind = global:super+shift+0=toggle_visibility
      """
    )

    #expect(runtime.hasGlobalKeybinds())
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

    #expect(
      GhosttyRuntime.dispatchAppAction(
        ghostty_action_s(
          tag: GHOSTTY_ACTION_NEW_WINDOW,
          action: ghostty_action_u())))
    #expect(
      GhosttyRuntime.dispatchAppAction(
        ghostty_action_s(
          tag: GHOSTTY_ACTION_CLOSE_ALL_WINDOWS,
          action: ghostty_action_u())))
    #expect(
      GhosttyRuntime.dispatchAppAction(
        ghostty_action_s(
          tag: GHOSTTY_ACTION_CHECK_FOR_UPDATES,
          action: ghostty_action_u())))
    #expect(
      GhosttyRuntime.dispatchAppAction(
        ghostty_action_s(
          tag: GHOSTTY_ACTION_OPEN_CONFIG,
          action: ghostty_action_u())))
    #expect(
      GhosttyRuntime.dispatchAppAction(
        ghostty_action_s(
          tag: GHOSTTY_ACTION_TOGGLE_VISIBILITY,
          action: ghostty_action_u())))
    #expect(GhosttyRuntime.dispatchAppAction(ghostty_action_s(tag: GHOSTTY_ACTION_QUIT, action: ghostty_action_u())))

    #expect(delegate.newWindowCount == 1)
    #expect(delegate.closeAllWindowsCount == 1)
    #expect(delegate.checkForUpdatesCount == 1)
    #expect(delegate.openConfigCount == 1)
    #expect(delegate.toggleVisibilityCount == 1)
    #expect(delegate.quitCount == 1)
  }

  @Test
  func dispatchAppActionReturnsFalseForUnsupportedActions() {
    #expect(
      !GhosttyRuntime.dispatchAppAction(
        ghostty_action_s(
          tag: GHOSTTY_ACTION_PRESENT_TERMINAL,
          action: ghostty_action_u())))
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
  func configurationDiagnosticsExposeTrimmedCurrentErrors() throws {
    let runtime = try makeGhosttyRuntime(
      """
      definitely-invalid-key = nope
      """
    )

    let diagnostics = runtime.configurationDiagnostics()

    #expect(!diagnostics.isEmpty)
    #expect(
      diagnostics.allSatisfy {
        !$0.isEmpty && $0 == $0.trimmingCharacters(in: .whitespacesAndNewlines)
      }
    )
  }

  @Test
  func validReloadClearsConfigurationDiagnostics() throws {
    let fixture = try makePersistentGhosttyRuntime(
      """
      definitely-invalid-key = nope
      """
    )
    defer {
      fixture.cleanup()
    }

    #expect(!fixture.runtime.configurationDiagnostics().isEmpty)

    try """
    background = #101010
    """
    .write(to: fixture.configURL, atomically: true, encoding: .utf8)

    fixture.runtime.reloadAppConfig()

    #expect(fixture.runtime.configurationDiagnostics().isEmpty)
  }

  @Test
  func invalidReloadReplacesConfigurationDiagnostics() throws {
    let fixture = try makePersistentGhosttyRuntime(
      """
      first-invalid-key = nope
      """
    )
    defer {
      fixture.cleanup()
    }

    let initialDiagnostics = fixture.runtime.configurationDiagnostics()
    #expect(initialDiagnostics.count == 1)
    #expect(initialDiagnostics[0].contains("first-invalid-key"))

    try """
    second-invalid-key = nope
    """
    .write(to: fixture.configURL, atomically: true, encoding: .utf8)

    fixture.runtime.reloadAppConfig()

    let reloadedDiagnostics = fixture.runtime.configurationDiagnostics()
    #expect(reloadedDiagnostics.count == 1)
    #expect(reloadedDiagnostics[0].contains("second-invalid-key"))
    #expect(!reloadedDiagnostics[0].contains("first-invalid-key"))
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
  func wakeupCallbacksNeverTickInlineOrCoalesce() async throws {
    let runtime = try makeGhosttyRuntime("")
    let tickCount = Mutex(0)

    for _ in 0..<2 {
      GhosttyRuntime.wakeupForTesting(
        userdataBits: runtime.appUserdataBitsForTesting(),
        onTick: {
          tickCount.withLock { $0 += 1 }
        }
      )
    }

    #expect(tickCount.withLock { $0 } == 0)
    await withCheckedContinuation { continuation in
      DispatchQueue.main.async {
        continuation.resume()
      }
    }
    #expect(tickCount.withLock { $0 } == 2)
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

    let action = ghostty_action_s(tag: GHOSTTY_ACTION_NEW_WINDOW, action: ghostty_action_u())
    let target = ghostty_target_s(tag: GHOSTTY_TARGET_APP, target: ghostty_target_u())
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

  private func makePasteboard() -> NSPasteboard {
    let name = NSPasteboard.Name("supaterm-test-\(UUID().uuidString)")
    let pasteboard = NSPasteboard(name: name)
    pasteboard.clearContents()
    return pasteboard
  }

  private func makeImageData(_ fileType: NSBitmapImageRep.FileType) throws -> Data {
    guard
      let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: 1,
        pixelsHigh: 1,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 4,
        bitsPerPixel: 32
      )
    else {
      throw PasteboardImageTestError.encodingFailed
    }
    guard let pixels = rep.bitmapData else {
      throw PasteboardImageTestError.encodingFailed
    }
    pixels[0] = 255
    pixels[1] = 0
    pixels[2] = 0
    pixels[3] = 255
    guard let data = rep.representation(using: fileType, properties: [:]) else {
      throw PasteboardImageTestError.encodingFailed
    }
    return data
  }

  private func unescapedPath(_ escapedPath: String?) throws -> String {
    let escapedPath = try #require(escapedPath)
    var path = ""
    var isEscaped = false
    for character in escapedPath {
      if isEscaped {
        path.append(character)
        isEscaped = false
      } else if character == "\\" {
        isEscaped = true
      } else {
        path.append(character)
      }
    }
    if isEscaped {
      path.append("\\")
    }
    return path
  }

  private enum PasteboardImageTestError: Error {
    case encodingFailed
  }
}

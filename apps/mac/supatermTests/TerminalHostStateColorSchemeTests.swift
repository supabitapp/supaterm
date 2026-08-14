import AppKit
import Foundation
import GhosttyKit
import Observation
import SupaTheme
import SwiftUI
import Synchronization
import Testing

@testable import supaterm

@MainActor
struct TerminalHostStateColorSchemeTests {
  @Test
  func chromePaletteResolvesFromRuntimeBackground() throws {
    let darkRuntime = try makeGhosttyRuntime(
      """
      background = #21084A
      """
    )
    let lightRuntime = try makeGhosttyRuntime(
      """
      background = #F4E6D8
      """
    )

    let darkHost = TerminalHostState(runtime: darkRuntime, managesTerminalSurfaces: false)
    let lightHost = TerminalHostState(runtime: lightRuntime, managesTerminalSurfaces: false)

    expectBackground(
      darkHost.chromePalette(appearanceMode: .system),
      equals: Palette(colorScheme: .dark, backgroundSeed: ThemeColor(hex: 0x21084A))
    )
    expectBackground(
      lightHost.chromePalette(appearanceMode: .system),
      equals: Palette(colorScheme: .light, backgroundSeed: ThemeColor(hex: 0xF4E6D8))
    )
  }

  @Test
  func configuredSurfaceBackgroundDrivesChromeWhileOSCStaysLocal() async throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #21084A
      background-opacity = 0.4
      """
    )
    let host = TerminalHostState(
      runtime: runtime,
      zmxClient: .noop,
      zmxSessionsEnabled: false
    )
    host.ensureInitialTab(focusing: false)
    let surface = try #require(host.selectedSurfaceView)
    defer { surface.closeSurface() }

    let configured = host.chromePalette(appearanceMode: .system)
    let invalidationCount = Mutex<Int>(0)
    withObservationTracking {
      _ = host.chromePalette(appearanceMode: .system)
    } onChange: {
      invalidationCount.withLock { $0 += 1 }
    }

    let oscAction = ghosttyColorChangeAction(
      kind: GHOSTTY_ACTION_COLOR_KIND_BACKGROUND,
      red: 244,
      green: 230,
      blue: 216
    )
    #expect(surface.bridge.handleAction(target: ghosttySurfaceTarget(), action: oscAction))
    await flushObservation()

    let terminalBackground = try #require(
      NSColor(host.terminalBackgroundColor).usingColorSpace(.sRGB)
    )
    #expect(terminalBackground.redComponent == 244.0 / 255)
    #expect(terminalBackground.greenComponent == 230.0 / 255)
    #expect(terminalBackground.blueComponent == 216.0 / 255)
    #expect(terminalBackground.alphaComponent == 0.4)
    expectBackground(host.chromePalette(appearanceMode: .system), equals: configured)
    #expect(invalidationCount.withLock { $0 } == 0)

    try withConfigChangeAction(
      """
      background = #F4E6D8
      background-opacity = 0.7
      """
    ) { action in
      #expect(surface.bridge.handleAction(target: ghosttySurfaceTarget(), action: action))
    }
    await flushObservation()

    expectBackground(
      host.chromePalette(appearanceMode: .system),
      equals: Palette(colorScheme: .light, backgroundSeed: ThemeColor(hex: 0xF4E6D8))
    )
    let configuredTerminalBackground = try #require(
      NSColor(host.terminalBackgroundColor).usingColorSpace(.sRGB)
    )
    #expect(configuredTerminalBackground.alphaComponent == 0.7)
    #expect(invalidationCount.withLock { $0 } == 1)
  }

  @Test
  func explicitAppearanceChangesSchemeWithoutChangingBackgroundSource() throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #21084A
      """
    )
    let host = TerminalHostState(runtime: runtime, managesTerminalSurfaces: false)

    expectBackground(
      host.chromePalette(appearanceMode: .light),
      equals: Palette(colorScheme: .light, backgroundSeed: ThemeColor(hex: 0x21084A))
    )
  }

  @Test
  func chromePaletteInvalidatesWhenMatchingRuntimeChanges() async throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #21084A
      """
    )
    let host = TerminalHostState(runtime: runtime, managesTerminalSurfaces: false)
    let invalidationCount = Mutex<Int>(0)

    withObservationTracking {
      _ = host.chromePalette(appearanceMode: .system)
    } onChange: {
      invalidationCount.withLock { $0 += 1 }
    }

    NotificationCenter.default.post(name: .ghosttyRuntimeConfigDidChange, object: runtime)
    await flushObservation()

    #expect(invalidationCount.withLock { $0 } == 1)
  }

  @Test
  func chromePaletteIgnoresOtherRuntimeChanges() async throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #21084A
      """
    )
    let otherRuntime = try makeGhosttyRuntime(
      """
      background = #2E3440
      """
    )
    let host = TerminalHostState(runtime: runtime, managesTerminalSurfaces: false)
    let invalidationCount = Mutex<Int>(0)

    withObservationTracking {
      _ = host.chromePalette(appearanceMode: .system)
    } onChange: {
      invalidationCount.withLock { $0 += 1 }
    }

    NotificationCenter.default.post(name: .ghosttyRuntimeConfigDidChange, object: otherRuntime)
    await flushObservation()

    #expect(invalidationCount.withLock { $0 } == 0)
  }

  private func expectBackground(
    _ actual: Palette,
    equals expected: Palette,
    sourceLocation: SourceLocation = #_sourceLocation
  ) {
    #expect(actual.colorScheme == expected.colorScheme, sourceLocation: sourceLocation)
    #expect(actual.backgroundTopValue == expected.backgroundTopValue, sourceLocation: sourceLocation)
    #expect(
      actual.backgroundBottomValue == expected.backgroundBottomValue,
      sourceLocation: sourceLocation
    )
    #expect(
      actual.agentPanelBackgroundValue == expected.agentPanelBackgroundValue,
      sourceLocation: sourceLocation
    )
  }

  private func flushObservation() async {
    for _ in 0..<5 {
      await Task.yield()
    }
  }
}

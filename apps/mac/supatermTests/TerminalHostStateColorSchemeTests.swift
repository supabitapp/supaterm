import Foundation
import GhosttyKit
import Observation
import SwiftUI
import Synchronization
import Testing

@testable import supaterm

@MainActor
struct TerminalHostStateColorSchemeTests {
  @Test
  func terminalChromeColorSchemeResolvesFromRuntimeBackground() throws {
    let darkRuntime = try makeGhosttyRuntime(
      """
      background = #101010
      """
    )
    let lightRuntime = try makeGhosttyRuntime(
      """
      background = #F4E6D8
      """
    )

    let darkHost = TerminalHostState(runtime: darkRuntime, managesTerminalSurfaces: false)
    let lightHost = TerminalHostState(runtime: lightRuntime, managesTerminalSurfaces: false)

    #expect(darkHost.terminalChromeColorScheme == .dark)
    #expect(lightHost.terminalChromeColorScheme == .light)
  }

  @Test
  func selectedSurfaceBackgroundDrivesTerminalChrome() async throws {
    let runtime = try makeGhosttyRuntime("background = #101010")
    let host = TerminalHostState(
      runtime: runtime,
      zmxClient: .noop,
      zmxSessionsEnabled: false
    )
    host.ensureInitialTab(focusing: false)
    let surface = try #require(host.selectedSurfaceView)
    defer { surface.closeSurface() }

    #expect(host.terminalChromeColorScheme == .dark)
    let invalidationCount = Mutex<Int>(0)
    withObservationTracking {
      _ = host.terminalBackgroundColor
    } onChange: {
      invalidationCount.withLock { $0 += 1 }
    }

    let action = ghosttyColorChangeAction(
      kind: GHOSTTY_ACTION_COLOR_KIND_BACKGROUND,
      red: 244,
      green: 230,
      blue: 216
    )
    #expect(surface.bridge.handleAction(target: ghosttySurfaceTarget(), action: action))
    await flushObservation()

    let background = try #require(
      NSColor(host.terminalBackgroundColor).usingColorSpace(.sRGB)
    )
    #expect(background.redComponent == 244.0 / 255)
    #expect(background.greenComponent == 230.0 / 255)
    #expect(background.blueComponent == 216.0 / 255)
    #expect(host.terminalChromeColorScheme == .light)
    #expect(runtime.chromeColorScheme() == .dark)
    #expect(invalidationCount.withLock { $0 } == 1)
  }

  @Test
  func terminalBackgroundColorInvalidatesWhenMatchingRuntimeChanges() async throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #101010
      """
    )
    let host = TerminalHostState(runtime: runtime, managesTerminalSurfaces: false)
    let invalidationCount = Mutex<Int>(0)

    withObservationTracking {
      _ = host.terminalBackgroundColor
    } onChange: {
      invalidationCount.withLock { $0 += 1 }
    }

    NotificationCenter.default.post(name: .ghosttyRuntimeConfigDidChange, object: runtime)
    await flushObservation()

    #expect(invalidationCount.withLock { $0 } == 1)
  }

  @Test
  func terminalBackgroundColorIgnoresOtherRuntimeChanges() async throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #101010
      """
    )
    let otherRuntime = try makeGhosttyRuntime(
      """
      background = #202020
      """
    )
    let host = TerminalHostState(runtime: runtime, managesTerminalSurfaces: false)
    let invalidationCount = Mutex<Int>(0)

    withObservationTracking {
      _ = host.terminalBackgroundColor
    } onChange: {
      invalidationCount.withLock { $0 += 1 }
    }

    NotificationCenter.default.post(name: .ghosttyRuntimeConfigDidChange, object: otherRuntime)
    await flushObservation()

    #expect(invalidationCount.withLock { $0 } == 0)
  }

  @Test
  func terminalChromeColorSchemeInvalidatesWhenMatchingRuntimeChanges() async throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #101010
      """
    )
    let host = TerminalHostState(runtime: runtime, managesTerminalSurfaces: false)
    let invalidationCount = Mutex<Int>(0)

    withObservationTracking {
      _ = host.terminalChromeColorScheme
    } onChange: {
      invalidationCount.withLock { $0 += 1 }
    }

    NotificationCenter.default.post(name: .ghosttyRuntimeConfigDidChange, object: runtime)
    await flushObservation()

    #expect(invalidationCount.withLock { $0 } == 1)
  }

  private func flushObservation() async {
    for _ in 0..<5 {
      await Task.yield()
    }
  }
}

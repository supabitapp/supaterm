import Foundation
import Observation
import Synchronization
import Testing

@testable import supaterm

@MainActor
struct TerminalHostStateThemeTests {
  @Test
  func notificationAttentionColorInvalidatesWhenMatchingRuntimeChanges() async throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #101010
      foreground = #E0E0E0
      palette = 12=#3366FF
      """
    )
    let host = TerminalHostState(runtime: runtime, managesTerminalSurfaces: false)
    let invalidationCount = Mutex<Int>(0)

    withObservationTracking {
      _ = host.notificationAttentionColor
    } onChange: {
      invalidationCount.withLock { $0 += 1 }
    }

    NotificationCenter.default.post(name: .ghosttyRuntimeConfigDidChange, object: runtime)
    await flushObservation()

    #expect(invalidationCount.withLock { $0 } == 1)
  }

  @Test
  func notificationAttentionColorIgnoresOtherRuntimeChanges() async throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #101010
      foreground = #E0E0E0
      palette = 12=#3366FF
      """
    )
    let otherRuntime = try makeGhosttyRuntime(
      """
      background = #101010
      foreground = #E0E0E0
      palette = 12=#00AACC
      """
    )
    let host = TerminalHostState(runtime: runtime, managesTerminalSurfaces: false)
    let invalidationCount = Mutex<Int>(0)

    withObservationTracking {
      _ = host.notificationAttentionColor
    } onChange: {
      invalidationCount.withLock { $0 += 1 }
    }

    NotificationCenter.default.post(name: .ghosttyRuntimeConfigDidChange, object: otherRuntime)
    await flushObservation()

    #expect(invalidationCount.withLock { $0 } == 0)
  }

  private func flushObservation() async {
    for _ in 0..<5 {
      await Task.yield()
    }
  }
}

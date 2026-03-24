import Foundation
import Observation
import Synchronization
import Testing

@testable import supaterm

@MainActor
struct TerminalHostStateThemeTests {
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

  private func flushObservation() async {
    for _ in 0..<5 {
      await Task.yield()
    }
  }
}

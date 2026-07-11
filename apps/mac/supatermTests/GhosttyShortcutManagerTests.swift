import AppKit
import Foundation
import Observation
import Synchronization
import Testing

@testable import supaterm

@MainActor
struct GhosttyShortcutManagerTests {
  @Test
  func configReloadInvalidatesEveryManagerSharingRuntime() async throws {
    _ = NSApplication.shared
    let fixture = try makePersistentGhosttyRuntime(
      """
      keybind = super+t=new_tab
      """
    )
    defer {
      fixture.cleanup()
    }

    let firstManager = GhosttyShortcutManager(runtime: fixture.runtime)
    let secondManager = GhosttyShortcutManager(runtime: fixture.runtime)
    let firstInvalidationCount = Mutex(0)
    let secondInvalidationCount = Mutex(0)

    let firstShortcut = withObservationTracking {
      firstManager.keyboardShortcut(forAction: "new_tab")
    } onChange: {
      firstInvalidationCount.withLock { $0 += 1 }
    }
    let secondShortcut = withObservationTracking {
      secondManager.keyboardShortcut(forAction: "new_tab")
    } onChange: {
      secondInvalidationCount.withLock { $0 += 1 }
    }

    #expect(firstShortcut?.display == "⌘T")
    #expect(secondShortcut?.display == "⌘T")

    try """
    keybind = super+y=new_tab
    """
    .write(to: fixture.configURL, atomically: true, encoding: .utf8)
    fixture.runtime.reloadAppConfig()
    for _ in 0..<5 {
      await Task.yield()
    }

    #expect(firstInvalidationCount.withLock { $0 } == 1)
    #expect(secondInvalidationCount.withLock { $0 } == 1)
    #expect(firstManager.keyboardShortcut(forAction: "new_tab")?.display == "⌘Y")
    #expect(secondManager.keyboardShortcut(forAction: "new_tab")?.display == "⌘Y")
  }
}

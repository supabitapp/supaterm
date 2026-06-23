import AppKit
import ComposableArchitecture
import Testing

@testable import SupatermAppFeature
@testable import SupatermTerminalModels
@testable import supaterm

@MainActor
struct TerminalWindowControllerTests {
  @Test
  func restoredSessionAppliesSavedWindowFrame() {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let visibleFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1_440, height: 900)
      let frame = NSRect(
        x: visibleFrame.minX + 24,
        y: visibleFrame.minY + 24,
        width: 1_100,
        height: 740
      )
      let session = TerminalWindowSession(
        selectedSpaceID: TerminalSpaceID(),
        spaces: [],
        frame: TerminalWindowFrame(frame)
      )
      let controller = TerminalWindowController(
        registry: TerminalWindowRegistry(zmxClient: .noop),
        session: session,
        zmxClient: .noop,
        zmxSessionsEnabled: false
      )
      defer {
        controller.window?.close()
      }

      #expect(controller.window?.frame == frame.constrained(to: visibleFrame))
    }
  }
}

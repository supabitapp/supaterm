import AppKit
import ComposableArchitecture
import Foundation
import Observation
import Synchronization
import Testing

@testable import supaterm

@MainActor
struct TerminalWindowControllerTests {
  @Test
  func injectedRuntimeReloadUpdatesEveryWindow() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let fixture = try makePersistentGhosttyRuntime(
        """
        background = #101010
        """
      )
      defer {
        fixture.cleanup()
      }
      let registry = TerminalWindowRegistry(zmxClient: .noop)
      let firstController = TerminalWindowController(
        runtime: fixture.runtime,
        registry: registry,
        zmxClient: .noop,
        zmxSessionsEnabled: false
      )
      let secondController = TerminalWindowController(
        runtime: fixture.runtime,
        registry: registry,
        zmxClient: .noop,
        zmxSessionsEnabled: false
      )
      defer {
        firstController.window?.delegate = nil
        firstController.window?.close()
        secondController.window?.delegate = nil
        secondController.window?.close()
      }
      let firstInvalidationCount = Mutex(0)
      let secondInvalidationCount = Mutex(0)

      withObservationTracking {
        _ = firstController.terminal.terminalBackgroundColor
      } onChange: {
        firstInvalidationCount.withLock { $0 += 1 }
      }
      withObservationTracking {
        _ = secondController.terminal.terminalBackgroundColor
      } onChange: {
        secondInvalidationCount.withLock { $0 += 1 }
      }

      try """
      background = #202020
      """
      .write(to: fixture.configURL, atomically: true, encoding: .utf8)
      fixture.runtime.reloadAppConfig()
      for _ in 0..<5 {
        await Task.yield()
      }

      #expect(firstInvalidationCount.withLock { $0 } == 1)
      #expect(secondInvalidationCount.withLock { $0 } == 1)
    }
  }

  @Test
  func restoredSessionAppliesSavedWindowFrame() async throws {
    try await withDependencies {
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
        runtime: GhosttyRuntime(applicationIsActive: { false }),
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

  @Test
  func redButtonCloseWarnsBeforeTerminatingLiveSessions() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let controller = TerminalWindowController(
        runtime: GhosttyRuntime(applicationIsActive: { false }),
        registry: TerminalWindowRegistry(zmxClient: .noop),
        zmxClient: .noop,
        zmxSessionsEnabled: false
      )
      defer {
        for tab in controller.terminal.visibleTabs {
          controller.terminal.closeTab(tab.id)
        }
        controller.window?.delegate = nil
        controller.window?.close()
      }
      controller.terminal.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
      let window = try #require(controller.window)

      #expect(!controller.terminal.liveSurfaceIDs().isEmpty)
      #expect(!controller.windowShouldClose(window))
      #expect(
        controller.store.withState(\.terminal.confirmationRequest)
          == TerminalWindowFeature.ConfirmationRequest(
            target: .closeWindow(ObjectIdentifier(window)),
            title: "Close Window?",
            message: TerminalWindowFeature.closeWindowWarningMessage,
            confirmTitle: "Close Window"
          )
      )
    }
  }
}

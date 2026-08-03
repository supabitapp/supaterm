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
  func windowAllowsBehindWindowMaterials() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let runtime = try makeGhosttyRuntime("")

      let controller = TerminalWindowController(
        runtime: runtime,
        registry: TerminalWindowRegistry(zmxClient: .noop),
        zmxClient: .noop,
        zmxSessionsEnabled: false
      )
      defer {
        controller.window?.delegate = nil
        controller.window?.close()
      }
      let window = try #require(controller.window)

      #expect(!window.isOpaque)
      #expect(window.titlebarAppearsTransparent)
      #expect(window.backgroundColor == .clear)
    }
  }

  @Test
  func backgroundOpacityToggleUpdatesEveryWindow() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let runtime = try makeGhosttyRuntime(
        """
        background = #123456
        background-opacity = 0.6
        """
      )
      let registry = TerminalWindowRegistry(zmxClient: .noop)
      let controllers = (0..<2).map { _ in
        TerminalWindowController(
          runtime: runtime,
          registry: registry,
          zmxClient: .noop,
          zmxSessionsEnabled: false
        )
      }
      defer {
        for controller in controllers {
          controller.window?.delegate = nil
          controller.window?.close()
        }
      }
      let windows = try controllers.map { try #require($0.window) }

      #expect(windows.allSatisfy { !$0.isOpaque })
      #expect(windows.allSatisfy { $0.titlebarAppearsTransparent })
      #expect(windows.allSatisfy { $0.backgroundColor == .clear })

      #expect(runtime.toggleBackgroundOpacity())

      #expect(windows.allSatisfy { $0.isOpaque })
      #expect(windows.allSatisfy { !$0.titlebarAppearsTransparent })
      #expect(
        windows.allSatisfy {
          $0.backgroundColor == runtime.backgroundColor().withAlphaComponent(1)
        }
      )

      #expect(runtime.toggleBackgroundOpacity())

      #expect(windows.allSatisfy { !$0.isOpaque })
      #expect(windows.allSatisfy { $0.titlebarAppearsTransparent })
      #expect(windows.allSatisfy { $0.backgroundColor == .clear })
    }
  }

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
      let spaceID = TerminalSpaceCatalog.default.defaultSelectedSpaceID
      let session = TerminalWindowSession(
        displayedSpaceID: spaceID,
        spaces: [
          TerminalSpaceSession(
            spaceID: spaceID,
            selectedTabID: nil,
            nodes: [],
            groups: [],
            collapsedGroupIDs: [],
            tabs: []
          )
        ],
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
        for tab in controller.terminal.visibleTabs {
          controller.terminal.closeTab(tab.id)
        }
        controller.window?.close()
      }

      #expect(controller.window?.frame == frame.constrained(to: visibleFrame))
      #expect(controller.terminal.visibleTabs.count == 1)
    }
  }

  @Test
  func redButtonCloseWarnsBeforeTerminatingLiveSessions() throws {
    try withDependencies {
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
        controller.store.terminal.confirmationRequest
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

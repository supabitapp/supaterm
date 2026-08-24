import AppKit
import ComposableArchitecture
import Foundation
import Observation
import SupaTheme
import Synchronization
import Testing

@testable import supaterm

@MainActor
struct TerminalWindowControllerTests {
  @Test
  func windowStartsWithDefaultContentSize() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let controller = TerminalWindowController(
        runtime: GhosttyRuntime(applicationIsActive: { false }),
        registry: TerminalWindowRegistry.test(zmxClient: .noop),
        zmxClient: .noop,
        zmxSessionsEnabled: false
      )
      defer {
        controller.window?.delegate = nil
        controller.window?.close()
      }
      let window = try #require(controller.window)

      #expect(window.contentRect(forFrameRect: window.frame).size == NSSize(width: 1_440, height: 900))
    }
  }

  @Test
  func windowAllowsBehindWindowMaterials() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let controller = TerminalWindowController(
        runtime: GhosttyRuntime(applicationIsActive: { false }),
        registry: TerminalWindowRegistry.test(zmxClient: .noop),
        zmxClient: .noop,
        zmxSessionsEnabled: false
      )
      defer {
        controller.window?.delegate = nil
        controller.window?.close()
      }
      let window = try #require(controller.window)

      #expect(!window.isOpaque)
      #expect(window.backgroundColor == .clear)
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
      let registry = TerminalWindowRegistry.test(zmxClient: .noop)
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
      let spaces = [TerminalSpaceItem(name: "Displayed"), TerminalSpaceItem(name: "Hidden")]
      @Shared(.terminalSpaceCatalog) var spaceCatalog = TerminalSpaceCatalog.default
      $spaceCatalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }
      let spaceID = spaces[0].id
      let hiddenSpaceID = spaces[1].id
      let groupID = TerminalTabGroupID()
      let session = TerminalWindowSession(
        displayedSpaceID: spaceID,
        spaces: [
          TerminalSpaceSession(
            spaceID: spaceID,
            selectedTabID: nil,
            nodes: [
              TerminalTabNodeSession(
                item: .group(groupID),
                parent: .root(isPinned: false),
                order: 0
              )
            ],
            groups: [
              TerminalTabGroupSession(
                id: groupID,
                title: "Saved",
                color: .blue,
                lifetime: .durable
              )
            ],
            collapsedGroupIDs: [groupID],
            tabs: []
          ),
          TerminalSpaceSession(
            spaceID: hiddenSpaceID,
            selectedTabID: nil,
            nodes: [],
            groups: [],
            collapsedGroupIDs: [],
            tabs: []
          ),
        ],
        frame: TerminalWindowFrame(frame),
        sidebarWidth: 336
      )
      let controller = TerminalWindowController(
        runtime: GhosttyRuntime(applicationIsActive: { false }),
        registry: TerminalWindowRegistry.test(zmxClient: .noop),
        launch: .restore(session),
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
      #expect(controller.terminal.spaceManager.rootItems(in: spaceID).first?.id == .group(groupID))
      #expect(controller.terminal.spaceManager.instance(for: hiddenSpaceID) != nil)
      #expect(controller.store.terminal.sidebarWidth == 336)
    }
  }

  @Test
  func committedSidebarWidthUpdatesRestorationCatalog() async {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let registry = TerminalWindowRegistry.test(zmxClient: .noop)
      let savedCatalog = Mutex<TerminalSessionCatalog?>(nil)
      let controller = TerminalWindowController(
        runtime: GhosttyRuntime(applicationIsActive: { false }),
        registry: registry,
        zmxClient: .noop,
        zmxSessionsEnabled: false,
        onSessionChange: {
          savedCatalog.withLock { $0 = registry.restorationSnapshot() }
        }
      )
      defer {
        controller.window?.delegate = nil
        controller.window?.close()
      }

      _ = controller.store.send(
        .terminal(.sidebarResizeInput(.began, totalWidth: 1_440))
      )
      _ = controller.store.send(
        .terminal(.sidebarResizeInput(.changed(delta: 72), totalWidth: 1_440))
      )
      _ = controller.store.send(
        .terminal(.sidebarResizeInput(.ended, totalWidth: 1_440))
      )
      for _ in 0..<5 {
        await Task.yield()
      }

      #expect(savedCatalog.withLock { $0?.windows.first?.sidebarWidth } == 360)
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
        registry: TerminalWindowRegistry.test(zmxClient: .noop),
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
      controller.terminal.ensureInitialTab(focusing: false, startupCommand: nil)
      let window = try #require(controller.window)

      #expect(!controller.terminal.liveSurfaceIDs().isEmpty)
      #expect(!controller.windowShouldClose(window))
      #expect(
        controller.store.terminal.windowCloseConfirmation
          == TerminalWindowFeature.WindowCloseConfirmation(
            target: .closeWindow(ObjectIdentifier(window)),
            title: "Close Window?",
            message: TerminalWindowFeature.closeWindowWarningMessage,
            confirmTitle: "Close Window"
          )
      )
    }
  }
}

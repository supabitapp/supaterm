import ComposableArchitecture
import Foundation
import GhosttyKit
import Sharing
import Testing

@testable import SupatermCLIShared
@testable import SupatermGhosttyFeature
@testable import SupatermTerminalFeature
@testable import SupatermTerminalModels
@testable import supaterm

@MainActor
struct TerminalHostStatePinnedTabSharingTests {
  @Test
  func pinningTabPersistsAndPropagatesAcrossHosts() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
      initializeGhosttyForTests()
    } operation: {
      let writer = TerminalHostState()
      let receiver = TerminalHostState(managesTerminalSurfaces: false)

      writer.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
      let tabID = try #require(writer.selectedTabID)

      writer.handleCommand(.togglePinned(tabID))
      await flushPinnedTabCatalogObservation()

      @Shared(.terminalPinnedTabCatalog) var sharedCatalog = .default
      let selectedSpaceID = try #require(writer.selectedSpaceID)

      #expect(sharedCatalog.tabs(in: selectedSpaceID).map(\.id) == [tabID])
      #expect(receiver.spaceManager.tabs(in: selectedSpaceID).map(\.id) == [tabID])
      #expect(receiver.spaceManager.tabs(in: selectedSpaceID).allSatisfy { $0.isPinned })
    }
  }

  @Test
  func renamingPinnedTabPropagatesAcrossHosts() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
      initializeGhosttyForTests()
    } operation: {
      let writer = TerminalHostState()
      let receiver = TerminalHostState(managesTerminalSurfaces: false)

      writer.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
      let tabID = try #require(writer.selectedTabID)
      writer.handleCommand(.togglePinned(tabID))
      await flushPinnedTabCatalogObservation()

      writer.setLockedTabTitle("Pinned Shell", for: tabID)
      await flushPinnedTabCatalogObservation()

      let sharedTab = try #require(receiver.spaceManager.tab(for: tabID))
      #expect(sharedTab.title == "Pinned Shell")
      #expect(sharedTab.isTitleLocked)
    }
  }

  @Test
  func renamingPinnedTabDoesNotRebuildExistingPinnedTabsInOtherHosts() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
      initializeGhosttyForTests()
    } operation: {
      let writer = TerminalHostState()
      let receiver = TerminalHostState()

      writer.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
      let tabID = try #require(writer.selectedTabID)
      writer.handleCommand(.togglePinned(tabID))
      await flushPinnedTabCatalogObservation()

      let originalReceiverPaneIDs = try #require(receiver.trees[tabID]?.leaves().map(\.id))

      writer.setLockedTabTitle("Pinned Shell", for: tabID)
      await flushPinnedTabCatalogObservation()

      let receiverPaneIDs = try #require(receiver.trees[tabID]?.leaves().map(\.id))
      #expect(receiverPaneIDs == originalReceiverPaneIDs)
      #expect(receiver.spaceManager.tab(for: tabID)?.title == "Pinned Shell")
      #expect(receiver.spaceManager.tab(for: tabID)?.isTitleLocked == true)
    }
  }

  @Test
  func paneChangesAutoSavePinnedTabsWithoutRebuildingExistingHosts() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
      initializeGhosttyForTests()
    } operation: {
      let writer = TerminalHostState()
      let receiver = TerminalHostState()

      writer.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
      let tabID = try #require(writer.selectedTabID)
      writer.handleCommand(.togglePinned(tabID))
      await flushPinnedTabCatalogObservation()

      let originalReceiverPaneIDs = try #require(receiver.trees[tabID]?.leaves().map(\.id))
      #expect(originalReceiverPaneIDs.count == 1)

      _ = try writer.createPane(
        TerminalCreatePaneRequest(
          startupCommand: nil,
          direction: .right,
          focus: false,
          equalize: false,
          target: .tab(windowIndex: 1, spaceIndex: 1, tabIndex: 1)
        )
      )
      await flushPinnedTabCatalogObservation()

      let receiverPaneIDs = try #require(receiver.trees[tabID]?.leaves().map(\.id))
      #expect(receiverPaneIDs == originalReceiverPaneIDs)

      let restored = TerminalHostState()
      await flushPinnedTabCatalogObservation()
      #expect(restored.trees[tabID]?.leaves().count == 2)
    }
  }

  @Test
  func renamingPinnedTabPreservesAutoSavedLayoutChanges() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
      initializeGhosttyForTests()
    } operation: {
      let writer = TerminalHostState()

      writer.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
      let tabID = try #require(writer.selectedTabID)
      writer.handleCommand(.togglePinned(tabID))
      await flushPinnedTabCatalogObservation()

      _ = try writer.createPane(
        TerminalCreatePaneRequest(
          startupCommand: nil,
          direction: .right,
          focus: false,
          equalize: false,
          target: .tab(windowIndex: 1, spaceIndex: 1, tabIndex: 1)
        )
      )
      await flushPinnedTabCatalogObservation()

      writer.setLockedTabTitle("Pinned Shell", for: tabID)
      await flushPinnedTabCatalogObservation()

      let restored = TerminalHostState()
      await flushPinnedTabCatalogObservation()

      #expect(restored.trees[tabID]?.leaves().count == 2)
      #expect(restored.spaceManager.tab(for: tabID)?.title == "Pinned Shell")
      #expect(restored.spaceManager.tab(for: tabID)?.isTitleLocked == true)
    }
  }

  @Test
  func closingPinnedTabRemovesItAndSelectsPreviousLiveTab() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
      initializeGhosttyForTests()
    } operation: {
      let host = TerminalHostState()
      host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
      let pinnedTabID = try #require(host.selectedTabID)
      let selectedSpaceID = try #require(host.selectedSpaceID)
      host.handleCommand(.togglePinned(pinnedTabID))
      await flushPinnedTabCatalogObservation()

      host.handleCommand(.createTab(inheritingFromSurfaceID: nil))
      let regularTabID = try #require(host.selectedTabID)
      host.handleCommand(.selectTab(pinnedTabID))

      host.handleCommand(.closeTab(pinnedTabID))

      @Shared(.terminalPinnedTabCatalog) var sharedCatalog = .default
      #expect(host.spaceManager.tab(for: pinnedTabID) == nil)
      #expect(host.trees[pinnedTabID] == nil)
      #expect(host.selectedSpaceID == selectedSpaceID)
      #expect(host.selectedTabID == regularTabID)
      #expect(host.trees[regularTabID] != nil)
      #expect(sharedCatalog.tabs(in: selectedSpaceID).isEmpty)
    }
  }

  @Test
  func closingLastPaneInPinnedTabKeepsItDormantAndSelectsPreviousLiveTab() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
      initializeGhosttyForTests()
    } operation: {
      let host = TerminalHostState()
      host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
      let pinnedTabID = try #require(host.selectedTabID)
      host.handleCommand(.togglePinned(pinnedTabID))
      await flushPinnedTabCatalogObservation()

      host.handleCommand(.createTab(inheritingFromSurfaceID: nil))
      let selectedSpaceID = try #require(host.selectedSpaceID)
      let regularTabID = try #require(host.selectedTabID)
      host.handleCommand(.selectTab(pinnedTabID))
      let surfaceID = try #require(host.currentFocusedSurfaceID())

      host.handleCommand(.closeSurface(surfaceID))

      @Shared(.terminalPinnedTabCatalog) var sharedCatalog = .default
      // Crucial invariant: closing the final pane in a pinned tab must keep the pinned tab dormant.
      #expect(host.spaceManager.tab(for: pinnedTabID)?.isPinned == true)
      #expect(host.trees[pinnedTabID] == nil)
      #expect(host.selectedTabID == regularTabID)
      #expect(host.trees[regularTabID] != nil)
      #expect(sharedCatalog.tabs(in: selectedSpaceID).map(\.id) == [pinnedTabID])
    }
  }

  @Test
  func closingLastPaneInZmxBackedPinnedTabKillsSessionAndKeepsCatalog() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
      initializeGhosttyForTests()
    } operation: {
      let killedSurfaceIDs = LockIsolated<[UUID]>([])
      let zmxURL = try makeIdleZmxExecutable()
      defer { try? FileManager.default.removeItem(at: zmxURL.deletingLastPathComponent()) }
      let host = TerminalHostState(
        zmxClient: ZmxClient(
          executableURL: { zmxURL },
          isBundled: { true },
          killSession: { surfaceID in
            killedSurfaceIDs.withValue { $0.append(surfaceID) }
          },
          listSessions: { [] }
        )
      )
      host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
      let pinnedTabID = try #require(host.selectedTabID)
      host.handleCommand(.togglePinned(pinnedTabID))
      await flushPinnedTabCatalogObservation()

      host.handleCommand(.createTab(inheritingFromSurfaceID: nil))
      let selectedSpaceID = try #require(host.selectedSpaceID)
      let regularTabID = try #require(host.selectedTabID)
      host.handleCommand(.selectTab(pinnedTabID))
      let surfaceID = try #require(host.currentFocusedSurfaceID())

      host.handleCommand(.closeSurface(surfaceID))

      @Shared(.terminalPinnedTabCatalog) var sharedCatalog = .default
      let didKillSurface = await waitForKilledSurface(surfaceID, in: killedSurfaceIDs)
      #expect(didKillSurface)
      #expect(host.spaceManager.tab(for: pinnedTabID)?.isPinned == true)
      #expect(host.trees[pinnedTabID] == nil)
      #expect(host.selectedTabID == regularTabID)
      #expect(sharedCatalog.tabs(in: selectedSpaceID).map(\.id) == [pinnedTabID])

      host.handleCommand(.selectTab(pinnedTabID))

      #expect(host.selectedTabID == pinnedTabID)
      #expect(host.trees[pinnedTabID]?.leaves().count == 1)
    }
  }

  @Test
  func closingLastPaneInPinnedTabPreservesWorkingDirectory() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
      initializeGhosttyForTests()
    } operation: {
      let restoredPath = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString, isDirectory: true)
      try FileManager.default.createDirectory(at: restoredPath, withIntermediateDirectories: true)
      let restoredPathString = GhosttySurfaceView.normalizedWorkingDirectoryPath(
        restoredPath.path(percentEncoded: false)
      )
      defer {
        try? FileManager.default.removeItem(at: restoredPath)
      }

      let host = TerminalHostState()
      host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
      let pinnedTabID = try #require(host.selectedTabID)
      host.handleCommand(.togglePinned(pinnedTabID))
      await flushPinnedTabCatalogObservation()

      host.handleCommand(.createTab(inheritingFromSurfaceID: nil))
      host.handleCommand(.selectTab(pinnedTabID))
      host.selectedSurfaceView?.bridge.state.pwd = restoredPathString
      let surfaceID = try #require(host.currentFocusedSurfaceID())

      host.handleCommand(.closeSurface(surfaceID))

      @Shared(.terminalPinnedTabCatalog) var sharedCatalog = .default
      let selectedSpaceID = try #require(host.selectedSpaceID)
      let pinnedTab = try #require(
        sharedCatalog.tabs(in: selectedSpaceID).first(where: { $0.id == pinnedTabID })
      )
      guard case .leaf(let leaf) = pinnedTab.session.root else {
        Issue.record("Expected leaf root")
        return
      }
      #expect(leaf.workingDirectoryPath == restoredPathString)
      #expect(host.trees[pinnedTabID] == nil)

      host.handleCommand(.selectTab(pinnedTabID))

      #expect(host.selectedSurfaceState?.pwd == restoredPathString)
    }
  }

  @Test
  func closingSuspendedZmxBackedPinnedTabKillsCatalogSessionAndRemovesPlaceholder() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
      initializeGhosttyForTests()
    } operation: {
      let killedSurfaceIDs = LockIsolated<[UUID]>([])
      let zmxURL = try makeIdleZmxExecutable()
      defer { try? FileManager.default.removeItem(at: zmxURL.deletingLastPathComponent()) }
      let host = TerminalHostState(
        zmxClient: ZmxClient(
          executableURL: { zmxURL },
          isBundled: { true },
          killSession: { surfaceID in
            killedSurfaceIDs.withValue { $0.append(surfaceID) }
          },
          listSessions: { [] }
        )
      )
      host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
      let pinnedTabID = try #require(host.selectedTabID)
      let selectedSpaceID = try #require(host.selectedSpaceID)
      host.handleCommand(.togglePinned(pinnedTabID))
      await flushPinnedTabCatalogObservation()

      host.handleCommand(.createTab(inheritingFromSurfaceID: nil))
      let regularTabID = try #require(host.selectedTabID)
      host.handleCommand(.selectTab(pinnedTabID))
      let surfaceID = try #require(host.currentFocusedSurfaceID())

      host.suspendPinnedTab(pinnedTabID)

      #expect(killedSurfaceIDs.value.isEmpty)

      host.handleCommand(.closeTab(pinnedTabID))

      @Shared(.terminalPinnedTabCatalog) var sharedCatalog = .default
      let didKillSurface = await waitForKilledSurface(surfaceID, in: killedSurfaceIDs)
      #expect(didKillSurface)
      #expect(host.spaceManager.tab(for: pinnedTabID) == nil)
      #expect(host.trees[pinnedTabID] == nil)
      #expect(host.selectedTabID == regularTabID)
      #expect(sharedCatalog.tabs(in: selectedSpaceID).isEmpty)
    }
  }

  @Test
  func suspendingPinnedTabPreservesWorkingDirectory() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
      initializeGhosttyForTests()
    } operation: {
      let restoredPath = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString, isDirectory: true)
      try FileManager.default.createDirectory(at: restoredPath, withIntermediateDirectories: true)
      let restoredPathString = GhosttySurfaceView.normalizedWorkingDirectoryPath(
        restoredPath.path(percentEncoded: false)
      )
      defer {
        try? FileManager.default.removeItem(at: restoredPath)
      }

      let host = TerminalHostState()
      host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
      let pinnedTabID = try #require(host.selectedTabID)
      host.handleCommand(.togglePinned(pinnedTabID))
      await flushPinnedTabCatalogObservation()

      host.handleCommand(.createTab(inheritingFromSurfaceID: nil))
      host.handleCommand(.selectTab(pinnedTabID))
      host.selectedSurfaceView?.bridge.state.pwd = restoredPathString

      host.suspendPinnedTab(pinnedTabID)

      @Shared(.terminalPinnedTabCatalog) var sharedCatalog = .default
      let selectedSpaceID = try #require(host.selectedSpaceID)
      let pinnedTab = try #require(
        sharedCatalog.tabs(in: selectedSpaceID).first(where: { $0.id == pinnedTabID })
      )
      guard case .leaf(let leaf) = pinnedTab.session.root else {
        Issue.record("Expected leaf root")
        return
      }
      #expect(leaf.workingDirectoryPath == restoredPathString)
      #expect(host.trees[pinnedTabID] == nil)

      host.handleCommand(.selectTab(pinnedTabID))

      #expect(host.selectedSurfaceState?.pwd == restoredPathString)
    }
  }

  @Test
  func dormantPinnedTabWorkingDirectoryQueryDoesNotCreatePane() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
      initializeGhosttyForTests()
    } operation: {
      let restoredPath = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString, isDirectory: true)
      try FileManager.default.createDirectory(at: restoredPath, withIntermediateDirectories: true)
      let restoredPathString = GhosttySurfaceView.normalizedWorkingDirectoryPath(
        restoredPath.path(percentEncoded: false)
      )
      let expectedDisplayPath = (restoredPathString as NSString).abbreviatingWithTildeInPath
      defer {
        try? FileManager.default.removeItem(at: restoredPath)
      }

      let host = TerminalHostState()
      host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
      let pinnedTabID = try #require(host.selectedTabID)
      host.handleCommand(.togglePinned(pinnedTabID))
      await flushPinnedTabCatalogObservation()

      host.handleCommand(.createTab(inheritingFromSurfaceID: nil))
      host.handleCommand(.selectTab(pinnedTabID))
      host.selectedSurfaceView?.bridge.state.pwd = restoredPathString

      host.suspendPinnedTab(pinnedTabID)

      #expect(host.trees[pinnedTabID] == nil)
      #expect(host.paneWorkingDirectories(for: pinnedTabID) == [expectedDisplayPath])
      #expect(host.trees[pinnedTabID] == nil)
    }
  }

  @Test
  func suspendingSavedMultiPanePinnedTabPreservesEachPaneWorkingDirectory() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
      initializeGhosttyForTests()
    } operation: {
      let firstPath = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString, isDirectory: true)
      let secondPath = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString, isDirectory: true)
      try FileManager.default.createDirectory(at: firstPath, withIntermediateDirectories: true)
      try FileManager.default.createDirectory(at: secondPath, withIntermediateDirectories: true)
      let firstPathString = GhosttySurfaceView.normalizedWorkingDirectoryPath(
        firstPath.path(percentEncoded: false)
      )
      let secondPathString = GhosttySurfaceView.normalizedWorkingDirectoryPath(
        secondPath.path(percentEncoded: false)
      )
      defer {
        try? FileManager.default.removeItem(at: firstPath)
        try? FileManager.default.removeItem(at: secondPath)
      }

      let host = TerminalHostState()
      host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
      let pinnedTabID = try #require(host.selectedTabID)
      host.handleCommand(.togglePinned(pinnedTabID))
      await flushPinnedTabCatalogObservation()

      host.selectedSurfaceView?.bridge.state.pwd = firstPathString
      let pane = try host.createPane(
        TerminalCreatePaneRequest(
          startupCommand: nil,
          cwd: secondPathString,
          direction: .right,
          focus: false,
          equalize: false,
          target: .tab(windowIndex: 1, spaceIndex: 1, tabIndex: 1)
        )
      )
      host.surfaces[pane.paneID]?.bridge.state.pwd = secondPathString
      await flushPinnedTabCatalogObservation()

      let initialLeaves = try #require(host.trees[pinnedTabID]?.leaves())
      #expect(initialLeaves.count == 2)
      host.suspendPinnedTab(pinnedTabID)

      @Shared(.terminalPinnedTabCatalog) var sharedCatalog = .default
      let selectedSpaceID = try #require(host.selectedSpaceID)
      let pinnedTab = try #require(
        sharedCatalog.tabs(in: selectedSpaceID).first(where: { $0.id == pinnedTabID })
      )
      guard case .split(let split) = pinnedTab.session.root else {
        Issue.record("Expected split root")
        return
      }
      #expect(split.direction == .horizontal)
      #expect(split.ratio == 0.5)
      guard case .leaf(let left) = split.left, case .leaf(let right) = split.right else {
        Issue.record("Expected leaf split children")
        return
      }
      #expect(left.workingDirectoryPath == firstPathString)
      #expect(right.workingDirectoryPath == secondPathString)
      #expect(host.trees[pinnedTabID] == nil)

      host.handleCommand(.selectTab(pinnedTabID))

      #expect(
        host.trees[pinnedTabID]?.leaves().map { $0.bridge.state.pwd }
          == [firstPathString, secondPathString]
      )
    }
  }

  @Test
  func zmxBackedChildExitInPinnedSplitReattachesPaneWithoutKillingSession() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
      initializeGhosttyForTests()
    } operation: {
      let sessionIDs = LockIsolated<Set<String>>([])
      let killedSurfaceIDs = LockIsolated<[UUID]>([])
      let zmxURL = try makeIdleZmxExecutable()
      defer { try? FileManager.default.removeItem(at: zmxURL.deletingLastPathComponent()) }
      let host = TerminalHostState(
        zmxClient: ZmxClient(
          executableURL: { zmxURL },
          isBundled: { true },
          killSession: { surfaceID in
            killedSurfaceIDs.withValue { $0.append(surfaceID) }
          },
          listSessions: {
            Array(sessionIDs.value)
          }
        )
      )
      host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
      let pinnedTabID = try #require(host.selectedTabID)
      host.handleCommand(.togglePinned(pinnedTabID))
      await flushPinnedTabCatalogObservation()

      _ = try host.createPane(
        TerminalCreatePaneRequest(
          startupCommand: nil,
          direction: .right,
          focus: false,
          equalize: false,
          target: .tab(windowIndex: 1, spaceIndex: 1, tabIndex: 1)
        )
      )
      let initialSurfaces = try #require(host.trees[pinnedTabID]?.leaves())
      let initialSurfaceIDs = initialSurfaces.map(\.id)
      let exitedSurface = initialSurfaces[0]
      sessionIDs.withValue {
        $0.insert(ZmxSessionID.make(surfaceID: exitedSurface.id))
      }

      let target = ghostty_target_s(tag: GHOSTTY_TARGET_SURFACE, target: ghostty_target_u())
      var action = ghostty_action_s(tag: GHOSTTY_ACTION_SHOW_CHILD_EXITED, action: ghostty_action_u())
      action.action.child_exited.exit_code = 0
      action.action.child_exited.timetime_ms = 28

      #expect(exitedSurface.bridge.handleAction(target: target, action: action))
      let currentSurfaces = try await waitForSurfaceReplacement(
        in: host,
        tabID: pinnedTabID,
        replacing: exitedSurface
      )
      #expect(currentSurfaces.map(\.id) == initialSurfaceIDs)
      #expect(currentSurfaces[0] !== exitedSurface)
      #expect(killedSurfaceIDs.value.isEmpty)
    }
  }

  @Test
  func zmxBackedChildExitRetriesTransientSessionListFailureBeforeClosingPane() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
      initializeGhosttyForTests()
    } operation: {
      let sessionIDs = LockIsolated<Set<String>>([])
      let listCallCount = LockIsolated(0)
      let killedSurfaceIDs = LockIsolated<[UUID]>([])
      let zmxURL = try makeIdleZmxExecutable()
      defer { try? FileManager.default.removeItem(at: zmxURL.deletingLastPathComponent()) }
      let host = TerminalHostState(
        zmxClient: ZmxClient(
          executableURL: { zmxURL },
          isBundled: { true },
          killSession: { surfaceID in
            killedSurfaceIDs.withValue { $0.append(surfaceID) }
          },
          listSessions: {
            listCallCount.withValue {
              $0 += 1
              guard $0 > 1 else { return nil }
              return Array(sessionIDs.value)
            }
          }
        )
      )
      host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
      let pinnedTabID = try #require(host.selectedTabID)
      host.handleCommand(.togglePinned(pinnedTabID))
      await flushPinnedTabCatalogObservation()

      _ = try host.createPane(
        TerminalCreatePaneRequest(
          startupCommand: nil,
          direction: .right,
          focus: false,
          equalize: false,
          target: .tab(windowIndex: 1, spaceIndex: 1, tabIndex: 1)
        )
      )
      let initialSurfaces = try #require(host.trees[pinnedTabID]?.leaves())
      let initialSurfaceIDs = initialSurfaces.map(\.id)
      let exitedSurface = initialSurfaces[0]
      sessionIDs.withValue {
        $0.insert(ZmxSessionID.make(surfaceID: exitedSurface.id))
      }

      let target = ghostty_target_s(tag: GHOSTTY_TARGET_SURFACE, target: ghostty_target_u())
      var action = ghostty_action_s(tag: GHOSTTY_ACTION_SHOW_CHILD_EXITED, action: ghostty_action_u())
      action.action.child_exited.exit_code = 0
      action.action.child_exited.timetime_ms = 28

      #expect(exitedSurface.bridge.handleAction(target: target, action: action))
      let currentSurfaces = try await waitForSurfaceReplacement(
        in: host,
        tabID: pinnedTabID,
        replacing: exitedSurface
      )
      #expect(currentSurfaces.map(\.id) == initialSurfaceIDs)
      #expect(currentSurfaces[0] !== exitedSurface)
      #expect(killedSurfaceIDs.value.isEmpty)
      #expect(listCallCount.value == 2)
    }
  }

  @Test
  func selectingSuspendedPinnedTabCreatesFreshPane() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
      initializeGhosttyForTests()
    } operation: {
      let host = TerminalHostState()
      host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
      let pinnedTabID = try #require(host.selectedTabID)
      host.handleCommand(.togglePinned(pinnedTabID))
      await flushPinnedTabCatalogObservation()
      host.handleCommand(.createTab(inheritingFromSurfaceID: nil))
      host.handleCommand(.selectTab(pinnedTabID))
      host.suspendPinnedTab(pinnedTabID)

      #expect(host.trees[pinnedTabID] == nil)

      host.handleCommand(.selectTab(pinnedTabID))

      #expect(host.selectedTabID == pinnedTabID)
      #expect(host.trees[pinnedTabID]?.leaves().count == 1)
    }
  }

  @Test
  func closeRequestForLastPaneInPinnedTabDoesNotRequestWindowClose() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
      initializeGhosttyForTests()
    } operation: {
      let host = TerminalHostState()
      let stream = host.eventStream()
      var iterator = stream.makeAsyncIterator()
      host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
      let pinnedTabID = try #require(host.selectedTabID)
      host.handleCommand(.togglePinned(pinnedTabID))
      await flushPinnedTabCatalogObservation()
      let surfaceID = try #require(host.currentFocusedSurfaceID())

      host.requestCloseSurface(surfaceID, needsConfirmation: false)

      let event = try #require(await iterator.next())
      #expect(
        event
          == .closeRequested(
            TerminalCloseRequest(target: .surface(surfaceID), needsConfirmation: false)))
    }
  }

  @Test
  func catalogUpdatesDoNotRespawnSuspendedPinnedTab() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
      initializeGhosttyForTests()
    } operation: {
      let host = TerminalHostState()
      host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
      let pinnedTabID = try #require(host.selectedTabID)
      let selectedSpaceID = try #require(host.selectedSpaceID)
      host.handleCommand(.togglePinned(pinnedTabID))
      await flushPinnedTabCatalogObservation()
      host.handleCommand(.createTab(inheritingFromSurfaceID: nil))
      host.handleCommand(.selectTab(pinnedTabID))
      host.suspendPinnedTab(pinnedTabID)

      @Shared(.terminalPinnedTabCatalog) var sharedCatalog = .default
      $sharedCatalog.withLock {
        let tabs = $0.tabs(in: selectedSpaceID).map { tab in
          var tab = tab
          tab.session.lockedTitle = "Pinned Shell"
          return tab
        }
        $0 = $0.updatingTabs(tabs, in: selectedSpaceID)
      }
      await flushPinnedTabCatalogObservation()

      #expect(host.trees[pinnedTabID] == nil)
      #expect(host.spaceManager.tab(for: pinnedTabID)?.title == "Pinned Shell")
    }
  }

  @Test
  func unpinningSuspendedPinnedTabRemovesPlaceholder() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
      initializeGhosttyForTests()
    } operation: {
      let host = TerminalHostState()
      host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
      let pinnedTabID = try #require(host.selectedTabID)
      let selectedSpaceID = try #require(host.selectedSpaceID)
      host.handleCommand(.togglePinned(pinnedTabID))
      await flushPinnedTabCatalogObservation()
      host.handleCommand(.createTab(inheritingFromSurfaceID: nil))
      host.handleCommand(.selectTab(pinnedTabID))
      host.suspendPinnedTab(pinnedTabID)

      host.handleCommand(.togglePinned(pinnedTabID))

      @Shared(.terminalPinnedTabCatalog) var sharedCatalog = .default
      #expect(host.spaceManager.tab(for: pinnedTabID) == nil)
      #expect(sharedCatalog.tabs(in: selectedSpaceID).isEmpty)
    }
  }

  @Test
  func unpinningPinnedTabConvertsExistingCopiesIntoRegularTabs() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
      initializeGhosttyForTests()
    } operation: {
      let writer = TerminalHostState()
      let receiver = TerminalHostState()

      writer.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
      let tabID = try #require(writer.selectedTabID)
      writer.handleCommand(.togglePinned(tabID))
      await flushPinnedTabCatalogObservation()

      let originalReceiverPaneIDs = try #require(receiver.trees[tabID]?.leaves().map(\.id))
      @Shared(.terminalPinnedTabCatalog) var sharedCatalog = .default
      let selectedSpaceID = try #require(writer.selectedSpaceID)

      writer.handleCommand(.togglePinned(tabID))
      await flushPinnedTabCatalogObservation()

      #expect(writer.spaceManager.tab(for: tabID)?.isPinned == false)
      #expect(receiver.spaceManager.tab(for: tabID)?.isPinned == false)
      #expect(receiver.regularTabs.map(\.id).contains(tabID))
      #expect(receiver.trees[tabID]?.leaves().map(\.id) == originalReceiverPaneIDs)
      #expect(sharedCatalog.tabs(in: selectedSpaceID).isEmpty)
    }
  }

  @Test
  func repinningSharedTabPromotesRegularCopiesInsteadOfDuplicatingThem() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
      initializeGhosttyForTests()
    } operation: {
      let writer = TerminalHostState()
      let receiver = TerminalHostState()

      writer.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
      let tabID = try #require(writer.selectedTabID)
      let selectedSpaceID = try #require(writer.selectedSpaceID)

      writer.handleCommand(.togglePinned(tabID))
      await flushPinnedTabCatalogObservation()

      writer.handleCommand(.togglePinned(tabID))
      await flushPinnedTabCatalogObservation()

      receiver.handleCommand(.togglePinned(tabID))
      await flushPinnedTabCatalogObservation()

      let writerTabs = writer.spaceManager.tabs(in: selectedSpaceID)
      #expect(writerTabs.map(\.id) == [tabID])
      #expect(writerTabs.map(\.isPinned) == [true])
      #expect(writer.regularTabs.isEmpty)
      #expect(Set(writerTabs.map(\.id)).count == writerTabs.count)
    }
  }

  @Test
  func removingSharedSpacePrunesPinnedTabs() async {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.terminalSpaceCatalog) var sharedSpaceCatalog = .default
      @Shared(.terminalPinnedTabCatalog) var sharedPinnedTabCatalog = .default

      let firstSpace = PersistedTerminalSpace(name: "A")
      let secondSpace = PersistedTerminalSpace(name: "B")
      $sharedSpaceCatalog.withLock {
        $0 = TerminalSpaceCatalog(
          defaultSelectedSpaceID: firstSpace.id,
          spaces: [firstSpace, secondSpace]
        )
      }
      $sharedPinnedTabCatalog.withLock {
        $0 = TerminalPinnedTabCatalog(
          spaces: [
            PersistedPinnedTerminalTabsForSpace(
              id: secondSpace.id,
              tabs: [
                PersistedPinnedTerminalTab(
                  id: TerminalTabID(),
                  session: TerminalTabSession(
                    isPinned: true,
                    lockedTitle: "Pinned",
                    focusedPaneIndex: 0,
                    root: .leaf(TerminalPaneLeafSession(workingDirectoryPath: nil))
                  )
                )
              ]
            )
          ]
        )
      }

      let host = TerminalHostState(managesTerminalSurfaces: false)

      $sharedSpaceCatalog.withLock {
        $0 = TerminalSpaceCatalog(
          defaultSelectedSpaceID: firstSpace.id,
          spaces: [firstSpace]
        )
      }
      await flushPinnedTabCatalogObservation()

      #expect(host.spaces.map(\.id) == [firstSpace.id])
      #expect(sharedPinnedTabCatalog.spaces.isEmpty)
    }
  }

  @Test
  func restorationSnapshotExcludesPinnedTabsAndRestoreUsesSharedCatalog() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
      initializeGhosttyForTests()
    } operation: {
      let host = TerminalHostState()
      host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

      let pinnedTabID = try #require(host.selectedTabID)
      host.handleCommand(.togglePinned(pinnedTabID))
      host.handleCommand(.createTab(inheritingFromSurfaceID: nil))

      let selectedSpaceID = try #require(host.selectedSpaceID)
      let snapshot = host.restorationSnapshot()

      #expect(snapshot.spaces.first(where: { $0.id == selectedSpaceID })?.tabs.count == 1)
      #expect(snapshot.spaces.flatMap(\.tabs).allSatisfy { !$0.isPinned })

      let restored = TerminalHostState()
      #expect(restored.restore(from: snapshot))
      #expect(restored.spaceManager.tabs(in: selectedSpaceID).map(\.isPinned) == [true, false])
      #expect(restored.spaceManager.tabs(in: selectedSpaceID).map(\.id).contains(pinnedTabID))
    }
  }

  @Test
  func restorationSnapshotRestoresSelectedPinnedTab() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
      initializeGhosttyForTests()
    } operation: {
      let host = TerminalHostState()
      host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

      let pinnedTabID = try #require(host.selectedTabID)
      host.handleCommand(.togglePinned(pinnedTabID))
      host.handleCommand(.createTab(inheritingFromSurfaceID: nil))
      host.handleCommand(.selectTab(pinnedTabID))

      let selectedSpaceID = try #require(host.selectedSpaceID)
      let snapshot = host.restorationSnapshot()
      let snapshotSpace = try #require(snapshot.spaces.first { $0.id == selectedSpaceID })

      #expect(snapshotSpace.selectedPinnedTabID == pinnedTabID)
      #expect(snapshotSpace.selectedTabIndex == nil)

      let restored = TerminalHostState()
      #expect(restored.restore(from: snapshot))
      #expect(restored.selectedTabID == pinnedTabID)
      #expect(restored.spaceManager.tabs(in: selectedSpaceID).map(\.isPinned) == [true, false])
      #expect(restored.spaceManager.tabs(in: selectedSpaceID).first?.id == pinnedTabID)
    }
  }

  private func flushPinnedTabCatalogObservation() async {
    for _ in 0..<5 {
      await Task.yield()
    }
  }

  private func waitForSurfaceReplacement(
    in host: TerminalHostState,
    tabID: TerminalTabID,
    replacing exitedSurface: GhosttySurfaceView
  ) async throws -> [GhosttySurfaceView] {
    for _ in 0..<40 {
      let currentSurfaces = try #require(host.trees[tabID]?.leaves())
      if currentSurfaces.first !== exitedSurface {
        return currentSurfaces
      }
      try await Task.sleep(for: .milliseconds(25))
    }
    return try #require(host.trees[tabID]?.leaves())
  }

  private func waitForKilledSurface(_ surfaceID: UUID, in killedSurfaceIDs: LockIsolated<[UUID]>) async -> Bool {
    for _ in 0..<40 {
      if killedSurfaceIDs.value.contains(surfaceID) {
        return true
      }
      try? await Task.sleep(for: .milliseconds(25))
    }
    return killedSurfaceIDs.value.contains(surfaceID)
  }

  private func makeIdleZmxExecutable() throws -> URL {
    let directory = try makeCommandExecutionTemporaryDirectory()
    let url = directory.appendingPathComponent("zmx", isDirectory: false)
    try writeExecutable(
      at: url,
      script: """
        #!/bin/sh
        trap 'exit 0' HUP INT TERM
        while true; do
          sleep 1 &
          wait $!
        done
        """
    )
    return url
  }
}

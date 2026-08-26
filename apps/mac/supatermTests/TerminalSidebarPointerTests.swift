import AppKit
import ComposableArchitecture
import GhosttyKit
import Sharing
import SupaTheme
import SwiftUI
import Testing

@testable import supaterm

@MainActor
struct TerminalSidebarPointerTests {
  private final class PointerEvents {
    var mouseUpEventNumbers: [Int] = []
  }

  private struct Fixture {
    let firstTabID: TerminalTabID
    let secondTabID: TerminalTabID
    let secondTab: TerminalTabItem
    let terminal: TerminalHostState
    let selectionState: TerminalSidebarTabSelectionState
    let outline: TerminalSidebarOutline
    let context: TerminalSidebarRowContext
    let item: TerminalSidebarCollectionItem
    let pointerEvents: PointerEvents
    let window: NSWindow
    let location: NSPoint
  }

  @Test
  func unassignedHeaderOwnsItsClickAndTogglesCollapse() async throws {
    let terminal = TerminalHostState(managesTerminalSurfaces: false)
    let tabID = terminal.spaceManager.tabCollection.createTab(title: "Unassigned")
    let outline = TerminalSidebarOutline(
      roots: [
        TerminalSidebarOutline.Root(content: .unassigned([tabID]), isPinned: false)
      ],
      collapsedProjectIDs: [],
      topologyRevision: 1,
      spaceID: terminal.displayedSpaceID
    )
    let controller = TerminalSidebarListController(
      windowControllerID: UUID(),
      tabDragRegistry: TerminalTabDragRegistry(),
      captureRequest: { nil }
    )
    controller.view.frame = NSRect(x: 0, y: 0, width: 240, height: 160)
    let window = NSWindow(
      contentRect: controller.view.frame,
      styleMask: .borderless,
      backing: .buffered,
      defer: false
    )
    window.contentViewController = controller
    defer { window.contentViewController = nil }
    var collapseCount = 0
    let actions = TerminalSidebarRowActions(
      toggleProjectCollapsed: { _ in },
      toggleUnassignedCollapsed: { collapseCount += 1 },
      createTabInProject: { _ in },
      renameProject: { _, _ in false },
      setProjectColor: { _, _ in },
      toggleProjectPinned: { _ in },
      unproject: { _ in },
      closeProject: { _ in },
      newTab: {}
    )
    controller.apply(
      outline: outline,
      rows: [
        .unassigned: .unassigned(
          TerminalSidebarUnassignedRowPresentation(isCollapsed: false, tabCount: 1)
        ),
        .newTab: .newTab(.inline),
      ],
      context: TerminalSidebarRowContext(
        terminal: terminal,
        palette: Palette(colorScheme: .dark),
        renameState: controller.renameState,
        projectHeaderHoverState: controller.projectHeaderHoverState,
        tabSelectionState: controller.tabSelectionState,
        outline: outline,
        fixedHoveredProjectID: nil,
        actions: actions
      ),
      selectedTabID: tabID,
      reduceMotion: true
    )
    let scrollView = try #require(
      controller.view.subviews.compactMap { $0 as? TerminalSidebarScrollView }.first
    )
    let collectionView = try #require(scrollView.documentView as? TerminalSidebarCollectionView)
    for _ in 0..<5 { await Task.yield() }
    collectionView.layoutSubtreeIfNeeded()
    let attributes = try #require(
      collectionView.collectionViewLayout?.layoutAttributesForItem(
        at: IndexPath(item: 0, section: 0)
      )
    )
    let location = collectionView.convert(
      NSPoint(x: attributes.frame.midX, y: attributes.frame.midY),
      to: nil
    )
    let mouseDown = try #require(
      mouseEvent(.leftMouseDown, at: location, in: window, eventNumber: 1)
    )
    let mouseUp = try #require(
      mouseEvent(.leftMouseUp, at: location, in: window, eventNumber: 2)
    )

    #expect(collectionView.rowMouseDown(entryID: .unassigned, event: mouseDown))
    #expect(collectionView.rowMouseUp(entryID: .unassigned, event: mouseUp))
    #expect(collapseCount == 1)
  }

  @Test
  func optionClickMergesIntoTheSelectedTabAndClearsBatchSelection() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let space = TerminalSpaceItem(name: "Main")
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: space.id, spaces: [space])
      }
      let runtime = GhosttyRuntime()
      let terminal = TerminalHostState.test(
        runtime: runtime,
        spaceID: space.id,
        zmxClient: .noop,
        zmxSessionsEnabled: false
      )
      let sourceTabID = terminal.spaceManager.tabCollection.createTab(title: "Source")
      let destinationTabID = terminal.spaceManager.tabCollection.createTab(title: "Destination")
      let sourceSurface = unbackedSurface(runtime: runtime, tabID: sourceTabID)
      let destinationSurface = unbackedSurface(runtime: runtime, tabID: destinationTabID)
      terminal.trees[sourceTabID] = SplitTree(view: sourceSurface)
      terminal.trees[destinationTabID] = SplitTree(view: destinationSurface)
      terminal.surfaces[sourceSurface.id] = sourceSurface
      terminal.surfaces[destinationSurface.id] = destinationSurface
      terminal.focusHistoryByTab[sourceTabID] = TerminalHostState.FocusHistory(
        current: sourceSurface.id
      )
      terminal.focusHistoryByTab[destinationTabID] = TerminalHostState.FocusHistory(
        current: destinationSurface.id
      )
      terminal.applySelectedTab(destinationTabID, in: space.id)
      let outline = TerminalSidebarOutline(
        snapshot: terminal.spaceManager.displayedInstance.tabSurfaceSnapshot,
        projects: terminal.projects
      )
      let controller = TerminalSidebarListController(
        windowControllerID: UUID(),
        tabDragRegistry: TerminalTabDragRegistry(),
        captureRequest: { nil }
      )
      controller.view.frame = NSRect(x: 0, y: 0, width: 240, height: 160)
      var rows = Dictionary(
        uniqueKeysWithValues: terminal.tabs.map {
          (
            TerminalSidebarEntryID.tab($0.id),
            TerminalSidebarRowPresentation.tab(presentation($0))
          )
        }
      )
      rows[.newTab] = .newTab(.inline)
      let context = TerminalSidebarRowContext(
        terminal: terminal,
        palette: Palette(colorScheme: .dark),
        renameState: controller.renameState,
        projectHeaderHoverState: controller.projectHeaderHoverState,
        tabSelectionState: controller.tabSelectionState,
        outline: outline,
        fixedHoveredProjectID: nil,
        actions: rowActions
      )
      controller.apply(
        outline: outline,
        rows: rows,
        context: context,
        selectedTabID: destinationTabID,
        reduceMotion: true
      )
      controller.tabSelectionState.toggle(sourceTabID, primaryTabID: destinationTabID)
      let scrollView = try #require(
        controller.view.subviews.compactMap { $0 as? TerminalSidebarScrollView }.first
      )
      let collectionView = try #require(
        scrollView.documentView as? TerminalSidebarCollectionView
      )
      let event = try #require(
        NSEvent.mouseEvent(
          with: .leftMouseDown,
          location: .zero,
          modifierFlags: .option,
          timestamp: ProcessInfo.processInfo.systemUptime,
          windowNumber: 0,
          context: nil,
          eventNumber: 1,
          clickCount: 1,
          pressure: 1
        )
      )

      #expect(collectionView.rowMouseDown(entryID: .tab(sourceTabID), event: event))

      #expect(terminal.tabs.map(\.id) == [destinationTabID])
      #expect(
        terminal.trees[destinationTabID]?.leaves().map(\.id) == [
          destinationSurface.id,
          sourceSurface.id,
        ])
      #expect(controller.tabSelectionState.secondaryTabIDs.isEmpty)
    }
  }

  @Test
  func tabRowOwnsClickAndDragSequencesAtTrailingEdge() async throws {
    let fixture = try await fixture()
    defer {
      fixture.window.contentView = nil
      fixture.window.orderOut(nil)
    }

    try sendClick(
      at: fixture.location,
      in: fixture.window,
      eventNumbers: (41, 42),
      modifiers: .command
    )
    for _ in 0..<5 { await Task.yield() }
    #expect(fixture.terminal.selectedTabID == fixture.secondTabID)
    #expect(
      fixture.selectionState.orderedTabIDs(
        primaryTabID: fixture.secondTabID,
        outline: fixture.outline
      ) == [fixture.firstTabID, fixture.secondTabID]
    )

    try sendClick(
      at: fixture.location,
      in: fixture.window,
      eventNumbers: (43, 44)
    )
    for _ in 0..<5 { await Task.yield() }
    #expect(fixture.terminal.selectedTabID == fixture.firstTabID)

    let dragMouseDown = try #require(
      mouseEvent(.leftMouseDown, at: fixture.location, in: fixture.window, eventNumber: 45)
    )
    let mouseDragged = try #require(
      mouseEvent(
        .leftMouseDragged,
        at: NSPoint(x: fixture.location.x - 8, y: fixture.location.y),
        in: fixture.window,
        eventNumber: 46
      )
    )
    let dragMouseUp = try #require(
      mouseEvent(.leftMouseUp, at: fixture.location, in: fixture.window, eventNumber: 47)
    )
    NSApp.sendEvent(dragMouseDown)
    NSApp.sendEvent(mouseDragged)
    NSApp.sendEvent(dragMouseUp)
    #expect(fixture.pointerEvents.mouseUpEventNumbers == [42, 44])
  }

  @Test
  func tabRowPressClearsWhenDraggingStarts() throws {
    let collectionView = TerminalSidebarCollectionView(
      frame: NSRect(x: 0, y: 0, width: 240, height: 60)
    )
    let tabID = TerminalTabID(rawValue: UUID())
    let entryID = TerminalSidebarEntryID.tab(tabID)
    var pressedStates: [Bool] = []
    collectionView.onRowMouseDown = { id, _ in id == entryID }
    collectionView.onRowMouseDragged = { id, _ in id == entryID }
    let pointer = TerminalSidebarRowPointerNSView(entryID: entryID) {
      pressedStates.append($0)
    }
    pointer.frame = collectionView.bounds
    collectionView.addSubview(pointer)
    let window = NSWindow(
      contentRect: collectionView.frame,
      styleMask: .borderless,
      backing: .buffered,
      defer: false
    )
    window.contentView = collectionView
    defer { window.contentView = nil }

    let mouseDown = try #require(
      mouseEvent(.leftMouseDown, at: .zero, in: window, eventNumber: 1)
    )
    let mouseDragged = try #require(
      mouseEvent(.leftMouseDragged, at: NSPoint(x: 8, y: 0), in: window, eventNumber: 2)
    )

    pointer.mouseDown(with: mouseDown)
    #expect(pressedStates == [true])
    pointer.mouseDragged(with: mouseDragged)
    #expect(pressedStates == [true, false])
  }

  @Test
  func tabRowKeepsMouseUpAfterDragActivationFails() throws {
    let collectionView = TerminalSidebarCollectionView(
      frame: NSRect(x: 0, y: 0, width: 240, height: 60)
    )
    let entryID = TerminalSidebarEntryID.tab(TerminalTabID())
    var pressedStates: [Bool] = []
    var mouseUpCount = 0
    collectionView.onRowMouseDown = { id, _ in id == entryID }
    collectionView.onRowMouseDragged = { _, _ in false }
    collectionView.onRowMouseUp = { id, _ in
      mouseUpCount += 1
      return id == entryID
    }
    let pointer = TerminalSidebarRowPointerNSView(entryID: entryID) {
      pressedStates.append($0)
    }
    pointer.frame = collectionView.bounds
    collectionView.addSubview(pointer)
    let window = NSWindow(
      contentRect: collectionView.frame,
      styleMask: .borderless,
      backing: .buffered,
      defer: false
    )
    window.contentView = collectionView
    defer { window.contentView = nil }
    let mouseDown = try #require(
      mouseEvent(.leftMouseDown, at: .zero, in: window, eventNumber: 1)
    )
    let mouseDragged = try #require(
      mouseEvent(.leftMouseDragged, at: NSPoint(x: 8, y: 0), in: window, eventNumber: 2)
    )
    let mouseUp = try #require(
      mouseEvent(.leftMouseUp, at: NSPoint(x: 8, y: 0), in: window, eventNumber: 3)
    )

    pointer.mouseDown(with: mouseDown)
    pointer.mouseDragged(with: mouseDragged)
    #expect(pressedStates == [true])
    pointer.mouseUp(with: mouseUp)
    #expect(pressedStates == [true, false])
    #expect(mouseUpCount == 1)
  }

  @Test
  func nativeDragActivationEndsRowPointerTracking() throws {
    let collectionView = TerminalSidebarCollectionView(
      frame: NSRect(x: 0, y: 0, width: 240, height: 60)
    )
    let entryID = TerminalSidebarEntryID.tab(TerminalTabID())
    var pressedStates: [Bool] = []
    var mouseUpCount = 0
    collectionView.onRowMouseDown = { id, _ in id == entryID }
    collectionView.onRowMouseUp = { _, _ in
      mouseUpCount += 1
      return true
    }
    let pointer = TerminalSidebarRowPointerNSView(entryID: entryID) {
      pressedStates.append($0)
    }
    pointer.frame = collectionView.bounds
    collectionView.addSubview(pointer)
    let window = NSWindow(
      contentRect: collectionView.frame,
      styleMask: .borderless,
      backing: .buffered,
      defer: false
    )
    window.contentView = collectionView
    defer { window.contentView = nil }
    let mouseDown = try #require(
      mouseEvent(.leftMouseDown, at: .zero, in: window, eventNumber: 1)
    )
    let mouseUp = try #require(
      mouseEvent(.leftMouseUp, at: .zero, in: window, eventNumber: 2)
    )

    pointer.mouseDown(with: mouseDown)
    collectionView.finishTrackingRowPointer(entryID: entryID)
    pointer.mouseUp(with: mouseUp)

    #expect(pressedStates == [true, false])
    #expect(mouseUpCount == 0)
  }

  @Test
  func liftedRowCannotBeReboundThroughItsCollectionItem() async throws {
    let fixture = try await fixture()
    defer {
      fixture.window.contentView = nil
      fixture.window.orderOut(nil)
    }
    let lifted = try #require(
      fixture.item.liftHostedView(sourceFrame: fixture.item.view.frame)
    )
    let preview = try #require(
      lifted.hostedView as? NSHostingView<TerminalSidebarHostedRow>
    )
    let previewPresentation = preview.rootView.presentation

    fixture.item.host(
      entryID: .tab(fixture.secondTabID),
      TerminalSidebarHostedRow(
        presentation: .tab(presentation(fixture.secondTab)),
        context: fixture.context
      )
    )

    #expect(fixture.item.entryID == .tab(fixture.secondTabID))
    #expect(fixture.item.view.subviews.first !== preview)
    #expect(preview.rootView.presentation == previewPresentation)
  }

  @Test
  func restoringLiftedRowKeepsTheFreshHostLiftable() async throws {
    let fixture = try await fixture()
    defer {
      fixture.window.contentView = nil
      fixture.window.orderOut(nil)
    }
    let entryID = try #require(fixture.item.entryID)
    let lifted = try #require(
      fixture.item.liftHostedView(sourceFrame: fixture.item.view.frame)
    )
    let preview = try #require(
      lifted.hostedView as? NSHostingView<TerminalSidebarHostedRow>
    )

    fixture.item.host(entryID: entryID, preview.rootView)
    let freshHost = try #require(fixture.item.view.subviews.first)
    lifted.restore()

    #expect(fixture.item.view.subviews.first === freshHost)
    #expect(freshHost !== preview)
    let freshLift = try #require(
      fixture.item.liftHostedView(sourceFrame: fixture.item.view.frame)
    )
    lifted.restore()
    #expect(fixture.item.view.subviews.isEmpty)
    freshLift.restore()
    #expect(fixture.item.view.subviews.first === freshHost)
    #expect(fixture.item.liftHostedView(sourceFrame: fixture.item.view.frame) != nil)
  }

  private func fixture() async throws -> Fixture {
    let host = TerminalHostState.test(managesTerminalSurfaces: false)
    let manager = host.spaceManager.tabCollection
    let firstTabID = manager.createTab(title: "First")
    let secondTabID = manager.createTab(title: "Second")
    manager.selectTab(secondTabID)
    let firstTab = try #require(host.tabs.first { $0.id == firstTabID })
    let secondTab = try #require(host.tabs.first { $0.id == secondTabID })
    let outline = TerminalSidebarOutline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .unassigned([firstTabID, secondTabID]),
          isPinned: false
        )
      ],
      collapsedProjectIDs: [],
      topologyRevision: 1,
      spaceID: TerminalSidebarTestFixture.primarySpaceID
    )
    let selectionState = TerminalSidebarTabSelectionState()
    let collectionView = TerminalSidebarCollectionView(
      frame: NSRect(x: 0, y: 0, width: 240, height: 100)
    )
    collectionView.onRowMouseDown = { entryID, event in
      guard entryID == .tab(firstTabID) else { return false }
      if event.modifierFlags.contains(.command) {
        selectionState.toggle(firstTabID, primaryTabID: secondTabID)
      } else {
        selectionState.clear()
        host.selectTab(firstTabID)
      }
      return true
    }
    let pointerEvents = PointerEvents()
    collectionView.onRowMouseDragged = { entryID, event in
      entryID == .tab(firstTabID) && event.eventNumber == 46
    }
    collectionView.onRowMouseUp = { entryID, event in
      pointerEvents.mouseUpEventNumbers.append(event.eventNumber)
      return entryID == .tab(firstTabID)
    }
    let item = TerminalSidebarCollectionItem()
    let rowContext = TerminalSidebarRowContext(
      terminal: host,
      palette: Palette(colorScheme: .dark),
      renameState: TerminalSidebarRenameState(),
      projectHeaderHoverState: TerminalSidebarProjectHoverState(),
      tabSelectionState: selectionState,
      outline: outline,
      fixedHoveredProjectID: nil,
      actions: rowActions
    )
    item.host(
      entryID: .tab(firstTabID),
      TerminalSidebarHostedRow(
        presentation: .tab(presentation(firstTab)),
        context: rowContext
      )
    )
    item.view.frame = NSRect(x: 0, y: 0, width: 240, height: 60)
    collectionView.isSelectable = false
    collectionView.addSubview(item.view)
    let window = NSWindow(
      contentRect: collectionView.frame,
      styleMask: [.titled],
      backing: .buffered,
      defer: false
    )
    window.contentView = collectionView
    window.makeKeyAndOrderFront(nil)
    try await Task.sleep(for: .milliseconds(100))
    item.view.layoutSubtreeIfNeeded()
    let hostedView = try #require(item.view.subviews.first)
    let location = hostedView.convert(
      NSPoint(x: hostedView.bounds.maxX - 1, y: hostedView.bounds.midY),
      to: nil
    )
    return Fixture(
      firstTabID: firstTabID,
      secondTabID: secondTabID,
      secondTab: secondTab,
      terminal: host,
      selectionState: selectionState,
      outline: outline,
      context: rowContext,
      item: item,
      pointerEvents: pointerEvents,
      window: window,
      location: location
    )
  }

  private func presentation(_ tab: TerminalTabItem) -> TerminalSidebarTabRowPresentation {
    TerminalSidebarTabRowPresentation(
      tab: tab,
      projectID: nil,
      rootIsPinned: false,
      agentStatus: nil,
      details: [],
      unreadCount: 0,
      terminalProgress: nil,
      hasTerminalBell: false,
      shortcutHint: nil,
      showsShortcutHint: false
    )
  }

  private func unbackedSurface(
    runtime: GhosttyRuntime,
    tabID: TerminalTabID
  ) -> GhosttySurfaceView {
    GhosttySurfaceView(
      runtime: runtime,
      tabID: tabID.rawValue,
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      surfaceFactory: { _, _ in nil }
    )
  }

  private var rowActions: TerminalSidebarRowActions {
    TerminalSidebarRowActions(
      toggleProjectCollapsed: { _ in },
      toggleUnassignedCollapsed: {},
      createTabInProject: { _ in },
      renameProject: { _, _ in false },
      setProjectColor: { _, _ in },
      toggleProjectPinned: { _ in },
      unproject: { _ in },
      closeProject: { _ in },
      newTab: {}
    )
  }

  private func mouseEvent(
    _ type: NSEvent.EventType,
    at location: NSPoint,
    in window: NSWindow?,
    eventNumber: Int,
    modifiers: NSEvent.ModifierFlags = []
  ) -> NSEvent? {
    NSEvent.mouseEvent(
      with: type,
      location: location,
      modifierFlags: modifiers,
      timestamp: ProcessInfo.processInfo.systemUptime,
      windowNumber: window?.windowNumber ?? 0,
      context: nil,
      eventNumber: eventNumber,
      clickCount: 1,
      pressure: type == .leftMouseDown ? 1 : 0
    )
  }

  private func sendClick(
    at location: NSPoint,
    in window: NSWindow,
    eventNumbers: (down: Int, up: Int),
    modifiers: NSEvent.ModifierFlags = []
  ) throws {
    let mouseDown = try #require(
      mouseEvent(
        .leftMouseDown,
        at: location,
        in: window,
        eventNumber: eventNumbers.down,
        modifiers: modifiers
      )
    )
    let mouseUp = try #require(
      mouseEvent(
        .leftMouseUp,
        at: location,
        in: window,
        eventNumber: eventNumbers.up,
        modifiers: modifiers
      )
    )
    NSApp.sendEvent(mouseDown)
    NSApp.sendEvent(mouseUp)
  }
}

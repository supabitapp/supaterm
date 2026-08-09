import AppKit
import ComposableArchitecture
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
    let recorder: TerminalCommandRecorder
    let selectionState: TerminalSidebarTabSelectionState
    let outline: TerminalSidebarOutline
    let context: TerminalSidebarRowContext
    let item: TerminalSidebarCollectionItem
    let pointerEvents: PointerEvents
    let window: NSWindow
    let location: NSPoint
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
    #expect(fixture.recorder.commands.isEmpty)
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
    #expect(fixture.recorder.commands == [.selectTab(fixture.firstTabID)])

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
    let host = TerminalHostState(managesTerminalSurfaces: false)
    let manager = host.spaceManager.tabCollection
    let firstTabID = manager.createTab(title: "First")
    let secondTabID = manager.createTab(title: "Second")
    manager.selectTab(secondTabID)
    let firstTab = try #require(host.tabs.first { $0.id == firstTabID })
    let secondTab = try #require(host.tabs.first { $0.id == secondTabID })
    let recorder = TerminalCommandRecorder()
    let store = Store(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalClient.send = { recorder.record($0) }
    }
    let outline = TerminalSidebarOutline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(firstTabID), isPinned: false),
        TerminalSidebarOutline.Root(content: .tab(secondTabID), isPinned: false),
      ],
      collapsedGroupIDs: [],
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
        _ = store.send(.tabSelected(firstTabID))
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
      store: store,
      terminal: host,
      palette: Palette(colorScheme: .dark),
      renameState: TerminalSidebarRenameState(),
      groupHeaderHoverState: TerminalSidebarGroupHoverState(),
      tabSelectionState: selectionState,
      outline: outline,
      fixedHoveredGroupID: nil,
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
      recorder: recorder,
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
      groupID: nil,
      rootIsPinned: false,
      notificationPresentation: nil,
      paneWorkingDirectories: [],
      unreadCount: 0,
      terminalProgress: nil,
      hasTerminalBell: false,
      showsAgentSpinner: false,
      shortcutHint: nil,
      showsShortcutHint: false
    )
  }

  private var rowActions: TerminalSidebarRowActions {
    TerminalSidebarRowActions(
      toggleGroupCollapsed: { _ in },
      createTabInGroup: { _ in },
      renameGroup: { _, _ in false },
      setGroupColor: { _, _ in },
      toggleGroupPinned: { _ in },
      ungroup: { _ in },
      closeGroup: { _ in },
      newTab: {}
    )
  }

  private func mouseEvent(
    _ type: NSEvent.EventType,
    at location: NSPoint,
    in window: NSWindow,
    eventNumber: Int,
    modifiers: NSEvent.ModifierFlags = []
  ) -> NSEvent? {
    NSEvent.mouseEvent(
      with: type,
      location: location,
      modifierFlags: modifiers,
      timestamp: ProcessInfo.processInfo.systemUptime,
      windowNumber: window.windowNumber,
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

import AppKit
import SwiftUI
import Testing

@testable import supaterm

@MainActor
struct TerminalSidebarMenuTrackingTests {
  @Test
  func controllerCoalescesVisibleRowRefreshesWhileMenuTracks() throws {
    let fixture = try fixture()
    defer { fixture.harness.close() }
    let menu = NSMenu()
    let firstUpdate = TerminalHostState.test(managesTerminalSurfaces: false)
    let latestUpdate = TerminalHostState.test(managesTerminalSurfaces: false)

    post(NSMenu.didBeginTrackingNotification, menu: menu)
    fixture.harness.apply(
      outline: fixture.outline,
      rows: [.newTab: .newTab(.pinned)],
      terminal: firstUpdate,
      selectedTabID: nil,
      reduceMotion: true
    )
    fixture.harness.apply(
      outline: fixture.outline,
      rows: [.newTab: .pinDivider],
      terminal: latestUpdate,
      selectedTabID: nil,
      reduceMotion: true
    )

    #expect(try hostedRow(in: fixture.harness).presentation == .newTab(.inline))

    post(NSMenu.didEndTrackingNotification, menu: menu)

    let row = try hostedRow(in: fixture.harness)
    #expect(row.presentation == .pinDivider)
    #expect(row.context.terminal === latestUpdate)
  }

  @Test
  func controllerWaitsForParentAndChildMenusToEndTracking() throws {
    let fixture = try fixture()
    defer { fixture.harness.close() }
    let parent = NSMenu()
    let child = NSMenu()
    let latestUpdate = TerminalHostState.test(managesTerminalSurfaces: false)

    post(NSMenu.didBeginTrackingNotification, menu: parent)
    post(NSMenu.didBeginTrackingNotification, menu: child)
    fixture.harness.apply(
      outline: fixture.outline,
      rows: [.newTab: .newTab(.pinned)],
      terminal: latestUpdate,
      selectedTabID: nil,
      reduceMotion: true
    )
    post(NSMenu.didEndTrackingNotification, menu: child)

    #expect(try hostedRow(in: fixture.harness).presentation == .newTab(.inline))

    post(NSMenu.didEndTrackingNotification, menu: parent)

    let row = try hostedRow(in: fixture.harness)
    #expect(row.presentation == .newTab(.pinned))
    #expect(row.context.terminal === latestUpdate)
  }

  private func fixture() throws -> (
    harness: TerminalSidebarWindowHarness,
    outline: TerminalSidebarOutline
  ) {
    let harness = try #require(
      TerminalSidebarWindowHarness(size: CGSize(width: 220, height: 160))
    )
    let outline = TerminalSidebarTestFixture.outline(roots: [], revision: 1)
    harness.window.orderFront(nil)
    harness.apply(
      outline: outline,
      rows: [.newTab: .newTab(.inline)],
      terminal: TerminalHostState.test(managesTerminalSurfaces: false),
      selectedTabID: nil,
      reduceMotion: true
    )
    harness.layoutNow()
    harness.collectionView.layoutSubtreeIfNeeded()
    return (harness, outline)
  }

  private func post(_ name: Notification.Name, menu: NSMenu) {
    NotificationCenter.default.post(name: name, object: menu)
  }

  private func hostedRow(
    in harness: TerminalSidebarWindowHarness
  ) throws -> TerminalSidebarHostedRow {
    let item = try #require(
      harness.collectionView.visibleItems()
        .compactMap { $0 as? TerminalSidebarCollectionItem }
        .first { $0.entryID == .newTab }
    )
    let container = try #require(item.view as? TerminalSidebarHostingContainerView)
    return try #require(
      (container.subviews.first as? NSHostingView<TerminalSidebarHostedRow>)?.rootView
    )
  }
}

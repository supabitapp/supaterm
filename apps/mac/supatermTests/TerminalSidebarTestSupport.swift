import AppKit
import Foundation
import SupaTheme
import SwiftUI

@testable import supaterm

enum TerminalSidebarTestFixture {
  static let primarySpaceID = TerminalSpaceID(
    rawValue: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!
  )
  static let secondarySpaceID = TerminalSpaceID(
    rawValue: UUID(uuidString: "22222222-2222-2222-2222-222222222222")!
  )

  static func outline(
    roots: [TerminalSidebarOutline.Root],
    revision: UInt64,
    spaceID: TerminalSpaceID = primarySpaceID,
    collapsedGroupIDs: Set<TerminalTabGroupID> = []
  ) -> TerminalSidebarOutline {
    TerminalSidebarOutline(
      roots: roots,
      collapsedGroupIDs: collapsedGroupIDs,
      topologyRevision: revision,
      spaceID: spaceID
    )
  }

  static func layoutPlan(
    outline: TerminalSidebarOutline,
    draggingItemIDs: [TerminalSidebarEntryID] = [],
    preferredHeights: [TerminalSidebarEntryID: CGFloat]? = nil,
    target: TerminalSidebarDropPlan? = nil,
    width: CGFloat = 220,
    viewportHeight: CGFloat = 300
  ) -> TerminalSidebarLayoutPlan {
    TerminalSidebarLayoutPlan(
      outline: outline,
      preferredHeights: preferredHeights
        ?? Dictionary(uniqueKeysWithValues: outline.visibleEntries.map { ($0.id, CGFloat(37)) }),
      dragDropState: draggingItemIDs.isEmpty
        ? nil
        : TerminalSidebarDragDropState(draggingItemIDs: draggingItemIDs, target: target),
      width: width,
      viewportHeight: viewportHeight
    )
  }

  static func payload(
    source: TerminalSidebarDragSource,
    revision: UInt64,
    operationID: TerminalTabMoveOperationID = TerminalTabMoveOperationID()
  ) -> TerminalSidebarDragPayload {
    TerminalSidebarDragPayload(
      operationID: operationID,
      source: source,
      topologyStamp: TerminalSidebarTopologyStamp(
        spaceID: primarySpaceID,
        revision: revision
      )
    )
  }

  static func moveReceipt(
    payload: TerminalSidebarDragPayload,
    destination: TerminalTabPlacement,
    revision: UInt64,
    deletedEmptyGroupIDs: [TerminalTabGroupID] = []
  ) -> TerminalSidebarDropReceipt {
    TerminalSidebarDropReceipt(
      spaceID: payload.topologyStamp.spaceID,
      result: TerminalTabMoveResult(
        operationID: payload.operationID,
        itemIDs: payload.source.itemIDs,
        location: destination,
        deletedEmptyGroupIDs: deletedEmptyGroupIDs,
        topologyRevision: revision
      )
    )
  }

  static func completedCoordinator(
    source: TerminalSidebarDragSource,
    sourceRevision: UInt64,
    receiptRevision: UInt64,
    destination: TerminalTabPlacement
  ) -> TerminalSidebarDragCoordinator {
    let payload = payload(source: source, revision: sourceRevision)
    let dropDestination: TerminalSidebarDropDestination
    switch destination {
    case .root(let placement):
      dropDestination = .root(isPinned: placement.isPinned, index: placement.index)
    case .group(let groupID, let index):
      dropDestination = .group(groupID, index: index)
    }
    var coordinator = TerminalSidebarDragCoordinator(payload: payload)
    let plan = TerminalSidebarDropPlan(
      path: .trailingRoot,
      destination: dropDestination,
      placeholder: .beforeFooter
    )
    precondition(coordinator.freeze(plan) != nil)
    precondition(
      coordinator.complete(
        moveReceipt(
          payload: payload,
          destination: destination,
          revision: receiptRevision
        )
      )
    )
    return coordinator
  }
}

@MainActor
final class TerminalSidebarWindowHarness {
  let controller: TerminalSidebarListController
  let window: NSWindow
  let scrollView: TerminalSidebarScrollView
  let collectionView: TerminalSidebarCollectionView
  let layout: TerminalSidebarCollectionLayout

  init?(size: CGSize) {
    let controller = TerminalSidebarListController(
      windowControllerID: UUID(),
      tabDragRegistry: TerminalTabDragRegistry(),
      captureRequest: { nil }
    )
    let window = NSWindow(
      contentRect: CGRect(origin: .zero, size: size),
      styleMask: .borderless,
      backing: .buffered,
      defer: false
    )
    window.contentView = controller.view
    guard
      let scrollView = controller.view.subviews.compactMap({ $0 as? TerminalSidebarScrollView }).first,
      let collectionView = scrollView.documentView as? TerminalSidebarCollectionView,
      let layout = collectionView.collectionViewLayout as? TerminalSidebarCollectionLayout
    else {
      window.contentView = nil
      return nil
    }
    self.controller = controller
    self.window = window
    self.scrollView = scrollView
    self.collectionView = collectionView
    self.layout = layout
  }

  func apply(
    outline: TerminalSidebarOutline,
    rows: [TerminalSidebarEntryID: TerminalSidebarRowPresentation],
    terminal: TerminalHostState,
    selectedTabID: TerminalTabID?,
    reduceMotion: Bool
  ) {
    controller.apply(
      outline: outline,
      rows: rows,
      context: TerminalSidebarRowContext(
        terminal: terminal,
        palette: Palette(colorScheme: .dark),
        renameState: controller.renameState,
        groupHeaderHoverState: controller.groupHeaderHoverState,
        tabSelectionState: controller.tabSelectionState,
        outline: outline,
        fixedHoveredGroupID: nil,
        actions: Self.rowActions
      ),
      selectedTabID: selectedTabID,
      reduceMotion: reduceMotion
    )
  }

  func layoutNow() {
    controller.view.layoutSubtreeIfNeeded()
  }

  func resize(to size: CGSize) {
    controller.view.setFrameSize(size)
    controller.viewWillLayout()
    scrollView.layoutSubtreeIfNeeded()
    collectionView.layoutSubtreeIfNeeded()
    controller.viewDidLayout()
  }

  func close() {
    window.contentView = nil
  }

  var realizedIdentifiers: [TerminalSidebarEntryID] {
    (0..<collectionView.numberOfItems(inSection: 0)).compactMap {
      (collectionView.item(at: IndexPath(item: $0, section: 0))
        as? TerminalSidebarCollectionItem)?.entryID
    }
  }

  private static var rowActions: TerminalSidebarRowActions {
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
}

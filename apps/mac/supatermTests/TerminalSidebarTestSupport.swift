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
    collapsedProjectIDs: Set<TerminalProjectID> = [],
    pinnedTabIDs: Set<TerminalTabID> = []
  ) -> TerminalSidebarOutline {
    TerminalSidebarOutline(
      roots: roots,
      collapsedProjectIDs: collapsedProjectIDs,
      pinnedTabIDs: pinnedTabIDs,
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
        : TerminalSidebarDragDropState(
          source: dragSource(for: draggingItemIDs),
          draggingItemIDs: draggingItemIDs,
          target: target
        ),
      width: width,
      viewportHeight: viewportHeight
    )
  }

  private static func dragSource(
    for entryIDs: [TerminalSidebarEntryID]
  ) -> TerminalSidebarDragSource {
    guard let first = entryIDs.first else { preconditionFailure("Missing drag source") }
    switch first {
    case .tab:
      let tabIDs = entryIDs.compactMap { entryID -> TerminalTabID? in
        guard case .tab(let id) = entryID else { return nil }
        return id
      }
      precondition(tabIDs.count == entryIDs.count)
      return .tabs(tabIDs)
    case .group(let id):
      return .group(id)
    case .pinDivider, .newTab:
      preconditionFailure("Invalid drag source")
    }
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
    revision: UInt64
  ) -> TerminalSidebarDropReceipt {
    TerminalSidebarDropReceipt(
      spaceID: payload.topologyStamp.spaceID,
      operationID: payload.operationID,
      itemIDs: payload.source.itemIDs,
      operation: .move(destination),
      topologyRevision: revision
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
    dropDestination =
      if let projectID = destination.projectID {
        .project(projectID, index: destination.index)
      } else {
        .root(isPinned: destination.isPinned, index: destination.index)
      }
    var coordinator = TerminalSidebarDragCoordinator(payload: payload)
    let plan = TerminalSidebarDropPlan(
      path: path,
      destination: dropDestination,
      placeholder: .beforeFooter,
      operation: .move(destination)
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
      let scrollView = controller.view.subviews.compactMap({ $0 as? TerminalSidebarScrollView })
        .first,
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

@preconcurrency import AppKit
import SupatermTerminalModels
import SwiftUI

@MainActor
final class TerminalSidebarDragSourceCoordinator: NSObject, NSDraggingSource {
  var item: TerminalSidebarDragItem
  var preview: TerminalSidebarDragPreviewItem
  var zoneID: TerminalSidebarDropZoneID
  var index: Int
  let manager: TerminalSidebarDragSession

  init(
    item: TerminalSidebarDragItem,
    preview: TerminalSidebarDragPreviewItem,
    zoneID: TerminalSidebarDropZoneID,
    index: Int,
    manager: TerminalSidebarDragSession
  ) {
    self.item = item
    self.preview = preview
    self.zoneID = zoneID
    self.index = index
    self.manager = manager
  }

  nonisolated func draggingSession(
    _ session: NSDraggingSession,
    sourceOperationMaskFor context: NSDraggingContext
  ) -> NSDragOperation {
    context == .withinApplication ? .move : []
  }

  nonisolated func draggingSession(
    _ session: NSDraggingSession,
    movedTo screenPoint: NSPoint
  ) {
    manager.updateCursorScreenPosition(screenPoint)
  }

  nonisolated func draggingSession(
    _ session: NSDraggingSession,
    endedAt screenPoint: NSPoint,
    operation: NSDragOperation
  ) {
    Task { @MainActor in
      manager.cancelDrag()
    }
  }
}

final class TerminalSidebarDragSourceNSView: NSView {
  var coordinator: TerminalSidebarDragSourceCoordinator?
  private(set) var registrationID: UUID?

  func registerWithManager() {
    guard let coordinator else { return }
    let registrationID = UUID()
    self.registrationID = registrationID
    coordinator.manager.registerDragSource(self, id: registrationID)
  }

  func unregisterFromManager() {
    guard let registrationID, let coordinator else { return }
    coordinator.manager.unregisterDragSource(id: registrationID)
    self.registrationID = nil
  }

  func initiateDrag(
    with event: NSEvent
  ) {
    guard let coordinator else { return }

    coordinator.manager.beginDrag(
      item: coordinator.item,
      preview: coordinator.preview,
      from: coordinator.zoneID,
      at: coordinator.index
    )

    let pasteboardItem = NSPasteboardItem()
    pasteboardItem.setString(coordinator.item.tabID.rawValue.uuidString, forType: .terminalSidebarTabItem)

    let transparentImage = NSImage(size: NSSize(width: 1, height: 1))
    let draggingItem = NSDraggingItem(pasteboardWriter: pasteboardItem)
    draggingItem.setDraggingFrame(
      NSRect(x: 0, y: 0, width: 1, height: 1),
      contents: transparentImage
    )

    beginDraggingSession(with: [draggingItem], event: event, source: coordinator)
  }
}

private struct TerminalSidebarDragSourceAnchor: NSViewRepresentable {
  let item: TerminalSidebarDragItem
  let preview: TerminalSidebarDragPreviewItem
  let zoneID: TerminalSidebarDropZoneID
  let index: Int
  let manager: TerminalSidebarDragSession

  func makeNSView(
    context: Context
  ) -> TerminalSidebarDragSourceNSView {
    let view = TerminalSidebarDragSourceNSView()
    view.coordinator = context.coordinator
    view.registerWithManager()
    return view
  }

  func updateNSView(
    _ nsView: TerminalSidebarDragSourceNSView,
    context: Context
  ) {
    context.coordinator.item = item
    context.coordinator.preview = preview
    context.coordinator.zoneID = zoneID
    context.coordinator.index = index
  }

  static func dismantleNSView(
    _ nsView: TerminalSidebarDragSourceNSView,
    coordinator: TerminalSidebarDragSourceCoordinator
  ) {
    nsView.unregisterFromManager()
  }

  func makeCoordinator() -> TerminalSidebarDragSourceCoordinator {
    TerminalSidebarDragSourceCoordinator(
      item: item,
      preview: preview,
      zoneID: zoneID,
      index: index,
      manager: manager
    )
  }
}

struct TerminalSidebarDragSourceView<Content: View>: View {
  let item: TerminalSidebarDragItem
  let preview: TerminalSidebarDragPreviewItem
  let zoneID: TerminalSidebarDropZoneID
  let index: Int
  let manager: TerminalSidebarDragSession
  @ViewBuilder let content: () -> Content

  var body: some View {
    content()
      .background(
        TerminalSidebarDragSourceAnchor(
          item: item,
          preview: preview,
          zoneID: zoneID,
          index: index,
          manager: manager
        )
      )
  }
}

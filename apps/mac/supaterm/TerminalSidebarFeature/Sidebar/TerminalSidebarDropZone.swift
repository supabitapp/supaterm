@preconcurrency import AppKit
import SwiftUI

@MainActor
final class TerminalSidebarDropZoneCoordinator: NSObject {
  var zoneID: TerminalSidebarDropZoneID
  let manager: TerminalSidebarDragSession

  init(
    zoneID: TerminalSidebarDropZoneID,
    manager: TerminalSidebarDragSession
  ) {
    self.zoneID = zoneID
    self.manager = manager
  }
}

final class TerminalSidebarDropZoneNSView: NSView {
  weak var coordinator: TerminalSidebarDropZoneCoordinator?

  override func layout() {
    super.layout()
    guard
      let coordinator,
      let window,
      let contentView = window.contentView
    else {
      return
    }

    let frameInWindow = convert(bounds, to: nil)
    let frameInScreen = window.convertToScreen(frameInWindow)
    let contentHeight = contentView.bounds.height
    let flipped = CGRect(
      x: frameInWindow.origin.x,
      y: contentHeight - frameInWindow.maxY,
      width: frameInWindow.width,
      height: frameInWindow.height
    )
    Task { @MainActor in
      coordinator.manager.updateZoneFrame(
        for: coordinator.zoneID,
        frame: flipped,
        screenFrame: frameInScreen
      )
    }
  }

  override func draggingEntered(
    _ sender: any NSDraggingInfo
  ) -> NSDragOperation {
    guard
      let coordinator,
      coordinator.manager.sourceZone != nil
    else {
      return []
    }

    Task { @MainActor in
      coordinator.manager.cursorEnteredZone(coordinator.zoneID)
    }
    updateInsertionIndex(sender)
    return .move
  }

  override func draggingUpdated(
    _ sender: any NSDraggingInfo
  ) -> NSDragOperation {
    guard
      let coordinator,
      coordinator.manager.sourceZone != nil
    else {
      return []
    }

    updateInsertionIndex(sender)
    return .move
  }

  override func draggingExited(
    _ sender: (any NSDraggingInfo)?
  ) {
    guard let coordinator else { return }
    Task { @MainActor in
      coordinator.manager.cursorExitedZone(coordinator.zoneID)
    }
  }

  override func performDragOperation(
    _ sender: any NSDraggingInfo
  ) -> Bool {
    guard
      let coordinator,
      coordinator.manager.sourceZone != nil
    else {
      return false
    }

    MainActor.assumeIsolated {
      coordinator.manager.completeDropIfPossible(in: coordinator.zoneID)
    }
    return true
  }

  private func updateInsertionIndex(
    _ sender: NSDraggingInfo
  ) {
    guard let coordinator else { return }
    let localPoint = convert(sender.draggingLocation, from: nil)
    let flippedPoint = CGPoint(
      x: localPoint.x,
      y: bounds.height - localPoint.y
    )
    Task { @MainActor in
      coordinator.manager.updateInsertionIndex(
        for: coordinator.zoneID,
        localPoint: flippedPoint
      )
    }
  }
}

private struct TerminalSidebarDropZoneAnchor: NSViewRepresentable {
  let zoneID: TerminalSidebarDropZoneID
  let manager: TerminalSidebarDragSession

  func makeNSView(
    context: Context
  ) -> TerminalSidebarDropZoneNSView {
    let view = TerminalSidebarDropZoneNSView()
    view.coordinator = context.coordinator
    view.registerForDraggedTypes([.terminalSidebarTabItem])
    return view
  }

  func updateNSView(
    _ nsView: TerminalSidebarDropZoneNSView,
    context: Context
  ) {
    context.coordinator.zoneID = zoneID
  }

  func makeCoordinator() -> TerminalSidebarDropZoneCoordinator {
    TerminalSidebarDropZoneCoordinator(
      zoneID: zoneID,
      manager: manager
    )
  }
}

struct TerminalSidebarDropZoneHostView<Content: View>: View {
  let zoneID: TerminalSidebarDropZoneID
  let manager: TerminalSidebarDragSession
  @ViewBuilder let content: () -> Content

  var body: some View {
    content()
      .background(
        TerminalSidebarDropZoneAnchor(
          zoneID: zoneID,
          manager: manager
        )
      )
  }
}

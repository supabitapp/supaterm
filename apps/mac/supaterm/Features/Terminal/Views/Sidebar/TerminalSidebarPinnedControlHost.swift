import AppKit

@MainActor
final class TerminalSidebarPinnedControlHost {
  let view = TerminalSidebarPinnedControlView(frame: .zero)

  var height: CGFloat {
    view.isHidden ? 0 : TerminalSidebarLayout.pinnedControlHeight
  }

  var isPinned: Bool { !view.isHidden }

  init(
    draggingUpdated: @escaping (any NSDraggingInfo) -> NSDragOperation,
    draggingExited: @escaping () -> Void,
    draggingEnded: @escaping () -> Void,
    prepareForDragOperation: @escaping (any NSDraggingInfo) -> Bool,
    performDragOperation: @escaping (any NSDraggingInfo) -> Bool
  ) {
    view.isHidden = true
    view.onDraggingUpdated = draggingUpdated
    view.onDraggingExited = draggingExited
    view.onDraggingEnded = draggingEnded
    view.onPrepareForDragOperation = prepareForDragOperation
    view.onPerformDragOperation = performDragOperation
  }

  func update(context: TerminalSidebarRowContext) {
    view.host(
      entryID: .newTab,
      TerminalSidebarHostedRow(presentation: .newTab(.pinned), context: context)
    )
  }

  func setPinned(_ isPinned: Bool) -> Bool {
    guard self.isPinned != isPinned else { return false }
    view.isHidden = !isPinned
    return true
  }

  func layout(in frame: CGRect) {
    var resolvedFrame = frame
    if view.isHidden {
      resolvedFrame.size.height = view.frame.height
    }
    guard view.frame != resolvedFrame else { return }
    view.frame = resolvedFrame
  }
}

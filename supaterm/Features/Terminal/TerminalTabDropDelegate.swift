import SwiftUI

struct TerminalTabDropDelegate: DropDelegate {
  let targetTabID: UUID?
  let targetSectionIsPinned: Bool?
  @Binding var draggedTabID: UUID?
  let onMoveBefore: (UUID, UUID) -> Void
  let onMoveToSection: (UUID, Bool) -> Void
  let onDropEnded: () -> Void

  func dropEntered(info: DropInfo) {
    guard let draggedTabID else { return }

    if let targetTabID {
      onMoveBefore(draggedTabID, targetTabID)
    } else if let targetSectionIsPinned {
      onMoveToSection(draggedTabID, targetSectionIsPinned)
    }
  }

  func dropUpdated(info: DropInfo) -> DropProposal? {
    .init(operation: .move)
  }

  func performDrop(info: DropInfo) -> Bool {
    draggedTabID = nil
    onDropEnded()
    return true
  }
}

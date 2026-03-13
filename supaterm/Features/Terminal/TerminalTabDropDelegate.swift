import SwiftUI
import UniformTypeIdentifiers

struct TerminalTabDropDelegate: DropDelegate {
  let targetTabID: UUID?
  let targetSectionIsPinned: Bool?
  @Binding var draggedTabID: UUID?
  let onMoveBefore: (UUID, UUID) -> Void
  let onMoveToSection: (UUID, Bool) -> Void
  let onDropEnded: () -> Void

  func dropEntered(info: DropInfo) {
    guard let provider = info.itemProviders(for: [UTType.text]).first else { return }

    provider.loadObject(ofClass: NSString.self) { object, _ in
      guard
        let string = object as? String,
        let draggedTabID = UUID(uuidString: string)
      else { return }

      DispatchQueue.main.async {
        if let targetTabID {
          onMoveBefore(draggedTabID, targetTabID)
        } else if let targetSectionIsPinned {
          onMoveToSection(draggedTabID, targetSectionIsPinned)
        }
      }
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

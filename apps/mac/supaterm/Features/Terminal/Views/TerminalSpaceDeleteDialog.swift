import SupaTheme
import SwiftUI

struct TerminalSpaceDeleteDialog: View {
  let palette: Palette
  let spaceName: String
  let paneCount: Int
  let onConfirm: () -> Void
  let onCancel: () -> Void

  var body: some View {
    ConfirmationOverlay(
      palette: palette,
      title: "Delete Space \"\(spaceName)\"?",
      message: message,
      confirmTitle: "Delete",
      onConfirm: onConfirm,
      onCancel: onCancel
    )
  }

  private var message: String {
    guard paneCount > 0 else {
      return "This space has no open tabs."
    }
    let panes = paneCount == 1 ? "1 pane" : "\(paneCount) panes"
    return "Deleting it closes \(panes) across every window and ends their processes."
  }
}

import SupatermUI
import SwiftUI

struct RestoreKeyboardShortcutsDialog: View {
  let onRestore: () -> Void
  let onCancel: () -> Void

  var body: some View {
    DialogSurface(
      title: "Restore Keyboard Shortcuts?",
      message: "Restore all keyboard shortcuts to their defaults?",
      icon: .system("arrow.counterclockwise", tone: .warning),
      actions: [
        DialogSurfaceAction(
          id: "cancel",
          title: "Cancel",
          role: .secondary,
          shortcut: .cancel,
          accessibilityIdentifier: "dialog.cancel",
          action: onCancel
        ),
        DialogSurfaceAction(
          id: "restore",
          title: "Restore Defaults",
          role: .destructive,
          shortcut: .default,
          accessibilityIdentifier: "dialog.confirm",
          action: onRestore
        ),
      ],
      scrimLabel: "Cancel restoring keyboard shortcuts",
      onDismiss: onCancel
    )
  }
}

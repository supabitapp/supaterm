import SupaTheme
import SupatermUI
import SwiftUI

struct RestartToUpdateDialog: View {
  let palette: Palette
  let message: String
  let onRestart: () -> Void
  let onCancel: () -> Void

  var body: some View {
    DialogSurface(
      theme: .palette(palette),
      title: "Restart to Update?",
      message: message,
      icon: .application,
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
          id: "restart",
          title: "Restart Now",
          role: .primary,
          shortcut: .default,
          accessibilityIdentifier: "dialog.confirm",
          action: onRestart
        ),
      ],
      scrimLabel: "Cancel restart",
      onDismiss: onCancel
    )
  }
}

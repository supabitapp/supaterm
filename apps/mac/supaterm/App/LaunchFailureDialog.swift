import SupatermUI
import SwiftUI

struct LaunchFailureDialog: View {
  let title: String
  let message: String
  let onQuit: () -> Void

  var body: some View {
    DialogSurface(
      title: title,
      message: message,
      icon: .system("xmark.octagon.fill", tone: .danger),
      layout: DialogSurfaceLayout(width: 500),
      actions: [
        DialogSurfaceAction(
          id: "quit",
          title: "Quit",
          role: .primary,
          shortcut: .default,
          accessibilityIdentifier: "dialog.confirm",
          action: onQuit
        )
      ]
    )
  }
}

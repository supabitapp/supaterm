import SupatermUI
import SwiftUI

struct UpdateOwnershipEndedDialog: View {
  let phase: UpdatePhase
  let presentations: [UpdateActionPresentation]
  let onSelect: (UpdateUserAction) -> Void
  let onDismiss: () -> Void

  var body: some View {
    DialogSurface(
      title: phase.summaryText,
      message: phase.detailMessage,
      icon: .application,
      layout: DialogSurfaceLayout(width: 520),
      actions: presentations.reversed().map { presentation in
        DialogSurfaceAction(
          id: String(describing: presentation.action),
          title: presentation.title,
          role: presentation.isProminent ? .primary : .secondary,
          shortcut: presentation.isProminent
            ? .default
            : presentation.action == .dismiss ? .cancel : nil,
          accessibilityIdentifier: presentation.isProminent
            ? "dialog.confirm"
            : presentation.action == .dismiss ? "dialog.cancel" : nil
        ) {
          onSelect(presentation.action)
        }
      },
      onDismiss: onDismiss
    )
  }
}

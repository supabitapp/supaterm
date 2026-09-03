import AppKit
import Observation
import SupatermUI
import SwiftUI

@Observable
@MainActor
final class GhosttyClipboardConfirmationDialogState {
  var remember = false
}

struct GhosttyClipboardConfirmationDialog: View {
  let presentation: GhosttyClipboardConfirmationCoordinator.Presentation
  let preview: String
  let previewImage: NSImage?
  let canRemember: Bool
  @Bindable var state: GhosttyClipboardConfirmationDialogState
  let onConfirm: () -> Void
  let onCancel: () -> Void

  var body: some View {
    DialogSurface(
      title: presentation.title,
      message: presentation.message,
      icon: .system("clipboard", tone: .warning),
      layout: DialogSurfaceLayout(width: 520, maximumContentHeight: 360),
      actions: [
        DialogSurfaceAction(
          id: "cancel",
          title: presentation.cancelTitle,
          role: .secondary,
          shortcut: .cancel,
          accessibilityIdentifier: "terminal.clipboard-confirmation.cancel",
          action: onCancel
        ),
        DialogSurfaceAction(
          id: "confirm",
          title: presentation.confirmTitle,
          role: .primary,
          shortcut: .default,
          accessibilityIdentifier: "terminal.clipboard-confirmation.confirm",
          action: onConfirm
        ),
      ],
      scrimLabel: presentation.cancelTitle,
      onDismiss: onCancel
    ) {
      VStack(alignment: .leading, spacing: 14) {
        if let previewImage {
          Image(nsImage: previewImage)
            .resizable()
            .interpolation(.high)
            .scaledToFit()
            .frame(maxWidth: .infinity)
            .frame(height: 180)
            .accessibilityLabel("Clipboard image preview")
            .accessibilityIdentifier("terminal.clipboard-confirmation.image")
        }

        DialogTextPreview(
          preview,
          minimumHeight: previewImage == nil ? 140 : 72,
          maximumHeight: previewImage == nil ? 180 : 88,
          accessibilityIdentifier: "terminal.clipboard-confirmation.preview"
        )

        if canRemember {
          DialogCheckbox(
            "Allow for the rest of this terminal session",
            isOn: $state.remember
          )
          .accessibilityIdentifier("terminal.clipboard-confirmation.remember")
        }
      }
    }
  }
}

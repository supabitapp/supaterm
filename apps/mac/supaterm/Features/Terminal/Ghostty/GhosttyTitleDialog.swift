import AppKit
import Observation
import SupatermUI
import SwiftUI

@Observable
@MainActor
final class GhosttyTitleDialogModel {
  var title: String

  init(title: String) {
    self.title = title
  }
}

struct GhosttyTitleDialog: View {
  let title: String
  @Bindable var model: GhosttyTitleDialogModel
  let onConfirm: () -> Void
  let onCancel: () -> Void

  @FocusState private var isTitleFocused: Bool

  var body: some View {
    DialogSurface(
      title: title,
      message: "Leave blank to restore the default.",
      icon: .system("textformat", tone: .accent),
      actions: [
        DialogSurfaceAction(
          id: "cancel",
          title: "Cancel",
          role: .secondary,
          shortcut: .cancel,
          accessibilityIdentifier: "dialog.cancel",
          action: onCancel,
        ),
        DialogSurfaceAction(
          id: "confirm",
          title: "OK",
          role: .primary,
          shortcut: .default,
          accessibilityIdentifier: "dialog.confirm",
          action: onConfirm,
        ),
      ],
      scrimLabel: "Cancel changing title",
      onDismiss: onCancel,
    ) {
      DialogTextField(
        "Title",
        text: $model.title,
        accessibilityIdentifier: "dialog.title",
      )
      .focused($isTitleFocused)
      .onSubmit(onConfirm)
    }
    .task {
      await focusTitle()
    }
  }

  private func focusTitle() async {
    isTitleFocused = false
    await Task.yield()
    isTitleFocused = true
    await Task.yield()
    NSApp.sendAction(#selector(NSText.selectAll(_:)), to: nil, from: nil)
  }
}

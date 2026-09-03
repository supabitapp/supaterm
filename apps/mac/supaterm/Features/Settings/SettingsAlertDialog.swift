import ComposableArchitecture
import SupatermUI
import SwiftUI

struct SettingsAlertDialog: View {
  let alert: AlertState<SettingsFeature.Alert>
  let send: (PresentationAction<SettingsFeature.Alert>) -> Void

  var body: some View {
    DialogSurface(
      title: String(state: alert.title),
      message: alert.message.map { String(state: $0) },
      icon: .application,
      actions: alert.buttons.reversed().map(dialogAction),
      onDismiss: dismiss
    )
  }

  private func dialogAction(
    _ button: ButtonState<SettingsFeature.Alert>
  ) -> DialogSurfaceAction {
    DialogSurfaceAction(
      id: button.id.uuidString,
      title: String(state: button.label),
      role: role(for: button),
      shortcut: shortcut(for: button),
      accessibilityIdentifier: accessibilityIdentifier(for: button)
    ) {
      button.withAction { action in
        if let action {
          send(.presented(action))
        } else {
          send(.dismiss)
        }
      }
    }
  }

  private func role(
    for button: ButtonState<SettingsFeature.Alert>
  ) -> DialogSurfaceActionRole {
    if alert.buttons.count == 1 {
      return .primary
    }
    switch button.role {
    case .cancel:
      return .secondary
    case .destructive:
      return .destructive
    case nil:
      return .primary
    }
  }

  private func shortcut(
    for button: ButtonState<SettingsFeature.Alert>
  ) -> DialogSurfaceShortcut? {
    if alert.buttons.count == 1 {
      return .default
    }
    return button.role == .cancel ? .cancel : .default
  }

  private func accessibilityIdentifier(
    for button: ButtonState<SettingsFeature.Alert>
  ) -> String {
    if alert.buttons.count == 1 {
      return "dialog.confirm"
    }
    return button.role == .cancel ? "dialog.cancel" : "dialog.confirm"
  }

  private func dismiss() {
    send(.dismiss)
  }
}

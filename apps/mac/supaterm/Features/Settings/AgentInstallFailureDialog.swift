import SupatermUI
import SwiftUI

struct AgentInstallFailureDialog: View {
  let failure: SettingsAgentIntegrationInstallFailure
  let dismiss: () -> Void

  var body: some View {
    DialogSurface(
      title: failure.title,
      message: failure.message,
      icon: .system("hammer.fill", tone: .warning),
      layout: DialogSurfaceLayout(width: 560),
      actions: [
        DialogSurfaceAction(
          id: "dismiss",
          title: "OK",
          role: .primary,
          shortcut: .default,
          accessibilityIdentifier: "dialog.confirm",
          action: dismiss,
        )
      ],
      onDismiss: dismiss,
    ) {
      DialogTextPreview(
        failure.log,
        minimumHeight: 160,
        maximumHeight: 220,
        accessibilityIdentifier: "dialog.agent-install-log",
      )
    }
  }
}

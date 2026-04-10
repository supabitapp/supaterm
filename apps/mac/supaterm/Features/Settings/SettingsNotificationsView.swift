import ComposableArchitecture
import SwiftUI

struct SettingsNotificationsView: View {
  let store: StoreOf<SettingsFeature>

  private var glowingPaneRingEnabled: Binding<Bool> {
    Binding(
      get: { store.glowingPaneRingEnabled },
      set: { newValue in
        _ = store.send(.glowingPaneRingEnabledChanged(newValue))
      }
    )
  }

  private var systemNotificationsEnabled: Binding<Bool> {
    Binding(
      get: { store.systemNotificationsEnabled },
      set: { newValue in
        _ = store.send(.systemNotificationsEnabledChanged(newValue))
      }
    )
  }

  var body: some View {
    Form {
      Section {
        SettingsToggleRow(
          title: "System notifications",
          subtitle: "Show macOS notifications for terminal and coding agent activity.",
          isOn: systemNotificationsEnabled
        )

        SettingsToggleRow(
          title: "Glowing Pane Ring",
          subtitle: "Highlight panes with a glowing ring when terminal or coding agent activity needs attention.",
          isOn: glowingPaneRingEnabled
        )
      } footer: {
        Text(
          "Turning off system notifications only suppresses macOS delivery. "
            + "Turning off the pane ring keeps unread attention and badges without the in-pane glow."
        )
      }
    }
    .navigationTitle("Notifications")
    .settingsFormLayout()
  }
}

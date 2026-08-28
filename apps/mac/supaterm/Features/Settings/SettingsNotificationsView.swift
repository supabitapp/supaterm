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

  private var tabMoveHapticsEnabled: Binding<Bool> {
    Binding(
      get: { store.tabMoveHapticsEnabled },
      set: { newValue in
        _ = store.send(.tabMoveHapticsEnabledChanged(newValue))
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
        .accessibilityIdentifier("settings.notifications.system")

        SettingsToggleRow(
          title: "Glowing Pane Ring",
          subtitle: "Highlight panes with a glowing ring when terminal or coding agent activity needs attention.",
          isOn: glowingPaneRingEnabled
        )
        .accessibilityIdentifier("settings.notifications.glowing-pane-ring")

        SettingsToggleRow(
          title: "Haptic feedback when reordering tabs",
          subtitle: "Play feedback when a dragged tab enters a new drop target.",
          isOn: tabMoveHapticsEnabled
        )
        .accessibilityIdentifier("settings.notifications.tab-move-haptics")
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

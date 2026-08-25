import ComposableArchitecture
import SupatermSupport
import SwiftUI

struct SettingsGeneralView: View {
  let store: StoreOf<SettingsFeature>

  private var appearanceMode: Binding<AppearanceMode> {
    Binding(
      get: { store.appearanceMode },
      set: { newValue in
        _ = store.send(.appearanceModeSelected(newValue))
      }
    )
  }

  private var restoreTerminalLayoutEnabled: Binding<Bool> {
    Binding(
      get: { store.restoreTerminalLayoutEnabled },
      set: { newValue in
        _ = store.send(.restoreTerminalLayoutEnabledChanged(newValue))
      }
    )
  }

  private var persistSessions: Binding<Bool> {
    Binding(
      get: { store.sessionPersistenceEnabled },
      set: { newValue in
        _ = store.send(.sessionPersistenceEnabledChanged(newValue))
      }
    )
  }

  var body: some View {
    Form {
      Section {
        LabeledContent("Appearance") {
          HStack(spacing: 12) {
            let selectedMode = appearanceMode.wrappedValue
            ForEach(AppearanceMode.allCases) { mode in
              AppearanceOptionCardView(
                mode: mode,
                isSelected: mode == selectedMode
              ) {
                appearanceMode.wrappedValue = mode
              }
            }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
      }

      Section {
        SettingsToggleRow(
          title: "Restore Terminal Layout",
          subtitle: "Reopen tabs, splits, and working directories from your last session.",
          isOn: restoreTerminalLayoutEnabled
        )
        .accessibilityIdentifier("settings.general.restore-terminal-layout")

        SettingsToggleRow(
          title: "Persist Terminal Sessions",
          subtitle: "Keep terminal processes running across Supaterm restarts.",
          isOn: persistSessions
        )
        .accessibilityIdentifier("settings.general.persist-terminal-sessions")
      }
    }
    .navigationTitle("General")
    .settingsFormLayout()
  }
}

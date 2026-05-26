import ComposableArchitecture
import SupatermCLIShared
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

  private var confirmQuitMode: Binding<ConfirmQuitMode> {
    Binding(
      get: { store.confirmQuitMode },
      set: { newValue in
        _ = store.send(.confirmQuitModeSelected(newValue))
      }
    )
  }

  private var persistSessionsUsingZmx: Binding<Bool> {
    Binding(
      get: { store.zmxSessionsEnabled },
      set: { newValue in
        _ = store.send(.zmxSessionsEnabledChanged(newValue))
      }
    )
  }

  private var verboseLoggingEnabled: Binding<Bool> {
    Binding(
      get: { store.verboseLoggingEnabled },
      set: { newValue in
        _ = store.send(.verboseLoggingEnabledChanged(newValue))
      }
    )
  }

  private var newTabPosition: Binding<NewTabPosition> {
    Binding(
      get: { store.newTabPosition },
      set: { newValue in
        _ = store.send(.newTabPositionSelected(newValue))
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
        Picker(selection: newTabPosition) {
          ForEach(NewTabPosition.allCases) { position in
            Text(position.title).tag(position)
          }
        } label: {
          SettingsRowLabel(
            title: "New Tab Position",
            subtitle: "Choose whether new tabs open after the current tab or at the end."
          )
        }

        SettingsToggleRow(
          title: "Restore Terminal Layout",
          subtitle: "Reopen tabs, splits, and working directories from your last session.",
          isOn: restoreTerminalLayoutEnabled
        )

        Picker(selection: confirmQuitMode) {
          ForEach(ConfirmQuitMode.allCases) { mode in
            Text(mode.title).tag(mode)
          }
        } label: {
          SettingsRowLabel(
            title: "Confirm Quit",
            subtitle: "Choose when Supaterm asks before quitting."
          )
        }

        SettingsToggleRow(
          title: "Persist Sessions Using zmx",
          subtitle:
            "Use zmx for terminal session persistence across Supaterm restarts.",
          isOn: persistSessionsUsingZmx
        )

        SettingsToggleRow(
          title: "Enable Verbose Logging",
          subtitle: "Emit debug-level diagnostics to local OSLog.",
          isOn: verboseLoggingEnabled
        )
      }
    }
    .navigationTitle("General")
    .settingsFormLayout()
  }
}

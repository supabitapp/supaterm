import ComposableArchitecture
import SwiftUI

struct SettingsAdvancedView: View {
  let store: StoreOf<SettingsFeature>

  private var verboseLoggingEnabled: Binding<Bool> {
    Binding(
      get: { store.verboseLoggingEnabled },
      set: { newValue in
        _ = store.send(.verboseLoggingEnabledChanged(newValue))
      }
    )
  }

  var body: some View {
    Form {
      Section {
        SettingsToggleRow(
          title: "Enable Verbose Logging",
          subtitle: "Emit debug-level diagnostics to local OSLog.",
          isOn: verboseLoggingEnabled
        )
        .accessibilityIdentifier("settings.advanced.verbose-logging")
      }
    }
    .navigationTitle("Advanced")
    .settingsFormLayout()
  }
}

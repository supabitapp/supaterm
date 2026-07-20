import ComposableArchitecture
import SupatermSupport
import SwiftUI

struct SettingsAdvancedView: View {
  let store: StoreOf<SettingsFeature>

  private var verboseLoggingEnabled: Binding<Bool> {
    Binding(
      get: { SupatermLog.isVerboseLoggingForced || store.verboseLoggingEnabled },
      set: { newValue in
        guard !SupatermLog.isVerboseLoggingForced else { return }
        _ = store.send(.verboseLoggingEnabledChanged(newValue))
      }
    )
  }

  var body: some View {
    Form {
      Section {
        SettingsToggleRow(
          title: "Enable Verbose Logging",
          subtitle: SupatermLog.isVerboseLoggingForced
            ? "Enabled for this development run."
            : "Emit debug-level diagnostics to local OSLog.",
          isOn: verboseLoggingEnabled
        )
        .disabled(SupatermLog.isVerboseLoggingForced)
        .accessibilityIdentifier("settings.advanced.verbose-logging")
      }
    }
    .navigationTitle("Advanced")
    .settingsFormLayout()
  }
}

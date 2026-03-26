import Sharing
import SwiftUI

struct SettingsTabContentView: View {
  let tab: SettingsFeature.Tab

  var body: some View {
    switch tab {
    case .general:
      SettingsGeneralView()
    case .updates, .about:
      SettingsPlaceholderView(tab: tab)
    }
  }
}

private struct SettingsGeneralView: View {
  @Shared(.appPrefs) private var appPrefs = .default

  private var appearanceMode: Binding<AppearanceMode> {
    Binding(
      get: { appPrefs.appearanceMode },
      set: { newValue in
        $appPrefs.withLock {
          $0.appearanceMode = newValue
        }
      }
    )
  }

  var body: some View {
    Form {
      Section("Appearance") {
        Picker("Color scheme", selection: appearanceMode) {
          ForEach(AppearanceMode.allCases) { mode in
            Text(mode.title)
              .tag(mode)
          }
        }
        .pickerStyle(.segmented)
      }
    }
    .formStyle(.grouped)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .padding(24)
  }
}

private struct SettingsPlaceholderView: View {
  let tab: SettingsFeature.Tab

  var body: some View {
    VStack(spacing: 12) {
      Text(tab.title)
        .font(.title2.weight(.semibold))

      Text(tab.detail)
        .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .padding(24)
  }
}

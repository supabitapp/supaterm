import ComposableArchitecture
import SwiftUI

struct SettingsView: View {
  let store: StoreOf<SettingsFeature>

  private var selection: Binding<SettingsFeature.Tab> {
    Binding(
      get: { store.selectedTab },
      set: { store.send(.tabSelected($0)) }
    )
  }

  var body: some View {
    TabView(selection: selection) {
      settingsTab(.general)
      settingsTab(.updates)
      settingsTab(.about)
    }
    .frame(minWidth: 520, minHeight: 360)
  }

  private func settingsTab(_ tab: SettingsFeature.Tab) -> some View {
    SettingsTabPlaceholder(selectedTab: store.selectedTab)
      .tag(tab)
      .tabItem {
        Label(tab.title, systemImage: tab.symbol)
      }
  }
}

private struct SettingsTabPlaceholder: View {
  let selectedTab: SettingsFeature.Tab

  var body: some View {
    VStack(spacing: 12) {
      Text(selectedTab.title)
        .font(.title2.weight(.semibold))

      Text(selectedTab.detail)
        .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .padding(24)
  }
}

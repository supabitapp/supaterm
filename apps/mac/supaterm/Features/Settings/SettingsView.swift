import ComposableArchitecture
import SwiftUI

public struct SettingsView: View {
  let store: StoreOf<SettingsFeature>

  public init(store: StoreOf<SettingsFeature>) {
    self.store = store
  }

  private var selection: Binding<SettingsFeature.Tab?> {
    Binding(
      get: { store.selectedTab },
      set: { newValue in
        guard let newValue else { return }
        _ = store.send(.tabSelected(newValue))
      }
    )
  }

  public var body: some View {
    let tab = store.selectedTab
    NavigationSplitView(columnVisibility: .constant(.all)) {
      List(selection: selection) {
        ForEach(SettingsFeature.Tab.allCases) { tab in
          Label(tab.title, systemImage: tab.symbol)
            .tag(tab)
        }
      }
      .listStyle(.sidebar)
      .frame(minWidth: 220, maxHeight: .infinity)
      .navigationSplitViewColumnWidth(min: 220, ideal: 220, max: 220)
      .toolbar(removing: .sidebarToggle)
    } detail: {
      SettingsTabContentView(store: store, tab: tab)
    }
    .navigationSplitViewStyle(.balanced)
    .frame(minWidth: 750, minHeight: 500)
    .alert(store: store.scope(state: \.$alert, action: \.alert))
  }
}

private struct SettingsTabContentView: View {
  let store: StoreOf<SettingsFeature>
  let tab: SettingsFeature.Tab

  var body: some View {
    switch tab {
    case .codingAgents:
      SettingsCodingAgentsView(store: store)
    case .general:
      SettingsGeneralView(store: store)
    case .terminal:
      SettingsTerminalView(store: store)
    case .notifications:
      SettingsNotificationsView(store: store)
    case .about:
      SettingsAboutView(store: store)
    }
  }
}

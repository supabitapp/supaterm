import ComposableArchitecture
import SupatermSupport
import SwiftUI

public struct SettingsView: View {
  let licenseStore: StoreOf<LicenseFeature>
  @Bindable var store: StoreOf<SettingsFeature>

  public init(
    store: StoreOf<SettingsFeature>,
    licenseStore: StoreOf<LicenseFeature>
  ) {
    self.store = store
    self.licenseStore = licenseStore
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
            .accessibilityIdentifier("settings.sidebar.\(tab.rawValue)")
            .tag(tab)
        }
      }
      .listStyle(.sidebar)
      .frame(minWidth: 220, maxHeight: .infinity)
      .navigationSplitViewColumnWidth(min: 220, ideal: 220, max: 220)
      .toolbar(removing: .sidebarToggle)
    } detail: {
      SettingsTabContentView(store: store, licenseStore: licenseStore, tab: tab)
    }
    .navigationSplitViewStyle(.balanced)
    .frame(minWidth: 750, minHeight: 500)
    .alert($store.scope(state: \.alert, action: \.alert))
    .background {
      AgentInstallFailureAlertPresenter(
        failure: store.agentIntegrationInstallFailure,
        dismiss: {
          _ = store.send(.agentIntegrationInstallFailureDismissed)
        }
      )
      .frame(width: 0, height: 0)
    }
  }
}

struct SettingsTabContentView: View {
  let store: StoreOf<SettingsFeature>
  let licenseStore: StoreOf<LicenseFeature>
  let tab: SettingsFeature.Tab

  init(
    store: StoreOf<SettingsFeature>,
    licenseStore: StoreOf<LicenseFeature>,
    tab: SettingsFeature.Tab
  ) {
    self.store = store
    self.licenseStore = licenseStore
    self.tab = tab
  }

  var body: some View {
    switch tab {
    case .advanced:
      SettingsAdvancedView(store: store)
    case .codingAgents:
      SettingsCodingAgentsView(store: store)
    case .general:
      SettingsGeneralView(store: store)
    case .license:
      SettingsLicenseView(store: licenseStore)
    case .terminal:
      SettingsTerminalView(store: store)
    case .notifications:
      SettingsNotificationsView(store: store)
    case .shortcuts:
      SettingsShortcutsView(store: store)
    case .about:
      SettingsAboutView(store: store)
    }
  }
}

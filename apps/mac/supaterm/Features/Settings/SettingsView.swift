import ComposableArchitecture
import SupatermLicenseFeature
import SupatermSupport
import SupatermUI
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

  private var isDialogPresented: Binding<Bool> {
    Binding(
      get: {
        store.agentIntegrationInstallFailure != nil || store.alert != nil
      },
      set: { isPresented in
        guard !isPresented else { return }
        if store.agentIntegrationInstallFailure != nil {
          _ = store.send(.agentIntegrationInstallFailureDismissed)
        } else if store.alert != nil {
          _ = store.send(.alert(.dismiss))
        }
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
    .dialogSurface(isPresented: isDialogPresented) {
      if let failure = store.agentIntegrationInstallFailure {
        AgentInstallFailureDialog(
          failure: failure,
          dismiss: {
            _ = store.send(.agentIntegrationInstallFailureDismissed)
          }
        )
      } else if let alert = store.alert {
        SettingsAlertDialog(
          alert: alert,
          send: { _ = store.send(.alert($0)) }
        )
      }
    }
  }
}

private struct SettingsAlertDialog: View {
  let alert: AlertState<SettingsFeature.Alert>
  let send: (PresentationAction<SettingsFeature.Alert>) -> Void

  var body: some View {
    DialogSurface(
      title: String(state: alert.title),
      message: alert.message.map { String(state: $0) },
      icon: .application,
      actions: alert.buttons.reversed().map(dialogAction),
      onDismiss: dismiss
    )
  }

  private func dialogAction(
    _ button: ButtonState<SettingsFeature.Alert>
  ) -> DialogSurfaceAction {
    DialogSurfaceAction(
      id: button.id.uuidString,
      title: String(state: button.label),
      role: role(for: button),
      shortcut: shortcut(for: button),
      accessibilityIdentifier: accessibilityIdentifier(for: button)
    ) {
      button.withAction { action in
        if let action {
          send(.presented(action))
        } else {
          send(.dismiss)
        }
      }
    }
  }

  private func role(
    for button: ButtonState<SettingsFeature.Alert>
  ) -> DialogSurfaceActionRole {
    if alert.buttons.count == 1 {
      return .primary
    }
    switch button.role {
    case .cancel:
      return .secondary
    case .destructive:
      return .destructive
    case nil:
      return .primary
    }
  }

  private func shortcut(
    for button: ButtonState<SettingsFeature.Alert>
  ) -> DialogSurfaceShortcut? {
    if alert.buttons.count == 1 {
      return .default
    }
    return button.role == .cancel ? .cancel : .default
  }

  private func accessibilityIdentifier(
    for button: ButtonState<SettingsFeature.Alert>
  ) -> String {
    if alert.buttons.count == 1 {
      return "dialog.confirm"
    }
    return button.role == .cancel ? "dialog.cancel" : "dialog.confirm"
  }

  private func dismiss() {
    send(.dismiss)
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

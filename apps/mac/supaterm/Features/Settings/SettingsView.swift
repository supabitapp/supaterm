import AppKit
import ComposableArchitecture
import SupatermCLIShared
import SwiftUI

struct SettingsView: View {
  let store: StoreOf<SettingsFeature>

  private var selection: Binding<SettingsFeature.Tab?> {
    Binding(
      get: { store.selectedTab },
      set: { newValue in
        guard let newValue else { return }
        _ = store.send(.tabSelected(newValue))
      }
    )
  }

  var body: some View {
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
    case .advanced:
      SettingsAdvancedView(store: store)
    case .codingAgents:
      SettingsCodingAgentsView(store: store)
    case .general:
      SettingsGeneralView(store: store)
    case .notifications:
      SettingsNotificationsView(store: store)
    case .updates:
      SettingsUpdatesView(store: store)
    case .about:
      SettingsAboutView()
    }
  }
}

private struct SettingsCodingAgentsView: View {
  let store: StoreOf<SettingsFeature>

  private var claudeHooks: SettingsAgentHooksState {
    store.claudeHooks
  }

  private var codexHooks: SettingsAgentHooksState {
    store.codexHooks
  }

  private var claudeToggle: Binding<Bool> {
    Binding(
      get: { store.claudeHooks.isEnabled },
      set: { newValue in
        _ = store.send(.agentHooksToggled(.claude, newValue))
      }
    )
  }

  private var codexToggle: Binding<Bool> {
    Binding(
      get: { store.codexHooks.isEnabled },
      set: { newValue in
        _ = store.send(.agentHooksToggled(.codex, newValue))
      }
    )
  }

  var body: some View {
    Form {
      Section(
        footer: Text("Hooks are optional and designed to extend Supaterm without affecting core functionality.")
      ) {}

      Section {
        SettingsAgentToggleRow(
          errorMessage: claudeHooks.errorMessage,
          isOn: claudeToggle,
          isPending: claudeHooks.isPending,
          subtitle: "Display agent activity in tabs and forward notifications to Supaterm.",
          title: "Integration"
        )
      } header: {
        SettingsAgentSectionHeader(
          imageName: "claude-code-mark",
          title: "Claude Code"
        )
      } footer: {
        Text("Applied to `\(claudeHooks.settingsPath)`.")
      }

      Section {
        SettingsAgentToggleRow(
          errorMessage: codexHooks.errorMessage,
          isOn: codexToggle,
          isPending: codexHooks.isPending,
          subtitle: "Display agent activity in tabs and forward notifications to Supaterm.",
          title: "Integration"
        )
      } header: {
        SettingsAgentSectionHeader(
          imageName: "codex-mark",
          title: "Codex"
        )
      } footer: {
        Text("Applied to `\(codexHooks.settingsPath)`.")
      }
    }
    .navigationTitle("Coding Agents")
    .settingsFormLayout()
  }
}

private struct SettingsAgentToggleRow: View {
  let errorMessage: String?
  let isOn: Binding<Bool>
  let isPending: Bool
  let subtitle: String
  let title: String

  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Toggle(isOn: isOn) {
        SettingsRowLabel(
          title: title,
          subtitle: subtitle
        )
      }
      .disabled(isPending)
      if let errorMessage {
        Text(errorMessage)
          .font(.callout)
          .foregroundStyle(errorColor)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .padding(.vertical, 2)
  }

  private var errorColor: Color {
    colorScheme == .dark
      ? Color(red: 1, green: 0.54, blue: 0.54)
      : Color(red: 0.74, green: 0.17, blue: 0.17)
  }
}

private struct SettingsAgentSectionHeader: View {
  let imageName: String
  let title: String

  var body: some View {
    Label {
      Text(title)
    } icon: {
      Image(imageName)
        .resizable()
        .aspectRatio(contentMode: .fit)
        .frame(width: 18, height: 18)
        .accessibilityHidden(true)
    }
    .font(.headline)
  }
}

private struct SettingsGeneralView: View {
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

        LabeledContent {
          VStack(alignment: .leading, spacing: 4) {
            Text("Configure Ghostty directly to control terminal colors.")
              .font(.callout)
              .foregroundStyle(.secondary)
            Text("theme = light:Monokai Pro Light Sun,dark:Dimmed Monokai")
              .font(.callout.monospaced())
              .textSelection(.enabled)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        } label: {
          SettingsRowLabel(
            title: "Terminal Theme",
            subtitle: "Managed through your Ghostty config."
          )
        }
      }

      Section {
        SettingsToggleRow(
          title: "Restore Terminal Layout",
          subtitle: "Reopen tabs, splits, and working directories from your last session.",
          isOn: restoreTerminalLayoutEnabled
        )
      }
    }
    .navigationTitle("General")
    .settingsFormLayout()
  }
}

private struct SettingsAdvancedView: View {
  let store: StoreOf<SettingsFeature>

  private var analyticsEnabled: Binding<Bool> {
    Binding(
      get: { store.analyticsEnabled },
      set: { newValue in
        _ = store.send(.analyticsEnabledChanged(newValue))
      }
    )
  }

  private var crashReportsEnabled: Binding<Bool> {
    Binding(
      get: { store.crashReportsEnabled },
      set: { newValue in
        _ = store.send(.crashReportsEnabledChanged(newValue))
      }
    )
  }

  var body: some View {
    Form {
      Section {
        SettingsToggleRow(
          title: "Share analytics with Supaterm",
          subtitle: "Anonymous usage data helps improve Supaterm.",
          isOn: analyticsEnabled
        )
        SettingsToggleRow(
          title: "Share crash reports with Supaterm",
          subtitle: "Anonymous crash reports help improve stability.",
          isOn: crashReportsEnabled
        )
      } header: {
        Text("Diagnostics")
      } footer: {
        Text("Changes to analytics and crash reports require an app restart.")
      }
    }
    .navigationTitle("Advanced")
    .settingsFormLayout()
  }
}

private struct SettingsNotificationsView: View {
  let store: StoreOf<SettingsFeature>

  private var systemNotificationsEnabled: Binding<Bool> {
    Binding(
      get: { store.systemNotificationsEnabled },
      set: { newValue in
        _ = store.send(.systemNotificationsEnabledChanged(newValue))
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
      } footer: {
        Text("Turning this off only suppresses macOS delivery. Supaterm still tracks unread attention.")
      }
    }
    .navigationTitle("Notifications")
    .settingsFormLayout()
  }
}

private struct SettingsUpdatesView: View {
  let store: StoreOf<SettingsFeature>

  private var updateChannel: Binding<UpdateChannel> {
    Binding(
      get: { store.updateChannel },
      set: { newValue in
        _ = store.send(.updateChannelSelected(newValue))
      }
    )
  }

  private var updatesAutomaticallyCheckForUpdates: Binding<Bool> {
    Binding(
      get: { store.updatesAutomaticallyCheckForUpdates },
      set: { newValue in
        _ = store.send(.updatesAutomaticallyCheckForUpdatesChanged(newValue))
      }
    )
  }

  private var updatesAutomaticallyDownloadUpdates: Binding<Bool> {
    Binding(
      get: { store.updatesAutomaticallyDownloadUpdates },
      set: { newValue in
        _ = store.send(.updatesAutomaticallyDownloadUpdatesChanged(newValue))
      }
    )
  }

  var body: some View {
    Form {
      Section {
        Picker(selection: updateChannel) {
          ForEach(UpdateChannel.allCases) { channel in
            Text(channel.title).tag(channel)
          }
        } label: {
          SettingsRowLabel(
            title: "Channel",
            subtitle: store.updateChannel == .stable
              ? "Recommended for most users."
              : "Get the latest features early."
          )
        }
      }

      Section("Automatic Updates") {
        SettingsToggleRow(
          title: "Check for updates automatically",
          subtitle: "Periodically checks for new versions while Supaterm is running.",
          isOn: updatesAutomaticallyCheckForUpdates
        )
        SettingsToggleRow(
          title: "Download and install updates automatically",
          subtitle: "Downloads updates in the background and prompts for restart when needed.",
          isOn: updatesAutomaticallyDownloadUpdates
        )
        .disabled(!store.updatesAutomaticallyCheckForUpdates)
      }

      Section {
        Button("Check for Updates Now") {
          _ = store.send(.checkForUpdatesButtonTapped)
        }
        .buttonStyle(.bordered)
        .controlSize(.large)
        .buttonBorderShape(.roundedRectangle)
        .frame(maxWidth: .infinity)
      }
    }
    .navigationTitle("Updates")
    .settingsFormLayout()
  }
}

private struct SettingsToggleRow: View {
  let title: String
  let subtitle: String
  let isOn: Binding<Bool>

  var body: some View {
    Toggle(isOn: isOn) {
      SettingsRowLabel(
        title: title,
        subtitle: subtitle
      )
    }
  }
}

private struct SettingsAboutView: View {
  private var appName: String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
      ?? Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String
      ?? "Supaterm"
  }

  private var versionText: String {
    switch (AppBuild.version, AppBuild.buildNumber) {
    case (let version, let buildNumber) where !version.isEmpty && !buildNumber.isEmpty:
      return "\(version) (\(buildNumber))"
    case (let version, _) where !version.isEmpty:
      return version
    case (_, let buildNumber) where !buildNumber.isEmpty:
      return buildNumber
    default:
      return "Unknown Version"
    }
  }

  var body: some View {
    VStack(spacing: 24) {
      Image(nsImage: NSApplication.shared.applicationIconImage)
        .resizable()
        .interpolation(.high)
        .frame(width: 96, height: 96)
        .accessibilityLabel("\(appName) app icon")

      VStack(spacing: 6) {
        Text(appName)
          .font(.title2.weight(.semibold))

        Text(versionText)
          .font(.callout)
          .foregroundStyle(.secondary)
          .textSelection(.enabled)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .navigationTitle("About")
  }
}

private struct AppearanceOptionCardView: View {
  let mode: AppearanceMode
  let isSelected: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      VStack(spacing: 4) {
        Image(mode.imageName)
          .resizable()
          .interpolation(.high)
          .aspectRatio(contentMode: .fit)
          .clipShape(.rect(cornerRadius: 8))
          .accessibilityLabel(mode.title)
          .overlay {
            RoundedRectangle(cornerRadius: 8)
              .strokeBorder(
                isSelected ? Color.accentColor : .clear,
                lineWidth: 2
              )
          }
        Text(mode.title)
          .font(.callout)
          .foregroundStyle(isSelected ? .primary : .secondary)
      }
    }
    .buttonStyle(.plain)
  }
}

private struct SettingsRowLabel: View {
  let title: String
  let subtitle: String

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(title)
      Text(subtitle)
        .font(.callout)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
    }
  }
}

extension View {
  fileprivate func settingsFormLayout() -> some View {
    formStyle(.grouped)
      .padding(.top, -20)
      .padding(.leading, -8)
      .padding(.trailing, -6)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

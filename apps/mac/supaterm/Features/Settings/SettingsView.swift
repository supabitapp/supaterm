import AppKit
import ComposableArchitecture
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
      SettingsDetailView {
        SettingsTabContentView(store: store, tab: tab)
          .navigationTitle(tab.title)
          .navigationSubtitle(tab.detail)
      }
    }
    .navigationSplitViewStyle(.balanced)
    .frame(minWidth: 750, minHeight: 500)
    .ignoresSafeArea(.container, edges: .top)
  }
}

private struct SettingsDetailView<Content: View>: View {
  let content: Content

  init(@ViewBuilder content: () -> Content) {
    self.content = content()
  }

  var body: some View {
    content
      .scenePadding(.horizontal)
      .scenePadding(.bottom)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
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
    case .updates:
      SettingsUpdatesView(store: store)
    case .about:
      SettingsAboutView()
    }
  }
}

private struct SettingsCodingAgentsView: View {
  let store: StoreOf<SettingsFeature>

  private var claudeInstallState: SettingsAgentHooksInstallState {
    store.claudeHooksInstallState
  }

  private var codexInstallState: SettingsAgentHooksInstallState {
    store.codexHooksInstallState
  }

  var body: some View {
    Form {
      Section {
        SettingsAgentInstallRow(
          action: { _ = store.send(.claudeHooksInstallButtonTapped) },
          buttonTitle: "Install",
          installState: claudeInstallState,
          subtitle: "Install the Supaterm hook bridge in ~/.claude/settings.json.",
          title: "Claude Code"
        )

        SettingsAgentInstallRow(
          action: { _ = store.send(.codexHooksInstallButtonTapped) },
          buttonTitle: "Install",
          installState: codexInstallState,
          subtitle: "Install the Supaterm hook bridge in ~/.codex/hooks.json and enable hooks.",
          title: "Codex"
        )
      }
    }
    .formStyle(.grouped)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

private struct SettingsAgentInstallRow: View {
  let action: () -> Void
  let buttonTitle: String
  let installState: SettingsAgentHooksInstallState
  let subtitle: String
  let title: String

  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      LabeledContent {
        Button(installState.isInstalling ? "Installing..." : buttonTitle, action: action)
          .disabled(installState.isInstalling)
          .fixedSize()
      } label: {
        SettingsRowLabel(
          title: title,
          subtitle: subtitle
        )
      }
      if let message = installState.message {
        Text(message)
          .font(.callout)
          .foregroundStyle(installState.isFailure ? errorColor : .secondary)
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
        LabeledContent {
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
        } label: {
          SettingsRowLabel(
            title: "Appearance",
            subtitle: "Choose how Supaterm renders window chrome."
          )
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
    .formStyle(.grouped)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
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
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
    .formStyle(.grouped)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
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
  }
}

private struct AppearanceOptionCardView: View {
  let mode: AppearanceMode
  let isSelected: Bool
  let action: () -> Void

  var body: some View {
    let strokeColor = isSelected ? Color.accentColor : Color.secondary.opacity(0.35)

    Button(action: action) {
      VStack(spacing: 12) {
        Image(mode.imageName)
          .resizable()
          .interpolation(.high)
          .scaledToFit()
          .accessibilityHidden(true)
        Text(mode.title)
          .font(.headline)
      }
      .frame(minWidth: 112, maxWidth: 124)
      .padding(12)
    }
    .buttonStyle(.plain)
    .background(isSelected ? Color.accentColor.opacity(0.12) : .clear)
    .clipShape(.rect(cornerRadius: 12))
    .overlay {
      RoundedRectangle(cornerRadius: 12)
        .stroke(strokeColor, lineWidth: isSelected ? 2 : 1)
    }
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

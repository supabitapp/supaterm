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
    case .advanced:
      SettingsAdvancedView(store: store)
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
          buttonTitle: "Install Claude Hooks",
          installState: claudeInstallState,
          subtitle:
            "Install Supaterm's Claude hook bridge into `~/.claude/settings.json`. "
            + "Supaterm preserves your existing settings and rewrites only its own hook entries.",
          title: "Claude Code"
        )

        SettingsAgentInstallRow(
          action: { _ = store.send(.codexHooksInstallButtonTapped) },
          buttonTitle: "Install Codex Hooks",
          installState: codexInstallState,
          subtitle:
            "Install Supaterm's Codex hook bridge into `~/.codex/hooks.json` and enable "
            + "the Codex hooks feature. Supaterm preserves your existing global hooks and "
            + "uses the Codex CLI to update Codex config.",
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
    HStack(alignment: .center, spacing: 16) {
      VStack(alignment: .leading, spacing: 4) {
        Text(title)
          .font(.headline)
        Text(subtitle)
          .font(.callout)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
        if let message = installState.message {
          Text(message)
            .font(.callout)
            .foregroundStyle(installState.isFailure ? errorColor : .secondary)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)

      Button(installState.isInstalling ? "Installing..." : buttonTitle, action: action)
        .disabled(installState.isInstalling)
        .fixedSize()
    }
    .padding(.vertical, 4)
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

  var body: some View {
    Form {
      Section("Appearance") {
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

        VStack(alignment: .leading, spacing: 4) {
          Text("Terminal theming follows Ghostty config")
          Text("For example, add the following line to `~/.config/ghostty/config`")
          Text("theme = light:Monokai Pro Light Sun,dark:Dimmed Monokai")
            .monospaced()
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        .textSelection(.enabled)
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
    VStack(alignment: .leading, spacing: 0) {
      Form {
        Section("Update Channel") {
          Picker("Channel", selection: updateChannel) {
            ForEach(UpdateChannel.allCases) { channel in
              Text(channel.title).tag(channel)
            }
          }
        }

        Section("Automatic Updates") {
          Toggle(
            "Check for updates automatically",
            isOn: updatesAutomaticallyCheckForUpdates
          )
          Toggle(
            "Download and install updates automatically",
            isOn: updatesAutomaticallyDownloadUpdates
          )
          .disabled(!store.updatesAutomaticallyCheckForUpdates)
        }
      }
      .formStyle(.grouped)

      HStack {
        Button("Check for Updates Now") {
          _ = store.send(.checkForUpdatesButtonTapped)
        }
        Spacer()
      }
      .padding(.top)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
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
      Section("Advanced") {
        SettingsAdvancedToggleView(
          detail: "Anonymous usage data helps improve Supaterm.",
          help: "Share anonymous usage data with Supaterm (requires restart)",
          isOn: analyticsEnabled,
          title: "Share analytics with Supaterm"
        )
        SettingsAdvancedToggleView(
          detail: "Anonymous crash reports help improve stability.",
          help: "Share anonymous crash reports with Supaterm (requires restart)",
          isOn: crashReportsEnabled,
          title: "Share crash reports with Supaterm"
        )
      }
    }
    .formStyle(.grouped)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

private struct SettingsAdvancedToggleView: View {
  let detail: String
  let help: String
  let isOn: Binding<Bool>
  let title: String

  var body: some View {
    VStack(alignment: .leading) {
      Toggle(title, isOn: isOn)
        .help(help)
      Text(detail)
        .font(.callout)
        .foregroundStyle(.secondary)
      Text("Requires app restart.")
        .font(.callout)
        .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
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
      VStack {
        ZStack {
          RoundedRectangle(cornerRadius: 12)
            .fill(mode.previewBackground)

          VStack(alignment: .leading) {
            HStack {
              Circle()
                .fill(.red)
                .frame(width: 6, height: 6)
              Circle()
                .fill(.yellow)
                .frame(width: 6, height: 6)
              Circle()
                .fill(.green)
                .frame(width: 6, height: 6)
            }

            RoundedRectangle(cornerRadius: 3)
              .fill(mode.previewPrimary)
              .frame(height: 10)

            RoundedRectangle(cornerRadius: 3)
              .fill(mode.previewSecondary)
              .frame(height: 8)

            RoundedRectangle(cornerRadius: 3)
              .fill(mode.previewAccent)
              .frame(width: 64, height: 6)
          }
          .padding()
        }
        .aspectRatio(1.6, contentMode: .fit)

        Text(mode.title)
          .font(.headline)
      }
      .frame(maxWidth: .infinity)
      .padding()
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

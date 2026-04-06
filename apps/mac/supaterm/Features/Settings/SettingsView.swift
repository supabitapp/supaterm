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

private struct SettingsTerminalView: View {
  let store: StoreOf<SettingsFeature>

  private let defaultFontFamilyTag = "__supaterm_default_font_family__"

  private var controlsDisabled: Bool {
    store.terminal.isApplying || store.terminal.isLoading
  }

  private var fontFamilySelection: Binding<String> {
    Binding(
      get: { store.terminal.fontFamily ?? defaultFontFamilyTag },
      set: { newValue in
        _ = store.send(
          .terminalFontFamilySelected(
            newValue == defaultFontFamilyTag ? nil : newValue
          )
        )
      }
    )
  }

  private var fontSizeSelection: Binding<Double> {
    Binding(
      get: { store.terminal.fontSize },
      set: { newValue in
        _ = store.send(.terminalFontSizeChanged(newValue))
      }
    )
  }

  private var lightThemeSelection: Binding<String?> {
    Binding(
      get: { store.terminal.lightTheme },
      set: { newValue in
        _ = store.send(.terminalLightThemeSelected(newValue))
      }
    )
  }

  private var darkThemeSelection: Binding<String?> {
    Binding(
      get: { store.terminal.darkTheme },
      set: { newValue in
        _ = store.send(.terminalDarkThemeSelected(newValue))
      }
    )
  }

  private var availableLightThemes: [String] {
    themeOptions(
      from: store.terminal.availableLightThemes,
      selected: store.terminal.lightTheme
    )
  }

  private var availableDarkThemes: [String] {
    themeOptions(
      from: store.terminal.availableDarkThemes,
      selected: store.terminal.darkTheme
    )
  }

  private var resolvedConfigPath: String {
    if store.terminal.configPath.isEmpty {
      GhosttyBootstrap.configFileLocations().preferred.path
    } else {
      store.terminal.configPath
    }
  }

  var body: some View {
    Form {
      Section {
        VStack(alignment: .leading, spacing: 16) {
          SettingsTerminalPreviewView(configPath: resolvedConfigPath)
            .frame(maxWidth: .infinity, minHeight: 180, maxHeight: 180)
            .id(resolvedConfigPath)

          LabeledContent("Config File") {
            Text(resolvedConfigPath)
              .font(.callout.monospaced())
              .foregroundStyle(.secondary)
              .frame(maxWidth: .infinity, alignment: .leading)
              .textSelection(.enabled)
          }
        }
      }

      Section {
        if let warningMessage = store.terminal.warningMessage {
          Text(warningMessage)
            .font(.callout)
            .foregroundStyle(.orange)
            .fixedSize(horizontal: false, vertical: true)
        }

        if let errorMessage = store.terminal.errorMessage {
          Text(errorMessage)
            .font(.callout)
            .foregroundStyle(.red)
            .fixedSize(horizontal: false, vertical: true)
        }

      }

      Section {
        LabeledContent("Light/Dark Theme") {
          HStack(spacing: 12) {
            Picker(selection: lightThemeSelection) {
              if store.terminal.lightTheme == nil {
                Text("Select Theme").tag(Optional<String>.none)
              }
              ForEach(availableLightThemes, id: \.self) { theme in
                Text(theme).tag(theme as String?)
              }
            } label: {
              EmptyView()
            }
            .labelsHidden()
            .disabled(controlsDisabled)
            .frame(maxWidth: .infinity)

            Picker(selection: darkThemeSelection) {
              if store.terminal.darkTheme == nil {
                Text("Select Theme").tag(Optional<String>.none)
              }
              ForEach(availableDarkThemes, id: \.self) { theme in
                Text(theme).tag(theme as String?)
              }
            } label: {
              EmptyView()
            }
            .labelsHidden()
            .disabled(controlsDisabled)
            .frame(maxWidth: .infinity)
          }
        }

        Picker(selection: fontFamilySelection) {
          Text("Default").tag(defaultFontFamilyTag)
          ForEach(store.terminal.availableFontFamilies, id: \.self) { fontFamily in
            Text(fontFamily).tag(fontFamily)
          }
        } label: {
          SettingsRowLabel(
            title: "Font"
          )
        }
        .disabled(controlsDisabled)

        LabeledContent {
          Stepper(value: fontSizeSelection, in: 6...72, step: 1) {
            Text("\(Int(store.terminal.fontSize.rounded())) pt")
              .font(.callout.monospaced())
              .frame(minWidth: 64, alignment: .trailing)
          }
          .disabled(controlsDisabled)
        } label: {
          SettingsRowLabel(
            title: "Font Size"
          )
        }
      }
    }
    .navigationTitle("Terminal")
    .settingsFormLayout()
  }

  private func themeOptions(from themes: [String], selected: String?) -> [String] {
    guard let selected, !selected.isEmpty else {
      return themes
    }
    guard !themes.contains(selected) else {
      return themes
    }
    return [selected] + themes
  }
}

private struct SettingsTerminalPreviewView: View {
  private let configPath: String
  @StateObject private var controller: GhosttyTerminalPreviewController

  init(configPath: String) {
    self.configPath = configPath
    _controller = StateObject(
      wrappedValue: GhosttyTerminalPreviewController(configPath: configPath)
    )
  }

  var body: some View {
    GhosttyColorSchemeSyncView(ghostty: controller.runtime) {
      GhosttyTerminalView(surfaceView: controller.surfaceView)
        .allowsHitTesting(false)
        .clipShape(.rect(cornerRadius: 12))
        .overlay {
          RoundedRectangle(cornerRadius: 12)
            .strokeBorder(.quaternary, lineWidth: 1)
        }
    }
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

private struct SettingsAboutView: View {
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
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        SettingsSurfaceCard {
          HStack(alignment: .center, spacing: 24) {
            Image(nsImage: NSApplication.shared.applicationIconImage)
              .resizable()
              .interpolation(.high)
              .frame(width: 96, height: 96)
              .accessibilityLabel("\(appName) app icon")

            VStack(alignment: .leading, spacing: 6) {
              Text(appName)
                .font(.system(size: 34, weight: .semibold))

              Text(versionText)
                .font(.title3)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)

              HStack(spacing: 12) {
                Button("Check for Updates") {
                  _ = store.send(.checkForUpdatesButtonTapped)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
              }

              VStack(alignment: .leading, spacing: 12) {
                SettingsCompactToggleRow(
                  title: "Automatically check for updates",
                  isOn: updatesAutomaticallyCheckForUpdates
                )

                SettingsCompactToggleRow(
                  title: "Automatically download and install updates",
                  isOn: updatesAutomaticallyDownloadUpdates
                )
                .disabled(!store.updatesAutomaticallyCheckForUpdates)
              }
            }

            Spacer(minLength: 0)
          }
        }

        SettingsSurfaceCard {
          VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
              Text("Updates")
                .font(.headline)

              Text("Choose your release channel.")
                .font(.callout)
                .foregroundStyle(.secondary)
            }

            HStack(alignment: .top, spacing: 16) {
              VStack(alignment: .leading, spacing: 4) {
                Text("Channel")
                  .font(.body.weight(.medium))

                Text(
                  store.updateChannel == .stable
                    ? "Recommended for most users."
                    : "Get the latest features early."
                )
                .font(.callout)
                .foregroundStyle(.secondary)
              }

              Spacer(minLength: 0)

              Picker("Channel", selection: updateChannel) {
                ForEach(UpdateChannel.allCases) { channel in
                  Text(channel.title).tag(channel)
                }
              }
              .labelsHidden()
              .pickerStyle(.menu)
              .frame(width: 180, alignment: .trailing)
              .controlSize(.large)
            }
          }
        }

        SettingsSurfaceCard {
          VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
              Text("Diagnostics")
                .font(.headline)

              Text("Control anonymous analytics and crash reports.")
                .font(.callout)
                .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 10) {
              SettingsCompactToggleRow(
                title: "Share analytics with Supaterm",
                isOn: analyticsEnabled
              )

              SettingsCompactToggleRow(
                title: "Share crash reports with Supaterm",
                isOn: crashReportsEnabled
              )
            }

            Text("Changes to analytics and crash reports require an app restart.")
              .font(.callout)
              .foregroundStyle(.secondary)
          }
        }
      }
      .padding(24)
      .frame(maxWidth: 760, alignment: .leading)
      .frame(maxWidth: .infinity, alignment: .center)
    }
    .navigationTitle("About")
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

private struct SettingsCompactToggleRow: View {
  let title: String
  let isOn: Binding<Bool>

  var body: some View {
    Toggle(title, isOn: isOn)
      .toggleStyle(.checkbox)
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
  let subtitle: String?

  init(
    title: String,
    subtitle: String? = nil
  ) {
    self.title = title
    self.subtitle = subtitle
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(title)
      if let subtitle {
        Text(subtitle)
          .font(.callout)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
  }
}

private struct SettingsSurfaceCard<Content: View>: View {
  let content: Content

  init(@ViewBuilder content: () -> Content) {
    self.content = content()
  }

  var body: some View {
    content
      .padding(24)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(
        RoundedRectangle(cornerRadius: 20, style: .continuous)
          .fill(Color(nsColor: .controlBackgroundColor))
      )
      .overlay {
        RoundedRectangle(cornerRadius: 20, style: .continuous)
          .strokeBorder(.quaternary, lineWidth: 1)
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

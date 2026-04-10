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

  private func integration(for agent: SupatermAgentKind) -> SettingsAgentIntegrationState {
    switch agent {
    case .claude:
      return store.claudeIntegration
    case .codex:
      return store.codexIntegration
    case .pi:
      return store.piIntegration
    }
  }

  private func integrationToggle(for agent: SupatermAgentKind) -> Binding<Bool> {
    Binding(
      get: { integration(for: agent).isEnabled },
      set: { newValue in
        _ = store.send(.agentIntegrationToggled(agent, newValue))
      }
    )
  }

  var body: some View {
    Form {
      Section {
        ForEach(SupatermAgentKind.allCases, id: \.self) { agent in
          let integration = integration(for: agent)
          SettingsAgentListRow(
            agent: agent,
            errorMessage: integration.errorMessage,
            isAvailable: integration.isAvailable,
            isOn: integrationToggle(for: agent),
            isPending: integration.isPending
          )
        }
      } footer: {
        VStack(alignment: .leading, spacing: 8) {
          Text("Supaterm installs coding-agent hooks into these paths:")

          ForEach(SupatermAgentKind.allCases, id: \.self) { agent in
            Text(agent.settingsInstallDescription)
              .font(.caption.monospaced())
              .foregroundStyle(.secondary)
              .textSelection(.enabled)
          }
        }
      }

      Section {
        SettingsSkillInstallRow()
      }
    }
    .navigationTitle("Coding Agents")
    .settingsFormLayout()
  }
}

private struct SettingsAgentListRow: View {
  let agent: SupatermAgentKind
  let errorMessage: String?
  let isAvailable: Bool
  let isOn: Binding<Bool>
  let isPending: Bool

  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Toggle(isOn: isOn) {
        Label {
          Text(agent.notificationTitle)
        } icon: {
          Image(agent.settingsMarkImageName)
            .resizable()
            .aspectRatio(contentMode: .fit)
            .frame(width: 18, height: 18)
            .accessibilityHidden(true)
        }
      }
      .disabled(isPending || !isAvailable)

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

private struct SettingsSkillInstallRow: View {
  var body: some View {
    HStack(alignment: .center, spacing: 12) {
      Image(systemName: "terminal")
        .frame(width: 18, height: 18)
        .foregroundStyle(.secondary)
        .accessibilityHidden(true)

      VStack(alignment: .leading, spacing: 2) {
        Text("Supaterm Skill")
        Text("Install through npx in Terminal.")
          .font(.caption)
          .foregroundStyle(.secondary)
      }

      Spacer(minLength: 12)

      Text(SupatermSkillInstaller.installCommand)
        .font(.caption.monospaced())
        .foregroundStyle(.secondary)
        .textSelection(.enabled)
    }
    .padding(.vertical, 2)
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

  private var newTabPosition: Binding<NewTabPosition> {
    Binding(
      get: { store.newTabPosition },
      set: { newValue in
        _ = store.send(.newTabPositionSelected(newValue))
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
        Picker(selection: newTabPosition) {
          ForEach(NewTabPosition.allCases) { position in
            Text(position.title).tag(position)
          }
        } label: {
          SettingsRowLabel(
            title: "New Tab Position",
            subtitle: "Choose whether new tabs open after the current tab or at the end."
          )
        }

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

  private var confirmCloseSurfaceSelection: Binding<GhosttyTerminalCloseConfirmation> {
    Binding(
      get: { store.terminal.confirmCloseSurface },
      set: { newValue in
        _ = store.send(.terminalConfirmCloseSurfaceSelected(newValue))
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
            themePicker(
              selection: lightThemeSelection,
              themes: availableLightThemes,
              selectedTheme: store.terminal.lightTheme
            )
            themePicker(
              selection: darkThemeSelection,
              themes: availableDarkThemes,
              selectedTheme: store.terminal.darkTheme
            )
          }
          .frame(maxWidth: .infinity, alignment: .trailing)
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
          HStack(spacing: 12) {
            Spacer(minLength: 0)

            Text("\(Int(store.terminal.fontSize.rounded())) pt")
              .font(.callout.monospaced())
              .frame(minWidth: 64, alignment: .trailing)

            Stepper("", value: fontSizeSelection, in: 6...72, step: 1)
              .labelsHidden()
              .fixedSize()
          }
          .disabled(controlsDisabled)
        } label: {
          SettingsRowLabel(
            title: "Font Size"
          )
        }

        Picker(selection: confirmCloseSurfaceSelection) {
          ForEach(GhosttyTerminalCloseConfirmation.allCases) { option in
            Text(option.title).tag(option)
          }
        } label: {
          SettingsRowLabel(
            title: "Close Confirmation",
            subtitle: "Choose when closing a tab, split, or window asks for confirmation."
          )
        }
        .disabled(controlsDisabled)

      }

      Section {
        VStack(alignment: .leading, spacing: 8) {
          Text("Config File")
            .font(.callout.weight(.semibold))

          Text(resolvedConfigPath)
            .font(.callout.monospaced())
            .foregroundStyle(.secondary)
            .textSelection(.enabled)
        }
      } footer: {
        VStack(alignment: .leading, spacing: 4) {
          Text("Supaterm reads and writes your Ghostty config, so changes here stay in sync with Ghostty itself.")
          Text("Some configurations require an app restart to take effect.")
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

  @ViewBuilder
  private func themePicker(
    selection: Binding<String?>,
    themes: [String],
    selectedTheme: String?
  ) -> some View {
    Picker(selection: selection) {
      if selectedTheme == nil {
        Text("Select Theme").tag(Optional<String>.none)
      }
      ForEach(themes, id: \.self) { theme in
        Text(theme).tag(theme as String?)
      }
    } label: {
      EmptyView()
    }
    .labelsHidden()
    .disabled(controlsDisabled)
  }
}

private struct SettingsNotificationsView: View {
  let store: StoreOf<SettingsFeature>

  private var glowingPaneRingEnabled: Binding<Bool> {
    Binding(
      get: { store.glowingPaneRingEnabled },
      set: { newValue in
        _ = store.send(.glowingPaneRingEnabledChanged(newValue))
      }
    )
  }

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

        SettingsToggleRow(
          title: "Glowing Pane Ring",
          subtitle: "Highlight panes with a glowing ring when terminal or coding agent activity needs attention.",
          isOn: glowingPaneRingEnabled
        )
      } footer: {
        Text(
          "Turning off system notifications only suppresses macOS delivery. "
            + "Turning off the pane ring keeps unread attention and badges without the in-pane glow."
        )
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
          HStack(alignment: .center, spacing: 20) {
            Image(nsImage: NSApplication.shared.applicationIconImage ?? NSImage())
              .resizable()
              .interpolation(.high)
              .frame(width: 84, height: 84)
              .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 6) {
              Text(appName)
                .font(.system(size: 28, weight: .semibold))

              Text(versionText)
                .font(.headline)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)

              HStack(spacing: 12) {
                Button("Check for Updates") {
                  _ = store.send(.checkForUpdatesButtonTapped)
                }
                .buttonStyle(.bordered)
                .controlSize(.regular)

                Picker("Updates", selection: updateChannel) {
                  ForEach(UpdateChannel.allCases) { channel in
                    Text(channel.title).tag(channel)
                  }
                }
                .labelsHidden()
                .pickerStyle(.menu)
                .frame(width: 150, alignment: .leading)
                .controlSize(.regular)
              }

              VStack(alignment: .leading, spacing: 8) {
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
          VStack(alignment: .leading, spacing: 12) {
            Text("Diagnostics")
              .font(.subheadline.weight(.semibold))

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

            Text("Help us improve Supaterm by allowing us to collect completely anonymous usage data.")
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
    Toggle(isOn: isOn) {
      Text(title)
        .font(.callout)
    }
    .controlSize(.small)
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

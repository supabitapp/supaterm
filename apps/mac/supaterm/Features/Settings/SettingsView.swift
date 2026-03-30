import ComposableArchitecture
import Sharing
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
      SettingsGeneralView()
    case .updates, .about:
      SettingsPlaceholderView(tab: tab)
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
      SettingsAgentInstallSection(
        action: { _ = store.send(.claudeHooksInstallButtonTapped) },
        buttonTitle: "Install Claude Hooks",
        detail: "Install Supaterm's Claude hook bridge into `~/.claude/settings.json`.",
        footnote: "Supaterm preserves your existing settings and rewrites only its own hook entries.",
        installState: claudeInstallState,
        title: "Claude Code"
      )

      SettingsAgentInstallSection(
        action: { _ = store.send(.codexHooksInstallButtonTapped) },
        buttonTitle: "Install Codex Hooks",
        detail: "Install Supaterm's Codex hook bridge into `~/.codex/hooks.json` and enable the Codex hooks feature.",
        footnote: "Supaterm preserves your existing global hooks and uses the Codex CLI to update Codex config.",
        installState: codexInstallState,
        title: "Codex"
      )
    }
    .formStyle(.grouped)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

private struct SettingsAgentInstallSection: View {
  let action: () -> Void
  let buttonTitle: String
  let detail: String
  let footnote: String
  let installState: SettingsAgentHooksInstallState
  let title: String

  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    Section(title) {
      Text(detail)
      Text(footnote)
        .font(.footnote)
        .foregroundStyle(.secondary)

      Button(installState.isInstalling ? "Installing..." : buttonTitle, action: action)
        .disabled(installState.isInstalling)

      if let message = installState.message {
        Text(message)
          .foregroundStyle(installState.isFailure ? errorColor : .secondary)
      }
    }
  }

  private var errorColor: Color {
    colorScheme == .dark
      ? Color(red: 1, green: 0.54, blue: 0.54)
      : Color(red: 0.74, green: 0.17, blue: 0.17)
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

private struct SettingsPlaceholderView: View {
  let tab: SettingsFeature.Tab

  var body: some View {
    Form {
      Section(tab.title) {
        Text(tab.detail)
          .foregroundStyle(.secondary)
      }
    }
    .formStyle(.grouped)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

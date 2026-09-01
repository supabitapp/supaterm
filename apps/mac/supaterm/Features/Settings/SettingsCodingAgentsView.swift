import ComposableArchitecture
import SupatermCLIShared
import SupatermSupport
import SupatermUI
import SwiftUI

struct SettingsCodingAgentsView: View {
  let store: StoreOf<SettingsFeature>

  private func integration(for agent: SupatermManagedAgentKind) -> SettingsAgentIntegrationState {
    switch agent {
    case .claude:
      return store.claudeIntegration
    case .codex:
      return store.codexIntegration
    }
  }

  private func integrationToggle(for agent: SupatermManagedAgentKind) -> Binding<Bool> {
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
        SettingsToggleRow(
          title: "Show agent panel",
          subtitle: "Display the coding-agent panel inside terminal panes.",
          isOn: Binding(
            get: { store.codingAgentsShowPanel },
            set: { _ = store.send(.codingAgentsShowPanelChanged($0)) }
          )
        )
        .accessibilityIdentifier("settings.coding-agents.show-panel")

      }

      Section {
        ForEach(SupatermManagedAgentKind.allCases, id: \.self) { agent in
          let integration = integration(for: agent)
          SettingsAgentListRow(
            agent: agent,
            errorMessage: integration.message(for: agent),
            isAvailable: integration.isAvailable,
            isOn: integrationToggle(for: agent),
            isPending: integration.isPending
          )
        }
      } footer: {
        VStack(alignment: .leading, spacing: 8) {
          Text(
            "Pi uses terminal detection. Codex and Pi read the shared skill at "
              + "~/.agents/skills/supaterm. Claude uses the link at ~/.claude/skills/supaterm."
          )

          Text("Install or refresh it with: sp skills install")
            .font(.caption.monospaced())
            .foregroundStyle(.secondary)
            .textSelection(.enabled)

          Text("Supaterm installs coding-agent hooks into these paths:")

          ForEach(SupatermManagedAgentKind.allCases, id: \.self) { agent in
            Text(agent.settingsInstallDescription)
              .font(.caption.monospaced())
              .foregroundStyle(.secondary)
              .textSelection(.enabled)
          }
        }
      }
    }
    .navigationTitle("Coding Agents")
    .settingsFormLayout()
  }
}

private struct SettingsAgentListRow: View {
  let agent: SupatermManagedAgentKind
  let errorMessage: String?
  let isAvailable: Bool
  let isOn: Binding<Bool>
  let isPending: Bool

  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 12) {
        Label {
          Text(agent.notificationTitle)
        } icon: {
          Image(agent.agentKind.markImageName)
            .renderingMode(.template)
            .resizable()
            .aspectRatio(contentMode: .fit)
            .frame(width: 18, height: 18)
            .foregroundStyle(.primary)
            .accessibilityHidden(true)
        }

        Spacer(minLength: 12)

        if isPending {
          DotsSpinner(size: 12, color: .secondary)
        } else {
          Toggle("", isOn: isOn)
            .labelsHidden()
            .disabled(!isAvailable)
        }
      }

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

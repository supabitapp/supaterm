import ComposableArchitecture
import SupatermCLIShared
import SwiftUI

struct SettingsCodingAgentsView: View {
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
      HStack(spacing: 12) {
        Label {
          Text(agent.notificationTitle)
        } icon: {
          Image(agent.settingsMarkImageName)
            .resizable()
            .aspectRatio(contentMode: .fit)
            .frame(width: 18, height: 18)
            .accessibilityHidden(true)
        }

        Spacer(minLength: 12)

        if isPending {
          ProgressView()
            .controlSize(.small)
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

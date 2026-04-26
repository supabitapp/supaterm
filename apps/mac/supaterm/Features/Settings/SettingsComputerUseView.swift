import ComposableArchitecture
import SupatermCLIShared
import SwiftUI

struct SettingsComputerUseView: View {
  let store: StoreOf<SettingsFeature>

  private var showsPermissionsReadySummary: Bool {
    store.computerUse.hasRequiredPermissions && !store.computerUse.isRefreshing
  }

  var body: some View {
    Form {
      Section {
        if showsPermissionsReadySummary {
          ComputerUsePermissionReadyRow()
        } else {
          ForEach(ComputerUsePermissionKind.allCases) { permission in
            ComputerUsePermissionRow(
              permission: permission,
              status: store.computerUse.status(for: permission),
              isRefreshing: store.computerUse.isRefreshing,
              grant: {
                _ = store.send(.computerUsePermissionGrantButtonTapped(permission))
              },
              openSettings: {
                _ = store.send(.computerUsePermissionSettingsButtonTapped(permission))
              }
            )
          }
        }
      } footer: {
        if !showsPermissionsReadySummary {
          Text(
            "Computer use needs Accessibility to inspect and control app UI, "
              + "and Screen Recording to capture windows for the agent."
          )
        }
      }

      Section {
        SettingsToggleRow(
          title: "Show Agent Cursor",
          subtitle: "Show a cursor marker while computer-use actions run.",
          isOn: Binding(
            get: { store.computerUse.showAgentCursor },
            set: { _ = store.send(.computerUseShowAgentCursorChanged($0)) }
          )
        )
        SettingsToggleRow(
          title: "Always Float Agent Cursor",
          subtitle: "Keep the cursor marker visible above foreground app windows.",
          isOn: Binding(
            get: { store.computerUse.alwaysFloatAgentCursor },
            set: { _ = store.send(.computerUseAlwaysFloatAgentCursorChanged($0)) }
          )
        )
        .disabled(!store.computerUse.showAgentCursor)
      }

      Section {
        SettingsSkillInstallRow(
          title: "Computer Use Skill",
          subtitle: "Install through npx in Terminal.",
          command: SupatermSkillInstaller.manualComputerUseInstallCommand
        )
      } footer: {
        Text(
          "Install the Computer Use skill so agents can discover app, window, snapshot, and action commands."
        )
      }
    }
    .navigationTitle("Computer Use")
    .settingsFormLayout()
  }
}

private struct ComputerUsePermissionReadyRow: View {
  var body: some View {
    HStack(alignment: .center, spacing: 12) {
      Image(systemName: "checkmark.circle.fill")
        .frame(width: 18, height: 18)
        .foregroundStyle(.green)
        .accessibilityHidden(true)

      SettingsRowLabel(
        title: "Ready",
        subtitle: "Accessibility and Screen Recording are granted."
      )
    }
    .padding(.vertical, 2)
    .accessibilityElement(children: .combine)
  }
}

private struct ComputerUsePermissionRow: View {
  let permission: ComputerUsePermissionKind
  let status: ComputerUsePermissionStatus
  let isRefreshing: Bool
  let grant: () -> Void
  let openSettings: () -> Void

  var body: some View {
    HStack(alignment: .center, spacing: 12) {
      Image(systemName: permission.symbolName)
        .frame(width: 18, height: 18)
        .foregroundStyle(.secondary)
        .accessibilityHidden(true)

      SettingsRowLabel(
        title: permission.title,
        subtitle: permission.subtitle
      )

      Spacer(minLength: 12)

      PermissionStatusView(status: status, isRefreshing: isRefreshing)

      if status != .granted {
        Button("Grant", action: grant)
          .disabled(isRefreshing)

        Button("Open Settings", action: openSettings)
      }
    }
    .padding(.vertical, 2)
  }
}

private struct PermissionStatusView: View {
  let status: ComputerUsePermissionStatus
  let isRefreshing: Bool

  var body: some View {
    HStack(spacing: 6) {
      if isRefreshing {
        ProgressView()
          .controlSize(.small)
      } else {
        Image(systemName: status.symbolName)
          .foregroundStyle(status.tint)
          .accessibilityHidden(true)
      }

      Text(isRefreshing ? "Checking" : status.title)
        .font(.caption)
        .foregroundStyle(.secondary)
    }
    .frame(width: 96, alignment: .leading)
  }
}

extension SettingsComputerUseState {
  fileprivate func status(for permission: ComputerUsePermissionKind) -> ComputerUsePermissionStatus {
    switch permission {
    case .accessibility:
      return accessibility
    case .screenRecording:
      return screenRecording
    }
  }
}

extension ComputerUsePermissionKind {
  fileprivate var title: String {
    switch self {
    case .accessibility:
      return "Accessibility"
    case .screenRecording:
      return "Screen Recording"
    }
  }

  fileprivate var subtitle: String {
    switch self {
    case .accessibility:
      return "Inspect UI elements and perform accessibility actions."
    case .screenRecording:
      return "Capture app windows for visual context."
    }
  }

  fileprivate var symbolName: String {
    switch self {
    case .accessibility:
      return "cursorarrow.click"
    case .screenRecording:
      return "rectangle.dashed"
    }
  }
}

extension ComputerUsePermissionStatus {
  fileprivate var title: String {
    switch self {
    case .unknown:
      return "Unknown"
    case .granted:
      return "Granted"
    case .missing:
      return "Missing"
    }
  }

  fileprivate var symbolName: String {
    switch self {
    case .unknown:
      return "questionmark.circle"
    case .granted:
      return "checkmark.circle.fill"
    case .missing:
      return "exclamationmark.circle.fill"
    }
  }

  fileprivate var tint: Color {
    switch self {
    case .unknown:
      return .secondary
    case .granted:
      return .green
    case .missing:
      return .orange
    }
  }
}

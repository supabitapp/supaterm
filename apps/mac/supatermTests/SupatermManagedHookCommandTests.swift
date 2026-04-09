import Foundation
import Testing

@testable import SupatermCLIShared

struct SupatermManagedHookCommandTests {
  @Test
  func receiveHookCommandBuildsPiCommand() {
    #expect(
      SupatermManagedHookCommand.receiveHookCommand(for: .pi)
        == #"[ -n "${SUPATERM_CLI_PATH:-}" ] && "$SUPATERM_CLI_PATH" agent receive-agent-hook --agent pi || true"#
    )
  }

  @Test
  func notificationEventCommandPrefersStructuredBridgeAndFallsBackToOscNotification() {
    let command = SupatermManagedHookCommand.receiveHookCommand(for: .claude, eventName: .notification)
    let expected = expectedManagedNotificationCommand(
      agent: "claude",
      title: "Claude Code",
      body: "Needs input"
    )

    #expect(
      command == expected
    )
  }

  @Test
  func stopEventCommandFallsBackToOscCompletionNotification() {
    let command = SupatermManagedHookCommand.receiveHookCommand(for: .codex, eventName: .stop)
    let expected = expectedManagedNotificationCommand(
      agent: "codex",
      title: "Codex",
      body: "Turn complete"
    )

    #expect(
      command == expected
    )
  }

  @Test
  func nonNotificationEventKeepsStructuredOnlyCommand() {
    #expect(
      SupatermManagedHookCommand.receiveHookCommand(for: .claude, eventName: .preToolUse)
        == SupatermManagedHookCommand.receiveHookCommand(for: .claude)
    )
  }

  @Test
  func installArgumentsMatchAgentInstallHookInterface() {
    #expect(
      SupatermManagedHookCommand.installArguments(for: .codex)
        == ["agent", "install-hook", "codex"]
    )
  }

  @Test
  func managedCommandDetectionMatchesAnySupatermCommand() {
    let managedCommand = "echo SUPATERM bridge"
    let unmanagedCommand = "echo terminal bridge"

    #expect(
      AgentHookCommandOwnership.isSupatermManagedCommand(
        SupatermManagedHookCommand.receiveHookCommand(for: .claude, eventName: .notification)
      )
    )
    #expect(AgentHookCommandOwnership.isSupatermManagedCommand(managedCommand))
    #expect(
      !AgentHookCommandOwnership.isSupatermManagedCommand(unmanagedCommand)
    )
  }
}

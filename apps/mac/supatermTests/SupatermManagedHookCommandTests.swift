import Foundation
import Testing

@testable import SupatermCLIShared

struct SupatermManagedHookCommandTests {
  @Test
  func receiveHookCommandMatchesClaudeSettingsCommand() {
    #expect(
      SupatermManagedHookCommand.receiveHookCommand(for: .claude)
        == SupatermClaudeHookSettings.command
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
  func managedCommandDetectionRequiresExactCanonicalCommand() {
    let nonCanonicalCommand =
      #"[ -n "${SUPATERM_CLI_PATH:-}" ] && "$SUPATERM_CLI_PATH" "#
      + #"agent receive-agent-hook --agent claude --extra || true"#

    #expect(
      AgentHookCommandOwnership.isSupatermManagedCommand(
        SupatermManagedHookCommand.receiveHookCommand(for: .claude)
      )
    )
    #expect(
      !AgentHookCommandOwnership.isSupatermManagedCommand(nonCanonicalCommand)
    )
  }
}

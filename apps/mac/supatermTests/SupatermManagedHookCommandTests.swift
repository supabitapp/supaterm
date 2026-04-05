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
  func managedCommandDetectionMatchesAnySupatermCommand() {
    let managedCommand = "echo SUPATERM bridge"
    let unmanagedCommand = "echo terminal bridge"

    #expect(
      AgentHookCommandOwnership.isSupatermManagedCommand(
        SupatermManagedHookCommand.receiveHookCommand(for: .claude)
      )
    )
    #expect(AgentHookCommandOwnership.isSupatermManagedCommand(managedCommand))
    #expect(
      !AgentHookCommandOwnership.isSupatermManagedCommand(unmanagedCommand)
    )
  }
}

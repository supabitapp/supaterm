import Foundation

public enum SupatermManagedHookCommand {
  public static func receiveHookCommand(for agent: SupatermAgentKind) -> String {
    #"[ -n "${SUPATERM_CLI_PATH:-}" ] && "$SUPATERM_CLI_PATH" agent receive-agent-hook --agent \#(agent.rawValue) || true"#
  }

  public static func installArguments(for agent: SupatermAgentKind) -> [String] {
    ["agent", "install-hook", agent.rawValue]
  }

  static func isManagedCommand(_ command: String?) -> Bool {
    guard let normalizedCommand = normalized(command) else {
      return false
    }
    return SupatermAgentKind.allCases.contains { agent in
      normalizedCommand == normalized(receiveHookCommand(for: agent))
    }
  }

  private static func normalized(_ command: String?) -> String? {
    guard let command else {
      return nil
    }
    let trimmed = command.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
      return nil
    }
    return trimmed
  }
}

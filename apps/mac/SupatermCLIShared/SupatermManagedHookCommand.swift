import Foundation

public enum SupatermManagedHookCommand {
  public static func receiveHookCommand(for agent: SupatermAgentKind) -> String {
    #"[ -n "${SUPATERM_CLI_PATH:-}" ] && \#(receiveAgentHookCommand(for: agent)) || true"#
  }

  public static func receiveHookCommand(
    for agent: SupatermAgentKind,
    eventName: SupatermAgentHookEventName
  ) -> String {
    guard let fallbackBody = fallbackNotificationBody(for: eventName) else {
      return receiveHookCommand(for: agent)
    }
    return #"""
if [ -n "${SUPATERM_CLI_PATH:-}" ]; then \#(receiveAgentHookCommand(for: agent)); else \#(terminalNotificationCommand(title: agent.notificationTitle, body: fallbackBody)); fi || true
"""#
  }

  public static func installArguments(for agent: SupatermAgentKind) -> [String] {
    ["agent", "install-hook", agent.rawValue]
  }

  static func isManagedCommand(_ command: String?) -> Bool {
    guard let normalizedCommand = normalized(command) else {
      return false
    }
    return normalizedCommand.lowercased().contains("supaterm")
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

  private static func receiveAgentHookCommand(for agent: SupatermAgentKind) -> String {
    #""$SUPATERM_CLI_PATH" agent receive-agent-hook --agent \#(agent.rawValue)"#
  }

  private static func terminalNotificationCommand(title: String, body: String) -> String {
    #"printf '\033]777;notify;%s;%s\a' \#(shellSingleQuoted(title)) \#(shellSingleQuoted(body))"#
  }

  private static func fallbackNotificationBody(for eventName: SupatermAgentHookEventName) -> String? {
    switch eventName {
    case .notification:
      return "Needs input"
    case .stop:
      return "Turn complete"
    case .postToolUse, .preToolUse, .sessionEnd, .sessionStart, .unsupported(_), .userPromptSubmit:
      return nil
    }
  }

  private static func shellSingleQuoted(_ value: String) -> String {
    "'\(value.replacingOccurrences(of: "'", with: "'\"'\"'"))'"
  }
}

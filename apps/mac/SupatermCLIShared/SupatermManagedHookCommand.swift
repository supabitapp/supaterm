import Foundation

public enum SupatermManagedHookCommand {
  public static func receiveHookCommand(for agent: SupatermAgentKind) -> String {
    #"[ -n "${SUPATERM_CLI_PATH:-}" ] && "$SUPATERM_CLI_PATH" agent receive-agent-hook --agent \#(agent.rawValue) || true"#
  }

  public static func receiveHookCommand(
    for agent: SupatermAgentKind,
    eventName: SupatermAgentHookEventName
  ) -> String {
    guard let fallbackCommand = terminalNotificationCommand(for: agent, eventName: eventName) else {
      return receiveHookCommand(for: agent)
    }
    return #"""
if [ -n "${SUPATERM_CLI_PATH:-}" ]; then "$SUPATERM_CLI_PATH" agent receive-agent-hook --agent \#(agent.rawValue); else \#(fallbackCommand); fi || true
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

  private static func terminalNotificationCommand(
    for agent: SupatermAgentKind,
    eventName: SupatermAgentHookEventName
  ) -> String? {
    guard let fallback = fallbackNotification(for: agent, eventName: eventName) else {
      return nil
    }
    return #"printf '\033]777;notify;%s;%s\a' \#(shellSingleQuoted(fallback.title)) \#(shellSingleQuoted(fallback.body))"#
  }

  private static func fallbackNotification(
    for agent: SupatermAgentKind,
    eventName: SupatermAgentHookEventName
  ) -> (title: String, body: String)? {
    switch eventName {
    case .notification:
      return (agent.notificationTitle, "Needs input")
    case .stop:
      return (agent.notificationTitle, "Turn complete")
    case .postToolUse, .preToolUse, .sessionEnd, .sessionStart, .unsupported(_), .userPromptSubmit:
      return nil
    }
  }

  private static func shellSingleQuoted(_ value: String) -> String {
    "'\(value.replacingOccurrences(of: "'", with: "'\"'\"'"))'"
  }
}

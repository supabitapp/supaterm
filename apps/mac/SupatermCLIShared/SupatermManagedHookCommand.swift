import Foundation

public enum SupatermManagedHookCommand {
  public static func receiveHookCommand(for agent: SupatermAgentKind) -> String {
    [
      "if \(localCommandCondition); then",
      localReceiveHookCommand(for: agent),
      "elif \(remoteCommandCondition); then",
      remoteReceiveHookCommand(for: agent),
      "else",
      "true;",
      "fi",
    ].joined(separator: " ")
  }

  public static func installArguments(for agent: SupatermAgentKind) -> [String] {
    ["agent", "install-hook", agent.rawValue]
  }

  static let localCommandCondition =
    #"[ -n "${SUPATERM_SOCKET_PATH:-}" ] && [ -n "${SUPATERM_CLI_PATH:-}" ]"#

  static let remoteCommandCondition =
    #"[ "${SUPATERM_REMOTE_NOTIFICATIONS:-}" = "1" ] || [ -n "${SSH_CONNECTION:-}" ] || [ -n "${SSH_TTY:-}" ]"#

  static func localReceiveHookCommand(for agent: SupatermAgentKind) -> String {
    #""${SUPATERM_CLI_PATH}" agent receive-agent-hook --agent \#(agent.rawValue) || true;"#
  }

  static func remoteReceiveHookCommand(for agent: SupatermAgentKind) -> String {
    #"python3 -c \#(shellQuoted(remoteNotificationPythonSource())) \#(shellQuoted(agent.notificationTitle)) || true;"#
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

  private static func remoteNotificationPythonSource() -> String {
    [
      "import json, re, sys",
      "event = json.load(sys.stdin)",
      "if event.get(\"hook_event_name\") not in (\"Notification\", \"Stop\"):",
      "    raise SystemExit(0)",
      "def clean(value):",
      "    if not isinstance(value, str):",
      "        return \"\"",
      "    value = re.sub(r\"[\\x00-\\x1f\\x7f\\x9b;]+\", \" \", value)",
      "    value = re.sub(r\"\\s+\", \" \", value).strip()",
      "    return value",
      "agent_title = clean(sys.argv[1])",
      "title = clean(event.get(\"title\")) or agent_title",
      "body = clean(event.get(\"message\") or event.get(\"last_assistant_message\"))",
      "if not body:",
      "    raise SystemExit(0)",
      "sys.stdout.write(f\"\\033]777;notify;{title};{body}\\a\")",
    ].joined(separator: "\n")
  }

  private static func shellQuoted(_ value: String) -> String {
    "'" + value.replacingOccurrences(of: "'", with: #"'\"'\"'"#) + "'"
  }
}

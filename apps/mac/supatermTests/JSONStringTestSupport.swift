import Foundation
import Testing

func jsonStringLiteral(_ value: String) throws -> String {
  let data = try JSONEncoder().encode(value)
  return try #require(String(data: data, encoding: .utf8))
}

func expectedManagedNotificationCommand(agent: String, title: String, body: String) -> String {
  #"if [ -n "${SUPATERM_CLI_PATH:-}" ]; then "$SUPATERM_CLI_PATH" agent receive-agent-hook --agent "#
    + agent
    + #"; else printf '\033]777;notify;%s;%s\a' "#
    + "'\(title)'"
    + " "
    + "'\(body)'"
    + "; fi || true"
}

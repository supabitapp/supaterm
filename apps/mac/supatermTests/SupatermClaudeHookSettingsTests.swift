import Foundation
import Testing

@testable import SPCLI

struct SupatermClaudeHookSettingsTests {
  @Test
  func commandStaysStable() {
    #expect(
      SPClaudeHookSettings.command
        == #"[ -n "${SUPATERM_CLI_PATH:-}" ] && "$SUPATERM_CLI_PATH" claude-hook || true"#
    )
  }

  @Test
  func jsonIncludesAllHookEventsAndTimeouts() throws {
    let object =
      try JSONSerialization.jsonObject(
        with: Data(SPClaudeHookSettings.jsonString().utf8)
      ) as? [String: Any]
    let hooks = try #require(object?["hooks"] as? [String: [[String: Any]]])

    #expect(
      Set(hooks.keys) == ["Notification", "PreToolUse", "SessionEnd", "SessionStart", "Stop", "UserPromptSubmit"])
    #expect(try commandHook(in: hooks, event: "Notification")["timeout"] as? Int == 10)
    #expect(try commandHook(in: hooks, event: "PreToolUse")["timeout"] as? Int == 5)
    #expect(try commandHook(in: hooks, event: "PreToolUse")["async"] as? Bool == true)
    #expect(try commandHook(in: hooks, event: "SessionEnd")["timeout"] as? Int == 1)
    #expect(try commandHook(in: hooks, event: "SessionStart")["timeout"] as? Int == 10)
    #expect(try commandHook(in: hooks, event: "Stop")["timeout"] as? Int == 10)
    #expect(try commandHook(in: hooks, event: "UserPromptSubmit")["timeout"] as? Int == 10)
    #expect(
      try commandHook(in: hooks, event: "Notification")["command"] as? String == SPClaudeHookSettings.command)
  }
}

private func commandHook(
  in hooks: [String: [[String: Any]]],
  event: String
) throws -> [String: Any] {
  let groups = try #require(hooks[event])
  let group = try #require(groups.first)
  let commandHooks = try #require(group["hooks"] as? [[String: Any]])
  return try #require(commandHooks.first)
}

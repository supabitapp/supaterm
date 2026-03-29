import Foundation
import Testing

@testable import SupatermCLIShared

struct SupatermCodexHookSettingsTests {
  @Test
  func commandStaysStable() {
    #expect(
      SupatermCodexHookSettings.command
        == #"[ -n "${SUPATERM_CLI_PATH:-}" ] && "$SUPATERM_CLI_PATH" agent-hook --agent codex || true"#
    )
  }

  @Test
  func jsonIncludesExpectedHookEventsMatchersAndTimeouts() throws {
    let object =
      try JSONSerialization.jsonObject(
        with: Data(SupatermCodexHookSettings.jsonString().utf8)
      ) as? [String: Any]
    let hooks = try #require(object?["hooks"] as? [String: [[String: Any]]])

    #expect(Set(hooks.keys) == ["PreToolUse", "SessionStart", "Stop", "UserPromptSubmit"])
    #expect(try commandHook(in: hooks, event: "PreToolUse")["timeout"] as? Int == 5)
    #expect(try commandHook(in: hooks, event: "SessionStart")["timeout"] as? Int == 10)
    #expect(try commandHook(in: hooks, event: "Stop")["timeout"] as? Int == 10)
    #expect(try commandHook(in: hooks, event: "UserPromptSubmit")["timeout"] as? Int == 10)
    #expect(try group(in: hooks, event: "PreToolUse")["matcher"] as? String == "Bash")
    #expect(try group(in: hooks, event: "SessionStart")["matcher"] as? String == "startup|resume")
  }
}

private func group(
  in hooks: [String: [[String: Any]]],
  event: String
) throws -> [String: Any] {
  let groups = try #require(hooks[event])
  return try #require(groups.first)
}

private func commandHook(
  in hooks: [String: [[String: Any]]],
  event: String
) throws -> [String: Any] {
  let group = try group(in: hooks, event: event)
  let commandHooks = try #require(group["hooks"] as? [[String: Any]])
  return try #require(commandHooks.first)
}

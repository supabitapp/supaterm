import Foundation
import Testing

@testable import SupatermCLIShared

struct SupatermClaudeHookSettingsTests {
  @Test
  func commandStaysStableForNotificationAndStopFallbacks() {
    let notificationCommand = SupatermClaudeHookSettings.command(for: .notification)
    let expectedNotification = expectedManagedNotificationCommand(
      agent: "claude",
      title: "Claude Code",
      body: "Needs input"
    )
    let stopCommand = SupatermClaudeHookSettings.command(for: .stop)
    let expectedStop = expectedManagedNotificationCommand(
      agent: "claude",
      title: "Claude Code",
      body: "Turn complete"
    )

    #expect(
      notificationCommand == expectedNotification
    )
    #expect(
      stopCommand == expectedStop
    )
  }

  @Test
  func jsonIncludesAllHookEventsAndTimeouts() throws {
    let object =
      try JSONSerialization.jsonObject(
        with: Data(SupatermClaudeHookSettings.jsonString().utf8)
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
      try commandHook(in: hooks, event: "Notification")["command"] as? String
        == SupatermClaudeHookSettings.command(for: .notification)
    )
    #expect(
      try commandHook(in: hooks, event: "PreToolUse")["command"] as? String
        == SupatermClaudeHookSettings.command(for: .preToolUse)
    )
    #expect(
      try commandHook(in: hooks, event: "Stop")["command"] as? String
        == SupatermClaudeHookSettings.command(for: .stop)
    )
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

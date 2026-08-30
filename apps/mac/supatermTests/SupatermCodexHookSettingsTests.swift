import Foundation
import Testing

@testable import SupatermCLIShared

struct SupatermCodexHookSettingsTests {
  @Test
  func commandUsesAbsoluteEscapedBridgePath() {
    let homeDirectoryURL = URL(fileURLWithPath: "/tmp/Codex user's home", isDirectory: true)
    let path = #"'/tmp/Codex user'"'"'s home/.codex/supaterm-agent-state.sh'"#
    let command = #"exec /bin/sh -c 'if [ -r "$1" ]; then exec /bin/sh "$1"; else cat >/dev/null; fi' _ \#(path)"#

    #expect(
      SupatermCodexHookSettings.command(homeDirectoryURL: homeDirectoryURL)
        == command
    )
  }

  @Test
  func jsonIncludesExpectedHookEventsMatchersAndTimeouts() throws {
    let homeDirectoryURL = URL(fileURLWithPath: "/tmp/codex-home", isDirectory: true)
    let command = SupatermCodexHookSettings.command(homeDirectoryURL: homeDirectoryURL)
    let object =
      try JSONSerialization.jsonObject(
        with: Data(
          SupatermCodexHookSettings.jsonString(homeDirectoryURL: homeDirectoryURL).utf8
        )
      ) as? [String: Any]
    let hooks = try #require(object?["hooks"] as? [String: [[String: Any]]])

    #expect(
      Set(hooks.keys) == [
        "PermissionRequest",
        "PostToolUse",
        "PreToolUse",
        "SessionStart",
        "Stop",
        "SubagentStart",
        "SubagentStop",
        "UserPromptSubmit",
      ]
    )
    #expect(try commandHook(in: hooks, event: "PermissionRequest")["timeout"] as? Int == 5)
    #expect(try commandHook(in: hooks, event: "PostToolUse")["timeout"] as? Int == 5)
    #expect(try commandHook(in: hooks, event: "PreToolUse")["timeout"] as? Int == 5)
    #expect(try commandHook(in: hooks, event: "SessionStart")["timeout"] as? Int == 10)
    #expect(try commandHook(in: hooks, event: "Stop")["timeout"] as? Int == 10)
    #expect(try commandHook(in: hooks, event: "SubagentStart")["timeout"] as? Int == 10)
    #expect(try commandHook(in: hooks, event: "SubagentStop")["timeout"] as? Int == 10)
    #expect(try commandHook(in: hooks, event: "UserPromptSubmit")["timeout"] as? Int == 10)
    #expect(try group(in: hooks, event: "PermissionRequest")["matcher"] == nil)
    #expect(try group(in: hooks, event: "PostToolUse")["matcher"] == nil)
    #expect(try group(in: hooks, event: "PreToolUse")["matcher"] as? String == "request_user_input")
    #expect(try group(in: hooks, event: "SessionStart")["matcher"] == nil)
    #expect(try group(in: hooks, event: "SubagentStart")["matcher"] == nil)
    #expect(try group(in: hooks, event: "SubagentStop")["matcher"] == nil)
    for event in hooks.keys {
      #expect(try commandHook(in: hooks, event: event)["command"] as? String == command)
    }
  }

  @Test
  func nativeHookIdentityIncludesInstalledBridgePath() {
    let first = URL(fileURLWithPath: "/tmp/first", isDirectory: true)
    let second = URL(fileURLWithPath: "/tmp/second", isDirectory: true)

    #expect(
      SupatermCodexHookSettings.nativeHookIdentities(homeDirectoryURL: first)
        != SupatermCodexHookSettings.nativeHookIdentities(homeDirectoryURL: second)
    )
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

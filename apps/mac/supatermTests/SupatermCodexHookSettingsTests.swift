import Foundation
import Testing

@testable import SupatermCLIShared

struct SupatermCodexHookSettingsTests {
  @Test
  func commandUsesAbsoluteEscapedCLIPath() throws {
    let cliPath = "/Applications/Supaterm user's app/Contents/MacOS/sp"
    let path = #"'/Applications/Supaterm user'"'"'s app/Contents/MacOS/sp'"#
    let command =
      #"exec /bin/sh -c 'if [ -x "$1" ]; then "$1" agent receive-agent-hook --agent codex "#
      + #"--pid "$PPID" && exit 0; fi; /bin/cat >/dev/null' supaterm-codex-hook-v1 \#(path)"#

    #expect(try SupatermCodexHookSettings.command(cliPath: cliPath) == command)
  }

  @Test(arguments: ["", " \n\t", "relative/sp", "/tmp/not-sp"])
  func commandRejectsInvalidCLIPath(cliPath: String) {
    #expect(throws: SupatermManagedHookCommandError.invalidCLIPath) {
      try SupatermCodexHookSettings.command(cliPath: cliPath)
    }
  }

  @Test
  func jsonIncludesExpectedHookEventsMatchersAndTimeouts() throws {
    let cliPath = "/tmp/Supaterm.app/Contents/MacOS/sp"
    let command = try SupatermCodexHookSettings.command(cliPath: cliPath)
    let object =
      try JSONSerialization.jsonObject(
        with: Data(SupatermCodexHookSettings.jsonString(cliPath: cliPath).utf8)
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
  func nativeHookIdentityIncludesInstalledCLIPath() throws {
    #expect(
      try SupatermCodexHookSettings.nativeHookIdentities(cliPath: "/tmp/first/sp")
        != SupatermCodexHookSettings.nativeHookIdentities(cliPath: "/tmp/second/sp")
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

import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

struct ClaudeToolActivityTests {
  @Test
  func detailPairsToolNameWithSubject() {
    #expect(
      ClaudeToolActivity.detail(
        toolName: "Bash",
        toolInput: .object(["command": .string("git status"), "description": .string("Status")])
      ) == "Bash: git status"
    )
    #expect(
      ClaudeToolActivity.detail(
        toolName: "Grep",
        toolInput: .object(["pattern": .string("ghostty_surface"), "path": .string("/tmp")])
      ) == "Grep: ghostty_surface"
    )
    #expect(
      ClaudeToolActivity.detail(
        toolName: "Agent",
        toolInput: .object(["description": .string("Map subagent meta code")])
      ) == "Agent: Map subagent meta code"
    )
  }

  @Test
  func detailShowsFileNameForPaths() {
    #expect(
      ClaudeToolActivity.detail(
        toolName: "Read",
        toolInput: .object(["file_path": .string("/repo/apps/mac/supaterm/App/Feature.swift")])
      ) == "Read: Feature.swift"
    )
  }

  @Test
  func detailFallsBackToToolName() {
    #expect(
      ClaudeToolActivity.detail(
        toolName: "TodoWrite",
        toolInput: .object(["todos": .array([])])
      ) == "TodoWrite"
    )
    #expect(ClaudeToolActivity.detail(toolName: "Bash", toolInput: nil) == "Bash")
    #expect(ClaudeToolActivity.detail(toolName: nil, toolInput: nil) == nil)
  }

  @Test
  func detailNormalizesAndTruncatesSubjects() {
    let command = "for pane in $(sp pane list); do " + String(repeating: "echo $pane; ", count: 20)
    let detail = ClaudeToolActivity.detail(
      toolName: "Bash",
      toolInput: .object(["command": .string("  \(command)\n")])
    )
    #expect(detail == "Bash: " + String(command.prefix(120)) + "…")
    #expect(
      ClaudeToolActivity.detail(
        toolName: "Bash",
        toolInput: .object(["command": .string(" \n ")])
      ) == "Bash"
    )
  }
}

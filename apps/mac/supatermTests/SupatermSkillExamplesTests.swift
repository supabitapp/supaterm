import ArgumentParser
import Foundation
import Testing

@testable import SPCLI

struct SupatermSkillExamplesTests {
  @Test
  func supatermSkillExamplesParseAsDocumented() throws {
    for fileURL in skillMarkdownFiles() {
      for command in try documentedCommands(in: fileURL) {
        let arguments = try shellSplit(normalizedCommand(command))
        let rootArguments = Array(arguments.dropFirst())

        do {
          _ = try SP.parseAsRoot(rootArguments)
        } catch {
          Issue.record(
            """
            Failed to parse \(command)
            File: \(fileURL.path)
            Parsed arguments: \(rootArguments)
            Error: \(error)
            """
          )
        }
      }
    }
  }

  private func skillMarkdownFiles(filePath: StaticString = #filePath) -> [URL] {
    let root = URL(fileURLWithPath: "\(filePath)")
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .appendingPathComponent("integrations/supaterm-skills/skills/supaterm")

    return [
      root.appendingPathComponent("SKILL.md"),
      root.appendingPathComponent("references/agent.md"),
      root.appendingPathComponent("references/pane.md"),
      root.appendingPathComponent("references/space.md"),
      root.appendingPathComponent("references/tab.md"),
      root.appendingPathComponent("references/targeting-and-selectors.md"),
    ]
  }

  private func documentedCommands(in fileURL: URL) throws -> [String] {
    let markdown = try String(contentsOf: fileURL, encoding: .utf8)
    let blocks = markdown.matches(of: /```bash\n(.*?)```/).map(\.output.1)
    return
      blocks
      .flatMap { mergedCommandLines(in: String($0)) }
      .filter { $0.hasPrefix("sp ") || $0.contains("| sp ") }
  }

  private func mergedCommandLines(in block: String) -> [String] {
    var commands: [String] = []
    var buffer = ""

    for rawLine in block.split(separator: "\n", omittingEmptySubsequences: false) {
      let line = String(rawLine).trimmingCharacters(in: .newlines)
      if line.isEmpty {
        if !buffer.isEmpty {
          commands.append(buffer)
          buffer = ""
        }
        continue
      }

      if buffer.isEmpty {
        buffer = line
      } else {
        buffer += line.trimmingCharacters(in: .whitespaces)
      }

      if buffer.hasSuffix("\\") {
        buffer.removeLast()
        buffer += " "
      } else {
        commands.append(buffer)
        buffer = ""
      }
    }

    if !buffer.isEmpty {
      commands.append(buffer)
    }

    return commands
  }

  private func normalizedCommand(_ command: String) -> String {
    let rewrittenCommand: String
    if let pipeRange = command.range(of: "| sp ") {
      rewrittenCommand = "sp " + command[pipeRange.upperBound...]
    } else {
      rewrittenCommand = command
    }

    return
      rewrittenCommand
      .replacingOccurrences(of: "<space-uuid>", with: "11111111-1111-4111-8111-111111111111")
      .replacingOccurrences(of: "<tab-uuid>", with: "22222222-2222-4222-8222-222222222222")
      .replacingOccurrences(of: "<pane-uuid>", with: "33333333-3333-4333-8333-333333333333")
  }

  private func shellSplit(_ command: String) throws -> [String] {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/zsh")
    process.arguments = [
      "-fc",
      "cmd=$1; for arg in ${(z)cmd}; do print -r -- \"$arg\"; done",
      "--",
      command,
    ]

    let stdout = Pipe()
    let stderr = Pipe()
    process.standardOutput = stdout
    process.standardError = stderr
    try process.run()
    process.waitUntilExit()

    let outputData = stdout.fileHandleForReading.readDataToEndOfFile()
    let output = try #require(String(bytes: outputData, encoding: .utf8))
    if process.terminationStatus != 0 {
      let errorData = stderr.fileHandleForReading.readDataToEndOfFile()
      let error = try #require(String(bytes: errorData, encoding: .utf8))
      throw NSError(
        domain: "SupatermSkillExamplesTests", code: Int(process.terminationStatus),
        userInfo: [
          NSLocalizedDescriptionKey: error.isEmpty ? "zsh failed to split command" : error
        ])
    }

    return
      output
      .split(separator: "\n", omittingEmptySubsequences: false)
      .map { String($0) }
      .filter { !$0.isEmpty }
  }
}

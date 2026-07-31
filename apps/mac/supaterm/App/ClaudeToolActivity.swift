import Foundation
import SupatermCLIShared

nonisolated enum ClaudeToolActivity {
  static func detail(toolName: String?, toolInput: JSONValue?) -> String? {
    guard let toolName else { return nil }
    guard let subject = subject(in: toolInput) else { return toolName }
    return "\(toolName): \(subject)"
  }

  private static let subjectKeys = [
    "command", "file_path", "pattern", "query", "url", "description", "prompt", "skill",
  ]
  private static let maxSubjectLength = 120

  private static func subject(in input: JSONValue?) -> String? {
    guard let object = input?.objectValue else { return nil }
    for key in subjectKeys {
      guard let value = AgentProgressParsing.normalizedTitle(object[key]?.stringValue) else {
        continue
      }
      let subject =
        value.hasPrefix("/") && !value.contains(" ")
        ? URL(fileURLWithPath: value).lastPathComponent
        : value
      guard subject.count > maxSubjectLength else { return subject }
      return String(subject.prefix(maxSubjectLength)) + "…"
    }
    return nil
  }
}

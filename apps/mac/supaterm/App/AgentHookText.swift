import Foundation

nonisolated enum AgentHookText {
  static func normalized(_ value: String?) -> String? {
    guard let value else { return nil }
    let normalized =
      value
      .components(separatedBy: .whitespacesAndNewlines)
      .filter { !$0.isEmpty }
      .joined(separator: " ")
    return normalized.isEmpty ? nil : normalized
  }
}

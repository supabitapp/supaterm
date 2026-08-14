import Foundation

public struct AgentDetectionInput: Equatable, Sendable {
  public let screen: String
  public let oscTitle: String
  public let oscProgress: String

  public init(screen: String, oscTitle: String, oscProgress: String = "") {
    self.screen = screen
    self.oscTitle = oscTitle
    self.oscProgress = oscProgress
  }
}

public struct AgentDetectionMatch: Equatable, Sendable {
  public let result: AgentDetectionRuleResult
  public let ruleID: String
  public let visibleIdle: Bool

  public init(
    result: AgentDetectionRuleResult,
    ruleID: String,
    visibleIdle: Bool = false
  ) {
    self.result = result
    self.ruleID = ruleID
    self.visibleIdle = visibleIdle
  }
}

struct AgentDetectionMatcher {
  static let fallbackRuleID = "default_known_agent_idle_fallback"

  private let rules: [CompiledRule]

  init(agent: AgentDetectionAgentRule) throws {
    rules = try agent.rules.map(CompiledRule.init)
  }

  func match(_ input: AgentDetectionInput) -> AgentDetectionMatch {
    var best: CompiledRule?
    for rule in rules where rule.matches(input) {
      if let currentBest = best {
        if rule.priority > currentBest.priority {
          best = rule
        }
      } else {
        best = rule
      }
    }
    guard let best else {
      return AgentDetectionMatch(
        result: .idle,
        ruleID: Self.fallbackRuleID
      )
    }
    return AgentDetectionMatch(
      result: best.result,
      ruleID: best.id,
      visibleIdle: best.visibleIdle
    )
  }
}

private struct CompiledRule {
  let id: String
  let result: AgentDetectionRuleResult
  let priority: Int
  let region: AgentDetectionRegion
  let visibleIdle: Bool
  let gate: CompiledGate

  init(_ rule: AgentDetectionStateRule) throws {
    id = rule.id
    result = rule.result
    priority = rule.priority
    region = rule.region
    visibleIdle = rule.visibleIdle
    gate = try CompiledGate(rule.gate)
  }

  func matches(_ input: AgentDetectionInput) -> Bool {
    gate.matches(region.text(in: input))
  }
}

private struct CompiledGate {
  let contains: [String]
  let regex: [CompiledRegularExpression]
  let lineRegex: [CompiledRegularExpression]
  let all: [CompiledGate]
  let any: [CompiledGate]
  let not: [CompiledGate]

  init(_ gate: AgentDetectionGate) throws {
    contains = gate.contains.map { $0.lowercased() }
    regex = try gate.regex.map(CompiledRegularExpression.init)
    lineRegex = try gate.lineRegex.map(CompiledRegularExpression.init)
    all = try gate.all.map(CompiledGate.init)
    any = try gate.any.map(CompiledGate.init)
    not = try gate.not.map(CompiledGate.init)
  }

  func matches(_ text: String) -> Bool {
    let lowercaseText = text.lowercased()
    return contains.allSatisfy(lowercaseText.contains)
      && regex.allSatisfy { $0.matches(text) }
      && lineRegex.allSatisfy { expression in
        text.agentDetectionLines.contains { expression.matches($0) }
      }
      && all.allSatisfy { $0.matches(text) }
      && (any.isEmpty || any.contains { $0.matches(text) })
      && !not.contains { $0.matches(text) }
  }
}

private struct CompiledRegularExpression {
  private let value: NSRegularExpression

  init(_ pattern: String) throws {
    value = try NSRegularExpression(pattern: pattern)
  }

  func matches(_ string: String) -> Bool {
    value.firstMatch(
      in: string,
      range: NSRange(string.startIndex..<string.endIndex, in: string)
    ) != nil
  }
}

extension AgentDetectionRegion {
  fileprivate func text(in input: AgentDetectionInput) -> String {
    switch self {
    case .wholeRecent:
      input.screen
    case .bottomNonEmptyLines(let count):
      input.screen.agentDetectionBottomNonEmptyLines(count)
    case .topNonEmptyLines(let count):
      input.screen.agentDetectionTopNonEmptyLines(count)
    case .afterLastPromptMarker:
      input.screen.agentDetectionAfterLastPromptMarker
    case .promptBoxBody:
      input.screen.agentDetectionPromptBoxBody
    case .afterLastHorizontalRule:
      input.screen.agentDetectionAfterLastHorizontalRule
    case .oscTitle:
      input.oscTitle
    case .oscProgress:
      input.oscProgress
    }
  }
}

extension String {
  fileprivate var agentDetectionLines: [String] {
    split(separator: "\n", omittingEmptySubsequences: false).map { value in
      value.last == "\r" ? String(value.dropLast()) : String(value)
    }
  }

  fileprivate func agentDetectionBottomNonEmptyLines(_ count: Int) -> String {
    let lines = agentDetectionLines
    guard
      let start = lines.indices.reversed().filter({ !lines[$0].agentDetectionTrimmed.isEmpty })
        .prefix(count).last
    else {
      return ""
    }
    return lines[start...].joined(separator: "\n")
  }

  fileprivate func agentDetectionTopNonEmptyLines(_ count: Int) -> String {
    let lines = agentDetectionLines
    guard
      let end = lines.indices.filter({ !lines[$0].agentDetectionTrimmed.isEmpty })
        .prefix(count).last
    else {
      return ""
    }
    return lines[...end].joined(separator: "\n")
  }

  fileprivate var agentDetectionAfterLastPromptMarker: String {
    let lines = agentDetectionLines
    guard let prompt = lines.lastIndex(where: { $0 == "›" || $0.hasPrefix("› ") }) else {
      return self
    }
    return lines.dropFirst(prompt + 1).joined(separator: "\n")
  }

  fileprivate var agentDetectionPromptBoxBody: String {
    let lines = agentDetectionLines
    let borders = lines.indices.filter { lines[$0].agentDetectionIsHorizontalRule }
    guard borders.count >= 2 else { return "" }
    let top = borders[borders.count - 2]
    let end = lines[(top + 1)...].firstIndex { $0.agentDetectionIsHorizontalRule } ?? lines.endIndex
    return lines[(top + 1)..<end].joined(separator: "\n")
  }

  fileprivate var agentDetectionAfterLastHorizontalRule: String {
    let lines = agentDetectionLines
    guard let border = lines.lastIndex(where: \.agentDetectionIsHorizontalRule) else {
      return self
    }
    return lines.dropFirst(border + 1).joined(separator: "\n")
  }

  fileprivate var agentDetectionTrimmed: String {
    trimmingCharacters(in: .whitespacesAndNewlines)
  }

  fileprivate var agentDetectionIsHorizontalRule: Bool {
    let value = agentDetectionTrimmed
    guard !value.isEmpty else { return false }
    let count = value.prefix { $0 == "─" }.count
    guard count > 0 else { return false }
    let suffix = value.dropFirst(count).drop { $0.isWhitespace }
    return suffix.isEmpty || count >= 3
  }
}

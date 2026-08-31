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

public struct AgentDetectionSignalInput: Equatable, Sendable {
  public let oscTitle: String
  public let oscProgress: String

  public init(oscTitle: String, oscProgress: String = "") {
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
  static let fallbackRuleID = "default_known_agent_unknown_fallback"

  private let rules: [CompiledRule]

  init(agent: AgentDetectionAgentRule) throws {
    var ordered: [(index: Int, rule: CompiledRule)] = []
    for (index, rule) in agent.rules.enumerated() {
      ordered.append((index, try CompiledRule(rule)))
    }
    ordered.sort {
      $0.rule.priority == $1.rule.priority
        ? $0.index < $1.index
        : $0.rule.priority > $1.rule.priority
    }
    rules = ordered.map(\.rule)
  }

  func matchSignals(_ input: AgentDetectionSignalInput) -> AgentDetectionSignalResult {
    let input = PreparedInput(
      AgentDetectionInput(
        screen: "",
        oscTitle: input.oscTitle,
        oscProgress: input.oscProgress
      )
    )
    for rule in rules {
      guard !rule.region.requiresScreen else { return .needsScreen }
      if rule.matches(input) { return .matched(rule.match) }
    }
    return .matched(Self.fallbackMatch)
  }

  func match(_ input: AgentDetectionInput) -> AgentDetectionMatch {
    let input = PreparedInput(input)
    for rule in rules where rule.matches(input) {
      return rule.match
    }
    return Self.fallbackMatch
  }

  private static var fallbackMatch: AgentDetectionMatch {
    AgentDetectionMatch(
      result: .unknown,
      ruleID: fallbackRuleID
    )
  }
}

enum AgentDetectionSignalResult: Equatable, Sendable {
  case matched(AgentDetectionMatch)
  case needsScreen
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

  var match: AgentDetectionMatch {
    AgentDetectionMatch(
      result: result,
      ruleID: id,
      visibleIdle: visibleIdle
    )
  }

  func matches(_ input: PreparedInput) -> Bool {
    gate.matches(input.text(in: region))
  }
}

private struct CompiledGate {
  let contains: [CompiledContains]
  let regex: [CompiledRegularExpression]
  let lineRegex: [CompiledRegularExpression]
  let all: [CompiledGate]
  let any: [CompiledGate]
  let not: [CompiledGate]

  init(_ gate: AgentDetectionGate) throws {
    contains = gate.contains.map(CompiledContains.init)
    regex = try gate.regex.map(CompiledRegularExpression.init)
    lineRegex = try gate.lineRegex.map(CompiledRegularExpression.init)
    all = try gate.all.map(CompiledGate.init)
    any = try gate.any.map(CompiledGate.init)
    not = try gate.not.map(CompiledGate.init)
  }

  func matches(_ text: PreparedText) -> Bool {
    guard contains.allSatisfy({ text.lowercase.contains($0.lowercase) }) else { return false }
    guard regex.allSatisfy({ $0.matches(text.raw) }) else { return false }
    guard
      lineRegex.allSatisfy({ expression in
        text.lines.contains { expression.matches($0) }
      })
    else {
      return false
    }
    guard all.allSatisfy({ $0.matches(text) }) else { return false }
    guard any.isEmpty || any.contains(where: { $0.matches(text) }) else { return false }
    return !not.contains(where: { $0.matches(text) })
  }

}

private struct CompiledContains {
  let lowercase: String

  init(_ pattern: String) {
    lowercase = pattern.lowercased()
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

private final class PreparedInput {
  private let input: AgentDetectionInput
  private let screen: PreparedScreen
  private var regions: [AgentDetectionRegion: PreparedText] = [:]

  init(_ input: AgentDetectionInput) {
    self.input = input
    screen = PreparedScreen(input.screen)
  }

  func text(in region: AgentDetectionRegion) -> PreparedText {
    if let text = regions[region] { return text }
    let text =
      switch region {
      case .wholeRecent:
        PreparedText(screen.raw, lines: { [screen] in screen.lines })
      case .bottomNonEmptyLines(let count):
        PreparedText(screen.lines.agentDetectionBottomNonEmptyLines(count))
      case .topNonEmptyLines(let count):
        PreparedText(screen.lines.agentDetectionTopNonEmptyLines(count))
      case .afterLastPromptMarker:
        PreparedText(screen.lines.agentDetectionAfterLastPromptMarker)
      case .promptBoxBody:
        PreparedText(screen.lines.agentDetectionPromptBoxBody)
      case .lastNonEmptyAbovePromptBox:
        PreparedText(screen.lines.agentDetectionLastNonEmptyAbovePromptBox)
      case .afterLastHorizontalRule:
        PreparedText(screen.lines.agentDetectionAfterLastHorizontalRule)
      case .oscTitle:
        PreparedText(input.oscTitle)
      case .oscProgress:
        PreparedText(input.oscProgress)
      }
    regions[region] = text
    return text
  }
}

private final class PreparedScreen {
  let raw: String
  lazy var lines = raw.agentDetectionLines

  init(_ raw: String) {
    self.raw = raw
  }
}

private final class PreparedText {
  let raw: String
  lazy var lowercase = raw.lowercased()
  lazy var lines = makeLines?() ?? raw.agentDetectionLines
  private let makeLines: (() -> [String])?

  init(_ raw: String, lines: (() -> [String])? = nil) {
    self.raw = raw
    makeLines = lines
  }
}

extension AgentDetectionRegion {
  fileprivate var requiresScreen: Bool {
    switch self {
    case .oscTitle, .oscProgress:
      false
    case .wholeRecent, .bottomNonEmptyLines, .topNonEmptyLines, .afterLastPromptMarker,
      .promptBoxBody, .lastNonEmptyAbovePromptBox, .afterLastHorizontalRule:
      true
    }
  }
}

extension String {
  fileprivate var agentDetectionLines: [String] {
    split(separator: "\n", omittingEmptySubsequences: false).map { value in
      value.last == "\r" ? String(value.dropLast()) : String(value)
    }
  }

  fileprivate var agentDetectionIsCodexPromptMarker: Bool {
    self == "›" || hasPrefix("› ") || self == "»" || hasPrefix("» ")
  }

}

extension Array where Element == String {
  fileprivate func agentDetectionBottomNonEmptyLines(_ count: Int) -> String {
    var start: Index?
    var remaining = count
    for index in indices.reversed() where !self[index].agentDetectionTrimmed.isEmpty {
      start = index
      remaining -= 1
      if remaining == 0 { break }
    }
    return start.map { self[$0...].joined(separator: "\n") } ?? ""
  }

  fileprivate func agentDetectionTopNonEmptyLines(_ count: Int) -> String {
    var end: Index?
    var remaining = count
    for index in indices where !self[index].agentDetectionTrimmed.isEmpty {
      end = index
      remaining -= 1
      if remaining == 0 { break }
    }
    return end.map { self[...$0].joined(separator: "\n") } ?? ""
  }

  fileprivate var agentDetectionAfterLastPromptMarker: String {
    guard let prompt = lastIndex(where: \.agentDetectionIsCodexPromptMarker) else {
      return joined(separator: "\n")
    }
    return dropFirst(prompt + 1).joined(separator: "\n")
  }

  fileprivate var agentDetectionPromptBoxBody: String {
    guard
      let top = agentDetectionPromptBoxTopBorder,
      let bottom = self[(top + 1)...].lastIndex(where: \.agentDetectionIsHorizontalRule)
    else { return "" }
    return self[(top + 1)..<bottom].joined(separator: "\n")
  }

  fileprivate var agentDetectionLastNonEmptyAbovePromptBox: String {
    let lines = agentDetectionPromptBoxTopBorder.map { self[..<$0] } ?? self[...]
    return lines.last(where: { !$0.agentDetectionTrimmed.isEmpty }) ?? ""
  }

  fileprivate var agentDetectionAfterLastHorizontalRule: String {
    guard let border = lastIndex(where: \.agentDetectionIsHorizontalRule) else {
      return joined(separator: "\n")
    }
    return dropFirst(border + 1).joined(separator: "\n")
  }

  private var agentDetectionPromptBoxTopBorder: Index? {
    guard let bottom = lastIndex(where: \.agentDetectionIsHorizontalRule) else { return nil }
    return self[..<bottom].lastIndex(where: \.agentDetectionIsHorizontalRule)
  }
}

extension String {
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

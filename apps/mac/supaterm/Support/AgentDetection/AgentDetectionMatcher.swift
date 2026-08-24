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

public struct AgentDetectionConditionEvidence: Equatable, Sendable {
  public let kind: String
  public let value: String?
  public let matched: Bool
  public let children: [AgentDetectionConditionEvidence]
}

public struct AgentDetectionRuleEvidence: Equatable, Sendable {
  public let ruleID: String
  public let result: AgentDetectionRuleResult
  public let priority: Int
  public let region: String
  public let matched: Bool
  public let condition: AgentDetectionConditionEvidence
}

public struct AgentDetectionMatcherExplanation: Equatable, Sendable {
  public let match: AgentDetectionMatch
  public let rules: [AgentDetectionRuleEvidence]
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

  func explain(_ input: AgentDetectionInput) -> AgentDetectionMatcherExplanation {
    let input = PreparedInput(input)
    let evaluations = rules.map { rule in
      (match: rule.match, evidence: rule.evidence(input))
    }
    return AgentDetectionMatcherExplanation(
      match: evaluations.first(where: { $0.evidence.matched })?.match ?? Self.fallbackMatch,
      rules: evaluations.map(\.evidence)
    )
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

  func evidence(_ input: PreparedInput) -> AgentDetectionRuleEvidence {
    let condition = gate.evidence(input.text(in: region))
    return AgentDetectionRuleEvidence(
      ruleID: id,
      result: result,
      priority: priority,
      region: region.description,
      matched: condition.matched,
      condition: condition
    )
  }
}

private struct CompiledGate {
  private struct Evaluation {
    let matched: Bool
    let evidence: AgentDetectionConditionEvidence?
  }

  private struct SegmentEvaluation {
    let matched: Bool
    let children: [AgentDetectionConditionEvidence]
  }

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
    evaluate(text, collectingEvidence: false).matched
  }

  func evidence(_ text: PreparedText) -> AgentDetectionConditionEvidence {
    evaluate(text, collectingEvidence: true).evidence!
  }

  private func evaluate(
    _ text: PreparedText,
    collectingEvidence: Bool
  ) -> Evaluation {
    let segments = [
      evaluateLeaves(
        contains,
        kind: "contains",
        value: \.pattern,
        collectingEvidence: collectingEvidence
      ) { text.lowercase.contains($0.lowercase) },
      evaluateLeaves(
        regex,
        kind: "regex",
        value: \.pattern,
        collectingEvidence: collectingEvidence
      ) { $0.matches(text.raw) },
      evaluateLeaves(
        lineRegex,
        kind: "line_regex",
        value: \.pattern,
        collectingEvidence: collectingEvidence
      ) { expression in text.lines.contains { expression.matches($0) } },
      evaluateAll(text, collectingEvidence: collectingEvidence),
      evaluateAny(text, collectingEvidence: collectingEvidence),
      evaluateNot(text, collectingEvidence: collectingEvidence),
    ]
    let matched = segments.allSatisfy(\.matched)
    let evidence =
      collectingEvidence
      ? AgentDetectionConditionEvidence(
        kind: "all",
        value: nil,
        matched: matched,
        children: segments.flatMap(\.children)
      )
      : nil
    return Evaluation(matched: matched, evidence: evidence)
  }

  private func evaluateLeaves<Value>(
    _ values: [Value],
    kind: String,
    value: KeyPath<Value, String>,
    collectingEvidence: Bool,
    matches: (Value) -> Bool
  ) -> SegmentEvaluation {
    let results = values.map { item in
      (item: item, matched: matches(item))
    }
    let children =
      collectingEvidence
      ? results.map { result in
        AgentDetectionConditionEvidence(
          kind: kind,
          value: result.item[keyPath: value],
          matched: result.matched,
          children: []
        )
      }
      : []
    return SegmentEvaluation(
      matched: results.allSatisfy(\.matched),
      children: children
    )
  }

  private func evaluateAll(
    _ text: PreparedText,
    collectingEvidence: Bool
  ) -> SegmentEvaluation {
    let evaluations = all.map { $0.evaluate(text, collectingEvidence: collectingEvidence) }
    let children = evaluations.compactMap { evaluation in
      evaluation.evidence.map {
        AgentDetectionConditionEvidence(
          kind: "all",
          value: nil,
          matched: evaluation.matched,
          children: $0.children
        )
      }
    }
    return SegmentEvaluation(
      matched: evaluations.allSatisfy(\.matched),
      children: children
    )
  }

  private func evaluateAny(
    _ text: PreparedText,
    collectingEvidence: Bool
  ) -> SegmentEvaluation {
    guard !any.isEmpty else { return SegmentEvaluation(matched: true, children: []) }
    let evaluations = any.map { $0.evaluate(text, collectingEvidence: collectingEvidence) }
    let matched = evaluations.contains(where: \.matched)
    return SegmentEvaluation(
      matched: matched,
      children: collectingEvidence
        ? [
          AgentDetectionConditionEvidence(
            kind: "any",
            value: nil,
            matched: matched,
            children: evaluations.compactMap(\.evidence)
          )
        ]
        : []
    )
  }

  private func evaluateNot(
    _ text: PreparedText,
    collectingEvidence: Bool
  ) -> SegmentEvaluation {
    guard !not.isEmpty else { return SegmentEvaluation(matched: true, children: []) }
    let evaluations = not.map { $0.evaluate(text, collectingEvidence: collectingEvidence) }
    let matched = !evaluations.contains(where: \.matched)
    return SegmentEvaluation(
      matched: matched,
      children: collectingEvidence
        ? [
          AgentDetectionConditionEvidence(
            kind: "not",
            value: nil,
            matched: matched,
            children: evaluations.compactMap(\.evidence)
          )
        ]
        : []
    )
  }
}

private struct CompiledContains {
  let pattern: String
  let lowercase: String

  init(_ pattern: String) {
    self.pattern = pattern
    lowercase = pattern.lowercased()
  }
}

private struct CompiledRegularExpression {
  let pattern: String
  private let value: NSRegularExpression

  init(_ pattern: String) throws {
    self.pattern = pattern
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
    guard let prompt = lastIndex(where: { $0 == "›" || $0.hasPrefix("› ") }) else {
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

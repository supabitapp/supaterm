import Foundation

struct AgentDetectionRuleSet: Equatable, Sendable {
  let generation: UInt64
  let agents: [AgentDetectionAgentRule]
}

struct AgentDetectionAgentRule: Equatable, Sendable {
  let id: String
  let displayName: String
  let processes: [AgentDetectionProcessRule]
  let rules: [AgentDetectionStateRule]
}

struct AgentDetectionManifest: Decodable, Equatable, Sendable {
  let id: String
  let rules: [AgentDetectionStateRule]

  init(from decoder: any Decoder) throws {
    let container = try decoder.agentDetectionContainer(keyedBy: CodingKeys.self)
    id = try container.decode(String.self, forKey: .id)
    rules = try container.decodeIfPresent([AgentDetectionStateRule].self, forKey: .rules) ?? []
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case id
    case version
    case minimumEngineVersion = "min_engine_version"
    case updatedAt = "updated_at"
    case aliases
    case rules
  }
}

struct AgentDetectionStateRule: Decodable, Equatable, Sendable {
  let id: String
  let result: AgentDetectionRuleResult
  let priority: Int
  let region: AgentDetectionRegion
  let visibleIdle: Bool
  let gate: AgentDetectionGate

  init(
    id: String,
    result: AgentDetectionRuleResult,
    priority: Int,
    region: AgentDetectionRegion,
    visibleIdle: Bool = false,
    gate: AgentDetectionGate
  ) {
    self.id = id
    self.result = result
    self.priority = priority
    self.region = region
    self.visibleIdle = visibleIdle
    self.gate = gate
  }

  init(from decoder: any Decoder) throws {
    let container = try decoder.agentDetectionContainer(keyedBy: CodingKeys.self)
    id = try container.decode(String.self, forKey: .id)
    let state = try container.decode(State.self, forKey: .state)
    let skipStateUpdate = try container.decodeIfPresent(Bool.self, forKey: .skipStateUpdate) ?? false
    result = try state.result(skipStateUpdate: skipStateUpdate, codingPath: decoder.codingPath)
    priority = try container.decodeIfPresent(Int.self, forKey: .priority) ?? 0
    region = try container.decodeIfPresent(AgentDetectionRegion.self, forKey: .region) ?? .wholeRecent
    visibleIdle = try container.decodeIfPresent(Bool.self, forKey: .visibleIdle) ?? false
    gate = try AgentDetectionGate(container: container)
  }

  private enum State: String, Decodable {
    case idle
    case working
    case blocked
    case unknown

    func result(
      skipStateUpdate: Bool,
      codingPath: [any CodingKey]
    ) throws -> AgentDetectionRuleResult {
      if skipStateUpdate { return .hold }
      switch self {
      case .idle:
        return .idle
      case .working:
        return .running
      case .blocked:
        return .needsInput
      case .unknown:
        throw DecodingError.dataCorrupted(
          DecodingError.Context(
            codingPath: codingPath,
            debugDescription: "Unknown state requires skip_state_update."
          )
        )
      }
    }
  }

  fileprivate enum CodingKeys: String, CodingKey, CaseIterable {
    case id
    case state
    case priority
    case region
    case visibleIdle = "visible_idle"
    case visibleBlocker = "visible_blocker"
    case visibleWorking = "visible_working"
    case skipStateUpdate = "skip_state_update"
    case contains
    case regex
    case lineRegex = "line_regex"
    case all
    case any
    case not
  }
}

public enum AgentDetectionRuleResult: Equatable, Sendable {
  case running
  case needsInput
  case idle
  case hold
}

enum AgentDetectionRegion: Equatable, Hashable, Sendable {
  case wholeRecent
  case bottomNonEmptyLines(Int)
  case topNonEmptyLines(Int)
  case afterLastPromptMarker
  case promptBoxBody
  case lastNonEmptyAbovePromptBox
  case afterLastHorizontalRule
  case oscTitle
  case oscProgress
}

extension AgentDetectionRegion: Decodable {
  init(from decoder: any Decoder) throws {
    let container = try decoder.singleValueContainer()
    let value = try container.decode(String.self)
    switch value {
    case "whole_recent":
      self = .wholeRecent
    case "after_last_prompt_marker":
      self = .afterLastPromptMarker
    case "prompt_box_body":
      self = .promptBoxBody
    case "last_non_empty_above_prompt_box":
      self = .lastNonEmptyAbovePromptBox
    case "after_last_horizontal_rule":
      self = .afterLastHorizontalRule
    case "osc_title":
      self = .oscTitle
    case "osc_progress":
      self = .oscProgress
    default:
      if let count = Self.lineCount(in: value, prefix: "bottom_non_empty_lines(") {
        self = .bottomNonEmptyLines(count)
      } else if let count = Self.lineCount(in: value, prefix: "top_non_empty_lines(") {
        self = .topNonEmptyLines(count)
      } else {
        throw DecodingError.dataCorruptedError(
          in: container,
          debugDescription: "Unknown agent detection region '\(value)'."
        )
      }
    }
  }

  private static func lineCount(in value: String, prefix: String) -> Int? {
    guard value.hasPrefix(prefix), value.hasSuffix(")") else { return nil }
    let start = value.index(value.startIndex, offsetBy: prefix.count)
    guard let count = Int(value[start..<value.index(before: value.endIndex)]), count > 0 else {
      return nil
    }
    return count
  }
}

struct AgentDetectionGate: Decodable, Equatable, Sendable {
  let contains: [String]
  let regex: [String]
  let lineRegex: [String]
  let all: [AgentDetectionGate]
  let any: [AgentDetectionGate]
  let not: [AgentDetectionGate]

  init(
    contains: [String] = [],
    regex: [String] = [],
    lineRegex: [String] = [],
    all: [AgentDetectionGate] = [],
    any: [AgentDetectionGate] = [],
    not: [AgentDetectionGate] = []
  ) {
    self.contains = contains
    self.regex = regex
    self.lineRegex = lineRegex
    self.all = all
    self.any = any
    self.not = not
  }

  init(from decoder: any Decoder) throws {
    let container = try decoder.agentDetectionContainer(keyedBy: CodingKeys.self)
    contains = try container.decodeIfPresent([String].self, forKey: .contains) ?? []
    regex = try container.decodeIfPresent([String].self, forKey: .regex) ?? []
    lineRegex = try container.decodeIfPresent([String].self, forKey: .lineRegex) ?? []
    all = try container.decodeIfPresent([AgentDetectionGate].self, forKey: .all) ?? []
    any = try container.decodeIfPresent([AgentDetectionGate].self, forKey: .any) ?? []
    not = try container.decodeIfPresent([AgentDetectionGate].self, forKey: .not) ?? []
  }

  fileprivate init(
    container: KeyedDecodingContainer<AgentDetectionStateRule.CodingKeys>
  ) throws {
    contains = try container.decodeIfPresent([String].self, forKey: .contains) ?? []
    regex = try container.decodeIfPresent([String].self, forKey: .regex) ?? []
    lineRegex = try container.decodeIfPresent([String].self, forKey: .lineRegex) ?? []
    all = try container.decodeIfPresent([AgentDetectionGate].self, forKey: .all) ?? []
    any = try container.decodeIfPresent([AgentDetectionGate].self, forKey: .any) ?? []
    not = try container.decodeIfPresent([AgentDetectionGate].self, forKey: .not) ?? []
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case contains
    case regex
    case lineRegex = "line_regex"
    case all
    case any
    case not
  }
}

struct AgentDetectionCodingKey: CodingKey, Hashable {
  let stringValue: String
  let intValue: Int?

  init?(stringValue: String) {
    self.stringValue = stringValue
    intValue = nil
  }

  init?(intValue: Int) {
    stringValue = "\(intValue)"
    self.intValue = intValue
  }
}

extension Decoder {
  func agentDetectionContainer<Key>(
    keyedBy type: Key.Type
  ) throws -> KeyedDecodingContainer<Key> where Key: CodingKey & CaseIterable {
    let dynamic = try container(keyedBy: AgentDetectionCodingKey.self)
    let allowed = Set(Key.allCases.map(\.stringValue))
    if let unknown = dynamic.allKeys.first(where: { !allowed.contains($0.stringValue) }) {
      throw DecodingError.dataCorrupted(
        DecodingError.Context(
          codingPath: codingPath + [unknown],
          debugDescription: "Unknown agent detection key '\(unknown.stringValue)'."
        )
      )
    }
    return try container(keyedBy: type)
  }
}

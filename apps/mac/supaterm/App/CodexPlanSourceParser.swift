import Foundation

enum CodexPlanSourceParser {
  struct Item: Equatable {
    let step: String
    let status: PaneAgentProgressRow.Status

    init?(step: String, status: String) {
      self.step = step
      switch status {
      case "completed": self.status = .completed
      case "in_progress": self.status = .running
      case "pending": self.status = .pending
      default: return nil
      }
    }
  }

  private enum Token: Equatable {
    case identifier(String)
    case string(String)
    case opaqueString
    case symbol(Character)
  }

  private enum PropertyValue {
    case expression(Range<Int>)
    case shorthand
  }

  static func parse(_ source: String) -> [Item]? {
    guard let tokens = tokens(in: source) else { return nil }
    let callIndices = tokens.indices.filter { isUpdatePlanReference(at: $0, in: tokens) }
    guard callIndices.count == 1,
      let index = callIndices.first,
      isUpdatePlanCall(at: index, in: tokens)
    else { return nil }

    let argumentIndex = index + 4
    guard
      case .symbol("{") = tokens[argumentIndex],
      let objectEnd = matchingDelimiter(at: argumentIndex, in: tokens),
      objectEnd + 1 < tokens.count,
      case .symbol(")") = tokens[objectEnd + 1],
      callEndsExpression(at: objectEnd + 1, in: tokens),
      let properties = objectProperties(at: argumentIndex, in: tokens),
      let plan = properties["plan"]
    else { return nil }
    return planItems(from: plan, before: index, in: tokens)
  }

  private static func isUpdatePlanReference(at index: Int, in tokens: [Token]) -> Bool {
    guard index + 4 < tokens.count else { return false }
    if index > 0, case .symbol(".") = tokens[index - 1] {
      return false
    }
    return tokens[index] == .identifier("tools")
      && tokens[index + 1] == .symbol(".")
      && tokens[index + 2] == .identifier("update_plan")
      && tokens[index + 3] == .symbol("(")
  }

  private static func isUpdatePlanCall(at index: Int, in tokens: [Token]) -> Bool {
    guard isUpdatePlanReference(at: index, in: tokens),
      braceDepth(before: index, in: tokens) == 0
    else {
      return false
    }

    return isDirectAwaitedCall(at: index, in: tokens)
      || isPromiseAllElement(at: index, in: tokens)
  }

  private static func isDirectAwaitedCall(at index: Int, in tokens: [Token]) -> Bool {
    let statementStart = statementStart(before: index, in: tokens)
    let prefix = Array(tokens[statementStart..<index])
    if prefix == [.identifier("await")] { return true }
    guard prefix.count == 4,
      prefix[0] == .identifier("const"),
      case .identifier = prefix[1],
      prefix[2] == .symbol("="),
      prefix[3] == .identifier("await")
    else { return false }
    return true
  }

  private static func isPromiseAllElement(at index: Int, in tokens: [Token]) -> Bool {
    guard
      statementStart(before: index, in: tokens) == 0,
      index > 8,
      tokens[0] == .identifier("const"),
      case .identifier = tokens[1],
      tokens[2] == .symbol("="),
      tokens[3] == .identifier("await"),
      tokens[4] == .identifier("Promise"),
      tokens[5] == .symbol("."),
      tokens[6] == .identifier("all"),
      tokens[7] == .symbol("("),
      tokens[8] == .symbol("["),
      let arrayEnd = matchingDelimiter(at: 8, in: tokens),
      index < arrayEnd
    else {
      return false
    }

    var delimiters: [Character] = []
    var elementStart = 9
    for position in 9..<index {
      guard case .symbol(let symbol) = tokens[position] else { continue }
      if let closing = closingDelimiter(for: symbol) {
        delimiters.append(closing)
      } else if delimiters.last == symbol {
        delimiters.removeLast()
      } else if symbol == ",", delimiters.isEmpty {
        elementStart = position + 1
      }
    }
    return elementStart == index
  }

  private static func callEndsExpression(at callEnd: Int, in tokens: [Token]) -> Bool {
    guard callEnd + 1 < tokens.count else { return true }
    return [.symbol(";"), .symbol(","), .symbol("]")].contains(tokens[callEnd + 1])
  }

  private static func statementStart(before index: Int, in tokens: [Token]) -> Int {
    tokens[..<index].lastIndex(of: .symbol(";")).map { $0 + 1 } ?? 0
  }

  private static func planItems(
    from value: PropertyValue,
    before callIndex: Int,
    in tokens: [Token]
  ) -> [Item]? {
    switch value {
    case .expression(let range):
      guard let first = range.first else { return nil }
      if case .symbol("[") = tokens[first] {
        guard statementStart(before: callIndex, in: tokens) == 0 else { return nil }
        return planItems(in: range, tokens: tokens)
      }
      guard case .identifier(let name) = tokens[first], range.count == 1 else { return nil }
      return boundPlan(named: name, before: callIndex, in: tokens)
    case .shorthand:
      return boundPlan(named: "plan", before: callIndex, in: tokens)
    }
  }

  private static func boundPlan(
    named name: String,
    before callIndex: Int,
    in tokens: [Token]
  ) -> [Item]? {
    guard callIndex >= 3,
      tokens[0] == .identifier("const"),
      tokens[1] == .identifier(name),
      tokens[2] == .symbol("="),
      tokens[3] == .symbol("["),
      let end = matchingDelimiter(at: 3, in: tokens),
      end + 2 == statementStart(before: callIndex, in: tokens),
      tokens[end + 1] == .symbol(";")
    else { return nil }
    return planItems(in: 3..<(end + 1), tokens: tokens)
  }

  private static func planItems(
    in range: Range<Int>,
    tokens: [Token]
  ) -> [Item]? {
    guard
      let start = range.first,
      tokens[start] == .symbol("["),
      let end = matchingDelimiter(at: start, in: tokens),
      end + 1 == range.upperBound
    else {
      return nil
    }

    var items: [Item] = []
    var index = start + 1
    while index < end {
      if tokens[index] == .symbol(",") {
        index += 1
        continue
      }
      guard
        tokens[index] == .symbol("{"),
        let itemEnd = matchingDelimiter(at: index, in: tokens),
        itemEnd < end,
        let properties = objectProperties(at: index, in: tokens),
        let step = stringValue(from: properties["step"], in: tokens),
        let status = stringValue(from: properties["status"], in: tokens),
        let item = Item(step: step, status: status)
      else {
        return nil
      }
      items.append(item)
      index = itemEnd + 1
      guard index == end || tokens[index] == .symbol(",") else { return nil }
    }

    return items
  }

  private static func stringValue(
    from value: PropertyValue?,
    in tokens: [Token]
  ) -> String? {
    guard case .expression(let range) = value, range.count == 1,
      let index = range.first,
      case .string(let value) = tokens[index]
    else {
      return nil
    }
    return value
  }

  private static func objectProperties(
    at start: Int,
    in tokens: [Token]
  ) -> [String: PropertyValue]? {
    guard tokens[start] == .symbol("{"),
      let end = matchingDelimiter(at: start, in: tokens)
    else {
      return nil
    }

    var properties: [String: PropertyValue] = [:]
    var index = start + 1
    while index < end {
      if tokens[index] == .symbol(",") {
        index += 1
        continue
      }
      guard let key = propertyKey(tokens[index]) else { return nil }
      index += 1

      if index < end, tokens[index] == .symbol(":") {
        let valueStart = index + 1
        guard valueStart < end else { return nil }
        let valueEnd = expressionEnd(from: valueStart, before: end, in: tokens)
        guard valueStart < valueEnd else { return nil }
        properties[key] = .expression(valueStart..<valueEnd)
        index = valueEnd
      } else {
        guard index == end || tokens[index] == .symbol(",") else { return nil }
        properties[key] = .shorthand
      }

      guard index == end || tokens[index] == .symbol(",") else { return nil }
    }

    return properties
  }

  private static func propertyKey(_ token: Token) -> String? {
    switch token {
    case .identifier(let value), .string(let value):
      value
    case .opaqueString, .symbol:
      nil
    }
  }

  private static func expressionEnd(
    from start: Int,
    before end: Int,
    in tokens: [Token]
  ) -> Int {
    var delimiters: [Character] = []
    var index = start
    while index < end {
      if case .symbol(let symbol) = tokens[index] {
        if let closing = closingDelimiter(for: symbol) {
          delimiters.append(closing)
        } else if delimiters.last == symbol {
          delimiters.removeLast()
        } else if symbol == ",", delimiters.isEmpty {
          return index
        }
      }
      index += 1
    }
    return index
  }

  private static func matchingDelimiter(at start: Int, in tokens: [Token]) -> Int? {
    guard case .symbol(let opening) = tokens[start],
      let closing = closingDelimiter(for: opening)
    else {
      return nil
    }

    var delimiters = [closing]
    var index = start + 1
    while index < tokens.count {
      if case .symbol(let symbol) = tokens[index] {
        if let nestedClosing = closingDelimiter(for: symbol) {
          delimiters.append(nestedClosing)
        } else if delimiters.last == symbol {
          delimiters.removeLast()
          if delimiters.isEmpty {
            return index
          }
        }
      }
      index += 1
    }
    return nil
  }

  private static func closingDelimiter(for opening: Character) -> Character? {
    switch opening {
    case "(": ")"
    case "[": "]"
    case "{": "}"
    default: nil
    }
  }

  private static func braceDepth(before end: Int, in tokens: [Token]) -> Int {
    tokens[..<end].reduce(into: 0) { depth, token in
      if token == .symbol("{") {
        depth += 1
      } else if token == .symbol("}") {
        depth -= 1
      }
    }
  }

  private static func tokens(in source: String) -> [Token]? {
    let characters = Array(source)
    var tokens: [Token] = []
    var index = 0

    while index < characters.count {
      let character = characters[index]
      if character.isWhitespace {
        index += 1
      } else if character == "/", index + 1 < characters.count, characters[index + 1] == "/" {
        index += 2
        while index < characters.count, !characters[index].isNewline {
          index += 1
        }
      } else if character == "/", index + 1 < characters.count, characters[index + 1] == "*" {
        guard let end = blockCommentEnd(after: index + 2, in: characters) else { return nil }
        index = end
      } else if character == "\"" || character == "'" || character == "`" {
        guard let token = stringToken(startingAt: index, in: characters) else { return nil }
        tokens.append(token.value)
        index = token.end
      } else if isIdentifierStart(character) {
        let start = index
        index += 1
        while index < characters.count, isIdentifierContinuation(characters[index]) {
          index += 1
        }
        tokens.append(.identifier(String(characters[start..<index])))
      } else {
        tokens.append(.symbol(character))
        index += 1
      }
    }

    return tokens
  }

  private static func blockCommentEnd(after start: Int, in characters: [Character]) -> Int? {
    var index = start
    while index + 1 < characters.count {
      if characters[index] == "*", characters[index + 1] == "/" {
        return index + 2
      }
      index += 1
    }
    return nil
  }

  private static func stringToken(
    startingAt start: Int,
    in characters: [Character]
  ) -> (value: Token, end: Int)? {
    let quote = characters[start]
    var index = start + 1
    while index < characters.count {
      if characters[index] == "\\" {
        index += 2
        continue
      }
      if characters[index] == quote {
        let end = index + 1
        let value = decodedString(in: characters[start..<end], quote: quote)
        return (value.map(Token.string) ?? .opaqueString, end)
      }
      index += 1
    }
    return nil
  }

  private static func decodedString(
    in literal: ArraySlice<Character>,
    quote: Character
  ) -> String? {
    if quote == "\"" {
      return try? JSONDecoder().decode(String.self, from: Data(String(literal).utf8))
    }
    guard quote == "'" else { return nil }

    var json = "\""
    var index = literal.index(after: literal.startIndex)
    let end = literal.index(before: literal.endIndex)
    while index < end {
      let character = literal[index]
      if character.isNewline {
        return nil
      }
      if character == "\"" {
        json += "\\\""
        index = literal.index(after: index)
      } else if character == "\\" {
        let nextIndex = literal.index(after: index)
        guard nextIndex < end else { return nil }
        let next = literal[nextIndex]
        if next == "'" {
          json.append(next)
        } else {
          json.append(character)
          json.append(next)
        }
        index = literal.index(after: nextIndex)
      } else {
        json.append(character)
        index = literal.index(after: index)
      }
    }
    json.append("\"")
    return try? JSONDecoder().decode(String.self, from: Data(json.utf8))
  }

  private static func isIdentifierStart(_ character: Character) -> Bool {
    character == "_" || character == "$" || character.isLetter
  }

  private static func isIdentifierContinuation(_ character: Character) -> Bool {
    isIdentifierStart(character) || character.isNumber
  }
}

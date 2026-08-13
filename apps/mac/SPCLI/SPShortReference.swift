import ArgumentParser
import Foundation

struct SPShortReference: Equatable, Sendable, CustomStringConvertible {
  enum Kind: String, Sendable {
    case space = "s"
    case group = "g"
    case tab = "t"
    case pane = "p"

    var name: String {
      switch self {
      case .space:
        "space"
      case .group:
        "group"
      case .tab:
        "tab"
      case .pane:
        "pane"
      }
    }
  }

  let kind: Kind
  let prefix: String

  var description: String {
    "\(kind.rawValue):\(prefix)"
  }

  static func parse(_ argument: String) throws -> Self? {
    let trimmed = argument.trimmingCharacters(in: .whitespacesAndNewlines)
    let tag = trimmed.prefix(1).lowercased()
    guard trimmed.dropFirst().first == ":", let kind = Kind(rawValue: tag) else { return nil }

    let prefix = trimmed.dropFirst(2).lowercased()
    guard
      (8...32).contains(prefix.count),
      prefix.unicodeScalars.allSatisfy({ $0.isASCII && $0.properties.isHexDigit })
    else {
      throw ValidationError(
        "Typed refs must use s:, g:, t:, or p: followed by 8 to 32 UUID hex characters."
      )
    }
    return Self(kind: kind, prefix: prefix)
  }

  func require(_ expectedKind: Kind) throws -> Self {
    guard kind == expectedKind else {
      throw ValidationError(
        "Expected a \(expectedKind.name) ref, got \(kind.name) ref \(description)."
      )
    }
    return self
  }

  func resolve(in ids: some Sequence<UUID>) throws -> UUID {
    let matches = Set(ids).filter { compactUUID($0).hasPrefix(prefix) }.sorted {
      $0.uuidString < $1.uuidString
    }
    guard let match = matches.first else {
      throw ValidationError("No \(kind.name) matches short ref \(description).")
    }
    guard matches.count == 1 else {
      let values = matches.map { "\(kind.rawValue):\(compactUUID($0))" }
        .joined(separator: ", ")
      throw ValidationError(
        "Short ref \(description) is ambiguous: \(values). Use a longer ref or full UUID."
      )
    }
    return match
  }

  static func display(kind: Kind, id: UUID, among ids: some Sequence<UUID>) -> String {
    let value = compactUUID(id)
    let candidates = Set(ids).map(compactUUID)
    let length =
      (8...32).first { prefixLength in
        candidates.filter { $0.hasPrefix(String(value.prefix(prefixLength))) }.count == 1
      } ?? 32
    return "\(kind.rawValue):\(value.prefix(length))"
  }
}

private func compactUUID(_ id: UUID) -> String {
  id.uuidString.replacingOccurrences(of: "-", with: "").lowercased()
}

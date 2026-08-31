import Foundation

func runSPJSON<Result: Decodable>(
  _ arguments: [String],
  app: SupatermE2EApp,
  runner: SPBinaryRunner,
  cwd: URL
) throws -> Result {
  try decodeSPJSON(
    Result.self,
    from: try requireSuccessfulSPResult(
      try runner.run(arguments + ["--socket", app.socketPath, "--json"], cwd: cwd)
    )
  )
}

struct ListSnapshot: Decodable {
  enum Kind: String, Decodable {
    case space
    case group
    case tab
    case pane
  }

  struct Current: Decodable {
    let spaceID: UUID
    let tabID: UUID
    let paneID: UUID?
  }

  struct Item: Decodable {
    let kind: Kind
    let id: UUID
    let parentID: UUID?
    let cwd: String?
  }

  let revision: String
  let current: Current?
  let items: [Item]
}

func listedRef(
  _ kind: ListSnapshot.Kind,
  id: UUID,
  app: SupatermE2EApp,
  runner: SPBinaryRunner,
  cwd: URL
) throws -> String {
  let list = try requireSuccessfulSPResult(
    try runner.run(["ls", "--socket", app.socketPath, "--plain"], cwd: cwd)
  )
  return try listedRef(kind, id: id, output: list.stdout)
}

func listedRef(
  _ kind: ListSnapshot.Kind,
  id: UUID,
  output: String
) throws -> String {
  let canonicalID = id.uuidString.replacingOccurrences(of: "-", with: "").lowercased()
  for line in output.split(whereSeparator: \.isNewline) {
    let columns = line.split(separator: "\t", omittingEmptySubsequences: false)
    guard columns.count == 9 else {
      throw SupatermE2EError("Expected nine plain list columns.")
    }
    guard columns[1] == Substring(kind.rawValue) else { continue }
    let reference = String(columns[0])
    let prefix =
      switch kind {
      case .space: "s:"
      case .group: "g:"
      case .tab: "t:"
      case .pane: "p:"
      }
    guard reference.hasPrefix(prefix) else {
      throw SupatermE2EError("Expected a typed \(kind.rawValue) ref, got \(reference).")
    }
    let body = reference.dropFirst(prefix.count)
    guard (8...32).contains(body.count) else {
      throw SupatermE2EError("Expected a typed \(kind.rawValue) ref, got \(reference).")
    }
    if canonicalID.hasPrefix(body) {
      return reference
    }
  }
  throw SupatermE2EError("Expected a listed ref for \(id.uuidString.lowercased()).")
}

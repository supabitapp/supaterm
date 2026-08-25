import Foundation
import SupatermSupport

nonisolated enum TerminalSessionCatalogVersion: Int, Sendable {
  case v13 = 13
  case v14

  static let current = Self.v14
}

nonisolated enum TerminalSessionCatalogMigration {
  enum MigrationError: Error {
    case invalidRoot
    case missingVersion
    case unsupportedVersion(Int)
  }

  enum StoredCatalogResult: Equatable {
    case missing
    case current
    case migrated
    case rejected
  }

  private typealias JSONObject = [String: Any]
  private typealias IndexedNode = (sourceIndex: Int, node: JSONObject)

  static func migrate(_ data: Data) throws -> Data? {
    guard var root = try JSONSerialization.jsonObject(with: data) as? JSONObject else {
      throw MigrationError.invalidRoot
    }
    guard let sourceVersion = (root["version"] as? NSNumber)?.intValue else {
      throw MigrationError.missingVersion
    }
    switch TerminalSessionCatalogVersion(rawValue: sourceVersion) {
    case .v14:
      _ = try JSONDecoder().decode(TerminalSessionCatalog.self, from: data)
      return nil
    case .v13:
      root = migrateVersion13(root)
      root["version"] = TerminalSessionCatalogVersion.current.rawValue
      let migrated = try JSONSerialization.data(withJSONObject: root, options: [.sortedKeys])
      _ = try JSONDecoder().decode(TerminalSessionCatalog.self, from: migrated)
      return migrated
    case nil:
      throw MigrationError.unsupportedVersion(sourceVersion)
    }
  }

  @discardableResult
  static func migrateStoredCatalog(
    at url: URL,
    fileManager: FileManager = .default
  ) -> StoredCatalogResult {
    guard fileManager.fileExists(atPath: url.path(percentEncoded: false)) else { return .missing }
    do {
      let data = try Data(contentsOf: url)
      guard let migrated = try migrate(data) else { return .current }
      try migrated.write(to: url, options: .atomic)
      SupatermLog.notice(
        SupatermLog.terminal,
        "terminal.session.migrated",
        fields: ["version=\(TerminalSessionCatalog.currentVersion)"]
      )
      return .migrated
    } catch {
      SupatermLog.error(
        SupatermLog.terminal,
        "terminal.session.migration.failed",
        fields: ["error=\(String(reflecting: type(of: error)))"]
      )
      return .rejected
    }
  }

  private static func migrateVersion13(_ root: JSONObject) -> JSONObject {
    var root = root
    guard let windows = root["windows"] as? [JSONObject] else { return root }
    root["windows"] = windows.map(migrateVersion13Window)
    return root
  }

  private static func migrateVersion13Window(_ window: JSONObject) -> JSONObject {
    guard let spaces = window["spaces"] as? [JSONObject] else { return window }
    var window = window
    window["spaces"] = spaces.map(migrateVersion13Space)
    return window
  }

  private static func migrateVersion13Space(_ space: JSONObject) -> JSONObject {
    let nodes = space["nodes"] as? [JSONObject] ?? []
    let tabs = space["tabs"] as? [JSONObject] ?? []
    let projects = space["groups"] as? [JSONObject] ?? []
    let tabsByID = tabs.reduce(into: [String: JSONObject]()) { result, tab in
      guard let id = idKey(tab["id"]), result[id] == nil else { return }
      result[id] = tab
    }
    let projectIDs = Set(projects.compactMap { idKey($0["id"]) })
    let indexedNodes = nodes.enumerated().map { (sourceIndex: $0.offset, node: $0.element) }
    let roots = orderedRootNodes(
      indexedNodes,
      tabsByID: tabsByID,
      projectIDs: projectIDs
    )
    var emittedTabIDs: Set<String> = []
    var migratedTabs: [JSONObject] = []
    for root in roots {
      appendMigratedRoot(
        root,
        indexedNodes: indexedNodes,
        tabsByID: tabsByID,
        emittedTabIDs: &emittedTabIDs,
        migratedTabs: &migratedTabs
      )
    }
    var space = space
    space.removeValue(forKey: "nodes")
    space.removeValue(forKey: "groups")
    space.removeValue(forKey: "collapsedGroupIDs")
    space["collapsedProjectIDs"] = []
    space["isUnassignedCollapsed"] = false
    space["tabs"] = migratedTabs
    return space
  }

  private static func orderedRootNodes(
    _ nodes: [IndexedNode],
    tabsByID: [String: JSONObject],
    projectIDs: Set<String>
  ) -> [IndexedNode] {
    var seen: Set<String> = []
    let roots = nodes.filter { indexedNode in
      guard
        let item = indexedNode.node["item"] as? JSONObject,
        let parent = indexedNode.node["parent"] as? JSONObject,
        parent["kind"] as? String == "root",
        let id = idKey(item["id"]),
        let kind = item["kind"] as? String,
        seen.insert("\(kind):\(id)").inserted
      else { return false }
      return isKnownVersion13Root(
        kind: kind,
        id: id,
        tabsByID: tabsByID,
        projectIDs: projectIDs
      )
    }
    return
      orderedNodes(roots.filter { rootIsPinned($0.node) })
      + orderedNodes(roots.filter { !rootIsPinned($0.node) })
  }

  private static func isKnownVersion13Root(
    kind: String,
    id: String,
    tabsByID: [String: JSONObject],
    projectIDs: Set<String>
  ) -> Bool {
    switch kind {
    case "tab":
      return tabsByID[id] != nil
    case "group":
      return projectIDs.contains(id)
    default:
      return false
    }
  }

  private static func appendMigratedRoot(
    _ root: IndexedNode,
    indexedNodes: [IndexedNode],
    tabsByID: [String: JSONObject],
    emittedTabIDs: inout Set<String>,
    migratedTabs: inout [JSONObject]
  ) {
    guard
      let item = root.node["item"] as? JSONObject,
      let id = idKey(item["id"])
    else { return }
    let isPinned = rootIsPinned(root.node)
    if item["kind"] as? String == "tab" {
      appendMigratedTab(
        id: id,
        isPinned: isPinned,
        tabsByID: tabsByID,
        emittedTabIDs: &emittedTabIDs,
        migratedTabs: &migratedTabs
      )
      return
    }
    for child in childNodes(of: id, in: indexedNodes) {
      guard
        let item = child.node["item"] as? JSONObject,
        let childID = idKey(item["id"])
      else { continue }
      appendMigratedTab(
        id: childID,
        isPinned: isPinned,
        tabsByID: tabsByID,
        emittedTabIDs: &emittedTabIDs,
        migratedTabs: &migratedTabs
      )
    }
  }

  private static func childNodes(
    of projectID: String,
    in nodes: [IndexedNode]
  ) -> [IndexedNode] {
    orderedNodes(
      nodes.filter { indexedNode in
        guard
          let item = indexedNode.node["item"] as? JSONObject,
          item["kind"] as? String == "tab",
          let parent = indexedNode.node["parent"] as? JSONObject,
          parent["kind"] as? String == "group"
        else { return false }
        return idKey(parent["id"]) == projectID
      }
    )
  }

  private static func appendMigratedTab(
    id: String,
    isPinned: Bool,
    tabsByID: [String: JSONObject],
    emittedTabIDs: inout Set<String>,
    migratedTabs: inout [JSONObject]
  ) {
    guard emittedTabIDs.insert(id).inserted, var tab = tabsByID[id] else { return }
    tab["isPinned"] = isPinned
    tab.removeValue(forKey: "projectID")
    migratedTabs.append(tab)
  }

  private static func orderedNodes(
    _ nodes: [IndexedNode]
  ) -> [IndexedNode] {
    nodes.sorted {
      (nodeOrder($0.node), $0.sourceIndex) < (nodeOrder($1.node), $1.sourceIndex)
    }
  }

  private static func nodeOrder(_ node: JSONObject) -> Int {
    (node["order"] as? NSNumber)?.intValue ?? 0
  }

  private static func rootIsPinned(_ node: JSONObject) -> Bool {
    guard let parent = node["parent"] as? JSONObject else { return false }
    return parent["isPinned"] as? Bool == true
  }

  private static func idKey(_ value: Any?) -> String? {
    if let value = value as? String { return value.uppercased() }
    return ((value as? JSONObject)?["rawValue"] as? String)?.uppercased()
  }
}

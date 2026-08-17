import CryptoKit
import Foundation
import SupatermSupport

nonisolated enum TerminalSessionCatalogVersion: Int, CaseIterable, Sendable {
  case v1 = 1
  case v2
  case v3
  case v4
  case v5
  case v6
  case v7
  case v8
  case v9
  case v10
  case v11
  case v12
  case v13

  static let current = Self.v13
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

  static func migrate(_ data: Data) throws -> Data? {
    guard var root = try JSONSerialization.jsonObject(with: data) as? JSONObject else {
      throw MigrationError.invalidRoot
    }
    guard let sourceVersionValue = root["version"] as? NSNumber else {
      throw MigrationError.missingVersion
    }
    let sourceVersionRawValue = sourceVersionValue.intValue
    guard let sourceVersion = TerminalSessionCatalogVersion(rawValue: sourceVersionRawValue) else {
      throw MigrationError.unsupportedVersion(sourceVersionRawValue)
    }
    guard sourceVersion != .current else {
      _ = try JSONDecoder().decode(TerminalSessionCatalog.self, from: data)
      return nil
    }

    var version = sourceVersion
    while version != .current {
      root = try migrate(root, from: version)
      guard let nextVersion = TerminalSessionCatalogVersion(rawValue: version.rawValue + 1) else {
        throw MigrationError.unsupportedVersion(version.rawValue)
      }
      version = nextVersion
      root["version"] = version.rawValue
    }

    let migrated = try JSONSerialization.data(withJSONObject: root, options: [.sortedKeys])
    _ = try JSONDecoder().decode(TerminalSessionCatalog.self, from: migrated)
    return migrated
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

  private static func migrate(
    _ root: JSONObject,
    from version: TerminalSessionCatalogVersion
  ) throws -> JSONObject {
    switch version {
    case .v1:
      migrateVersion1(root)
    case .v2:
      migrateVersion2(root)
    case .v3:
      migrateVersion3(root)
    case .v4:
      migrateVersion4(root)
    case .v5:
      migrateVersion5(root)
    case .v6:
      migrateVersion6(root)
    case .v7:
      migrateVersion7(root)
    case .v8:
      migrateVersion8(root)
    case .v9:
      migrateVersion9(root)
    case .v10:
      migrateVersion10(root)
    case .v11:
      migrateVersion11(root)
    case .v12:
      migrateVersion12(root)
    case .v13:
      throw MigrationError.unsupportedVersion(version.rawValue)
    }
  }

  private static func migrateVersion1(_ root: JSONObject) -> JSONObject {
    var root = root
    guard var windows = root["windows"] as? [JSONObject] else { return root }
    for windowIndex in windows.indices {
      guard var spaces = windows[windowIndex]["spaces"] as? [JSONObject] else { continue }
      for spaceIndex in spaces.indices {
        guard var tabs = spaces[spaceIndex]["tabs"] as? [JSONObject] else { continue }
        let selectedTabID = spaces[spaceIndex]["selectedTabID"]
        let selectedTabIndex = tabs.firstIndex { valuesEqual($0["id"], selectedTabID) }
        for tabIndex in tabs.indices {
          let focusedPaneID = tabs[tabIndex]["focusedPaneID"]
          let focusedPaneIndex =
            paneLeafIDs(in: tabs[tabIndex]["root"] as Any)
            .firstIndex { valuesEqual($0, focusedPaneID) } ?? 0
          let keepsTitle = tabs[tabIndex]["isTitleLocked"] as? Bool == true
          let title = tabs[tabIndex]["title"] as? String
          tabs[tabIndex].removeValue(forKey: "id")
          tabs[tabIndex].removeValue(forKey: "title")
          tabs[tabIndex].removeValue(forKey: "isTitleLocked")
          tabs[tabIndex].removeValue(forKey: "focusedPaneID")
          tabs[tabIndex]["focusedPaneIndex"] = focusedPaneIndex
          if keepsTitle, let title {
            tabs[tabIndex]["lockedTitle"] = title
          }
          if let pane = tabs[tabIndex]["root"] {
            tabs[tabIndex]["root"] = transformPaneLeaves(in: pane) { leaf, _ in
              leaf.removeValue(forKey: "id")
            }
          }
        }
        spaces[spaceIndex].removeValue(forKey: "selectedTabID")
        if let selectedTabIndex {
          spaces[spaceIndex]["selectedTabIndex"] = selectedTabIndex
        }
        spaces[spaceIndex]["tabs"] = tabs
      }
      windows[windowIndex]["spaces"] = spaces
    }
    root["windows"] = windows
    return root
  }

  private static func migrateVersion2(_ root: JSONObject) -> JSONObject {
    root
  }

  private static func migrateVersion3(_ root: JSONObject) -> JSONObject {
    transformPaneLeaves(in: root) { leaf, path in
      if leaf["id"] == nil {
        leaf["id"] = stableUUID(path: path)
      }
      if leaf["agents"] == nil {
        leaf["agents"] = []
      }
    } as? JSONObject ?? root
  }

  private static func migrateVersion4(_ root: JSONObject) -> JSONObject {
    transformPaneLeaves(in: root) { leaf, _ in
      leaf["agents"] = []
    } as? JSONObject ?? root
  }

  private static func migrateVersion5(_ root: JSONObject) -> JSONObject {
    var root = root
    guard var windows = root["windows"] as? [JSONObject] else { return root }
    for windowIndex in windows.indices {
      guard var spaces = windows[windowIndex]["spaces"] as? [JSONObject] else { continue }
      for spaceIndex in spaces.indices {
        guard let tabs = spaces[spaceIndex]["tabs"] as? [JSONObject] else { continue }
        let selectedTabIndex = (spaces[spaceIndex]["selectedTabIndex"] as? NSNumber)?.intValue
        var persistedTabs: [JSONObject] = []
        var tabIDs: [JSONObject] = []
        for tabIndex in tabs.indices {
          let tabID = wrappedID(
            stableUUID(path: ["v5", "windows", "\(windowIndex)", "spaces", "\(spaceIndex)", "tabs", "\(tabIndex)"])
          )
          var session = tabs[tabIndex]
          session.removeValue(forKey: "isPinned")
          persistedTabs.append(["id": tabID, "session": session])
          tabIDs.append(tabID)
        }
        let projectID = wrappedID(
          stableUUID(path: ["v5", "windows", "\(windowIndex)", "spaces", "\(spaceIndex)", "project"])
        )
        spaces[spaceIndex].removeValue(forKey: "selectedTabIndex")
        spaces[spaceIndex].removeValue(forKey: "selectedPinnedTabID")
        spaces[spaceIndex].removeValue(forKey: "tabs")
        if let selectedTabIndex, tabIDs.indices.contains(selectedTabIndex) {
          spaces[spaceIndex]["selectedTabID"] = tabIDs[selectedTabIndex]
        }
        spaces[spaceIndex]["projects"] = [["id": projectID, "tabs": persistedTabs]]
      }
      windows[windowIndex]["spaces"] = spaces
    }
    root["windows"] = windows
    return root
  }

  private static func migrateVersion6(_ root: JSONObject) -> JSONObject {
    var root = root
    guard var windows = root["windows"] as? [JSONObject] else { return root }
    for windowIndex in windows.indices {
      guard var spaces = windows[windowIndex]["spaces"] as? [JSONObject] else { continue }
      for spaceIndex in spaces.indices {
        let projects = spaces[spaceIndex]["projects"] as? [JSONObject] ?? []
        var tabs: [JSONObject] = []
        var nodes: [JSONObject] = []
        for project in projects {
          for persistedTab in project["tabs"] as? [JSONObject] ?? [] {
            guard let id = persistedTab["id"], var tab = persistedTab["session"] as? JSONObject else {
              continue
            }
            tab["id"] = id
            tabs.append(tab)
            nodes.append([
              "item": ["kind": "tab", "id": id],
              "parent": ["kind": "root", "isPinned": false],
              "order": nodes.count,
            ])
          }
        }
        spaces[spaceIndex].removeValue(forKey: "projects")
        spaces[spaceIndex]["nodes"] = nodes
        spaces[spaceIndex]["groups"] = []
        spaces[spaceIndex]["collapsedGroupIDs"] = []
        spaces[spaceIndex]["tabs"] = tabs
        if spaces[spaceIndex]["selectedTabID"] == nil {
          spaces[spaceIndex]["selectedTabID"] = tabs.first?["id"]
        }
      }
      windows[windowIndex]["spaces"] = spaces
    }
    root["windows"] = windows
    return root
  }

  private static func migrateVersion7(_ root: JSONObject) -> JSONObject {
    var root = root
    guard let windows = root["windows"] as? [JSONObject] else { return root }
    var migratedWindows: [JSONObject] = []
    for window in windows {
      let selectedSpaceID = window["selectedSpaceID"]
      for spaceValue in window["spaces"] as? [JSONObject] ?? [] {
        var space = spaceValue
        guard let spaceID = space.removeValue(forKey: "id") else { continue }
        space["spaceID"] = spaceID
        if valuesEqual(spaceID, selectedSpaceID), let frame = window["frame"] {
          space["frame"] = frame
        }
        migratedWindows.append(space)
      }
    }
    root["windows"] = migratedWindows
    return root
  }

  private static func migrateVersion8(_ root: JSONObject) -> JSONObject {
    var root = root
    guard let windows = root["windows"] as? [JSONObject] else { return root }
    root["windows"] = windows.compactMap { window -> JSONObject? in
      var window = window
      guard let spaceID = window.removeValue(forKey: "spaceID") else { return nil }
      let frame = window.removeValue(forKey: "frame")
      var migrated: JSONObject = [
        "displayedSpaceID": spaceID,
        "spaces": [window.merging(["spaceID": spaceID]) { current, _ in current }],
      ]
      if let frame {
        migrated["frame"] = frame
      }
      return migrated
    }
    return root
  }

  private static func migrateVersion9(_ root: JSONObject) -> JSONObject {
    root
  }

  private static func migrateVersion10(_ root: JSONObject) -> JSONObject {
    transformObjects(in: root) { object in
      guard var children = object["activeChildren"] as? [JSONObject] else { return }
      for index in children.indices where children[index]["kind"] == nil {
        children[index]["kind"] =
          children[index]["role"] as? String == "workflow-subagent"
          ? "workflow"
          : "subagent"
      }
      object["activeChildren"] = children
    } as? JSONObject ?? root
  }

  private static func migrateVersion11(_ root: JSONObject) -> JSONObject {
    transformPaneLeaves(in: root) { leaf, _ in
      if leaf["restoreMode"] == nil {
        leaf["restoreMode"] = "shell"
      }
    } as? JSONObject ?? root
  }

  private static func migrateVersion12(_ root: JSONObject) -> JSONObject {
    transformObjects(in: root) { object in
      guard object["agent"] is String, object["sessionID"] is String else { return }
      let nativeRows = object["nativePlanRows"] as? [JSONObject] ?? []
      let transcriptRows = object["transcriptRows"] as? [JSONObject] ?? []
      var seenRowIDs: Set<String> = []
      object["progressRows"] = (nativeRows + transcriptRows).filter { row in
        guard let id = row["id"] as? String else { return true }
        return seenRowIDs.insert(id).inserted
      }
      object.removeValue(forKey: "transcriptPath")
      object.removeValue(forKey: "nativePlanRows")
      object.removeValue(forKey: "transcriptRows")
    } as? JSONObject ?? root
  }

  private static func transformPaneLeaves(
    in value: Any,
    path: [String] = [],
    transform: (inout JSONObject, [String]) -> Void
  ) -> Any {
    if var object = value as? JSONObject {
      if object["kind"] as? String == "leaf", var leaf = object["leaf"] as? JSONObject {
        transform(&leaf, path + ["leaf"])
        object["leaf"] = leaf
        return object
      }
      for key in Array(object.keys) {
        guard let child = object[key] else { continue }
        object[key] = transformPaneLeaves(in: child, path: path + [key], transform: transform)
      }
      return object
    }
    if let values = value as? [Any] {
      return values.enumerated().map { index, child in
        transformPaneLeaves(in: child, path: path + ["\(index)"], transform: transform)
      }
    }
    return value
  }

  private static func transformObjects(
    in value: Any,
    transform: (inout JSONObject) -> Void
  ) -> Any {
    if var object = value as? JSONObject {
      transform(&object)
      for key in Array(object.keys) {
        guard let child = object[key] else { continue }
        object[key] = transformObjects(in: child, transform: transform)
      }
      return object
    }
    if let values = value as? [Any] {
      return values.map { transformObjects(in: $0, transform: transform) }
    }
    return value
  }

  private static func paneLeafIDs(in value: Any) -> [Any] {
    guard let object = value as? JSONObject else { return [] }
    switch object["kind"] as? String {
    case "leaf":
      guard let leaf = object["leaf"] as? JSONObject, let id = leaf["id"] else { return [] }
      return [id]
    case "split":
      guard let split = object["split"] as? JSONObject else { return [] }
      return paneLeafIDs(in: split["left"] as Any) + paneLeafIDs(in: split["right"] as Any)
    default:
      return []
    }
  }

  private static func valuesEqual(_ lhs: Any?, _ rhs: Any?) -> Bool {
    guard let lhs = lhs as? NSObject else { return false }
    return lhs.isEqual(rhs)
  }

  private static func wrappedID(_ uuid: String) -> JSONObject {
    ["rawValue": uuid]
  }

  private static func stableUUID(path: [String]) -> String {
    let digest = Array(
      SHA256.hash(data: Data((["supaterm", "session"] + path).joined(separator: "/").utf8))
        .prefix(16)
    )
    let hex = digest.map { String(format: "%02X", $0) }.joined()
    return [
      String(hex.prefix(8)),
      String(hex.dropFirst(8).prefix(4)),
      String(hex.dropFirst(12).prefix(4)),
      String(hex.dropFirst(16).prefix(4)),
      String(hex.dropFirst(20).prefix(12)),
    ].joined(separator: "-")
  }
}

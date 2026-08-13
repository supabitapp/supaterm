import CryptoKit
import Foundation
import SupatermCLIShared

struct SPListSnapshot: Encodable, Equatable {
  enum Kind: String, Encodable, Equatable {
    case space
    case group
    case tab
    case pane

    var shortReferenceKind: SPShortReference.Kind {
      switch self {
      case .space:
        .space
      case .group:
        .group
      case .tab:
        .tab
      case .pane:
        .pane
      }
    }
  }

  struct Current: Encodable, Equatable {
    let windowIndex: Int
    let spaceID: UUID
    let tabID: UUID
    let paneID: UUID?
  }

  struct Agent: Encodable, Equatable {
    let kind: SupatermAgentKind
    let sessionID: String
    let phase: SupatermAppDebugSnapshot.AgentPhase
  }

  struct Item: Encodable, Equatable {
    let kind: Kind
    let id: UUID
    let parentID: UUID?
    let windowIndex: Int
    let title: String
    let cwd: String?
    let selected: Bool
    let isWarm: Bool?
    let agent: Agent?
  }

  let current: Current?
  let items: [Item]

  var revision: String {
    let payload = RevisionPayload(current: current, items: items)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let data = (try? encoder.encode(payload)) ?? Data()
    let digest = SHA256.hash(data: data)
    return digest.prefix(8).map { String(format: "%02x", $0) }.joined()
  }

  init(_ snapshot: SupatermAppDebugSnapshot) {
    current = Self.currentTarget(in: snapshot)
    items = snapshot.windows.flatMap(Self.items(in:))
  }

  init(current: Current?, items: [Item]) {
    self.current = current
    self.items = items
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(revision, forKey: .revision)
    try container.encodeIfPresent(current, forKey: .current)
    try container.encode(items, forKey: .items)
  }

  private enum CodingKeys: String, CodingKey {
    case revision
    case current
    case items
  }

  private struct RevisionPayload: Encodable {
    let current: Current?
    let items: [Item]
  }

  private static func items(in window: SupatermAppDebugSnapshot.Window) -> [Item] {
    window.spaces.flatMap { space in
      var items = [
        Item(
          kind: .space,
          id: space.id,
          parentID: nil,
          windowIndex: window.index,
          title: space.name,
          cwd: nil,
          selected: space.id == window.displayedSpaceID,
          isWarm: space.isWarm,
          agent: nil
        )
      ]
      for rootItem in space.rootItems {
        switch rootItem {
        case .group(let group):
          items.append(
            Item(
              kind: .group,
              id: group.id,
              parentID: space.id,
              windowIndex: window.index,
              title: group.title,
              cwd: nil,
              selected: false,
              isWarm: nil,
              agent: nil
            )
          )
          for tab in group.tabs {
            items.append(
              contentsOf: tabItems(
                tab,
                parentID: group.id,
                windowIndex: window.index
              ))
          }
        case .tab(let rootTab):
          items.append(
            contentsOf: tabItems(
              rootTab.tab,
              parentID: space.id,
              windowIndex: window.index
            ))
        }
      }
      return items
    }
  }

  private static func tabItems(
    _ tab: SupatermAppDebugSnapshot.Tab,
    parentID: UUID,
    windowIndex: Int
  ) -> [Item] {
    return [
      Item(
        kind: .tab,
        id: tab.id,
        parentID: parentID,
        windowIndex: windowIndex,
        title: tab.title,
        cwd: nil,
        selected: tab.isSelected,
        isWarm: nil,
        agent: nil
      )
    ]
      + tab.panes.map { pane in
        Item(
          kind: .pane,
          id: pane.id,
          parentID: tab.id,
          windowIndex: windowIndex,
          title: pane.displayTitle,
          cwd: pane.pwd,
          selected: pane.isFocused,
          isWarm: nil,
          agent: pane.agent.map {
            Agent(kind: $0.kind, sessionID: $0.sessionID, phase: $0.phase)
          }
        )
      }
  }

  private static func currentTarget(in snapshot: SupatermAppDebugSnapshot) -> Current? {
    if let target = snapshot.currentTarget {
      return Current(
        windowIndex: target.windowIndex,
        spaceID: target.spaceID,
        tabID: target.tabID,
        paneID: target.paneID
      )
    }

    guard snapshot.problems.isEmpty else { return nil }

    guard
      let window = snapshot.windows.first(where: \.isKey) ?? snapshot.windows.first,
      let space = window.spaces.first(where: { $0.id == window.displayedSpaceID })
        ?? window.spaces.first
    else { return nil }
    guard let tab = space.flattenedTabs.first(where: \.isSelected) ?? space.flattenedTabs.first
    else { return nil }
    let pane = tab.panes.first(where: \.isFocused) ?? tab.panes.first
    return Current(
      windowIndex: window.index,
      spaceID: space.id,
      tabID: tab.id,
      paneID: pane?.id
    )
  }
}

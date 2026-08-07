import Foundation

enum TerminalSidebarDragLog {
  static func activeFields(_ payload: TerminalSidebarDragPayload) -> [String] {
    operationFields(payload.operationID) + [
      "source=\(dragName(payload.source))",
      "sourceIDs=\(payload.source.itemIDs.map(rootID).joined(separator: ","))",
      "sourceSpace=\(SupatermLog.uuid(payload.topologyStamp.spaceID.rawValue))",
      "sourceRevision=\(payload.topologyStamp.revision)",
    ]
  }

  static func operationFields(_ operationID: TerminalTabMoveOperationID) -> [String] {
    ["operationID=\(SupatermLog.uuid(operationID.rawValue))"]
  }

  static func targetFields(_ plan: TerminalSidebarDropPlan) -> [String] {
    ["semanticTarget=\(semanticPath(plan.path))", "destination=\(destination(plan.destination))"]
  }

  static func coordinate(_ value: CGFloat) -> String {
    String(format: "%.1f", Double(value))
  }

  private static func dragName(_ value: TerminalSidebarDragSource) -> String {
    switch value {
    case .tabs: "tabs"
    case .group: "group"
    }
  }

  private static func rootID(_ id: TerminalTabRootItemID) -> String {
    switch id {
    case .tab(let id): "tab:\(SupatermLog.uuid(id.rawValue))"
    case .group(let id): "group:\(SupatermLog.uuid(id.rawValue))"
    }
  }

  private static func semanticPath(_ path: TerminalSidebarSemanticPath) -> String {
    switch path {
    case .rootItem(let index): "rootItem:\(index)"
    case .rootBoundary(let index, let affinity): "rootBoundary:\(index):\(affinity)"
    case .group(let id, let index): "group:\(SupatermLog.uuid(id.rawValue)):\(index)"
    case .pinnedEnd: "pinnedEnd"
    case .trailingRoot: "trailingRoot"
    }
  }

  private static func destination(_ destination: TerminalSidebarDropDestination) -> String {
    switch destination {
    case .root(let isPinned, let index): "root:\(isPinned):\(index)"
    case .group(let id, let index): "group:\(SupatermLog.uuid(id.rawValue)):\(index)"
    }
  }
}

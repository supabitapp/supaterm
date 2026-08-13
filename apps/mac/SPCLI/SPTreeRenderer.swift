import Foundation
import SupatermCLIShared

enum SPTreeRenderer {
  static func render(_ snapshot: SPListSnapshot) -> String {
    var lines: [String] = []
    let windowIndexes = snapshot.items.map(\.windowIndex).reduce(into: [Int]()) { indexes, index in
      if indexes.last != index {
        indexes.append(index)
      }
    }
    for (offset, windowIndex) in windowIndexes.enumerated() {
      let isCurrent = snapshot.current?.windowIndex == windowIndex
      lines.append(isCurrent ? "window \(windowIndex) [current]" : "window \(windowIndex)")
      let spaces = snapshot.items.filter {
        $0.windowIndex == windowIndex && $0.kind == .space
      }
      lines.append(contentsOf: renderChildren(spaces, snapshot: snapshot, prefix: ""))
      if offset < windowIndexes.count - 1 {
        lines.append("")
      }
    }
    return lines.joined(separator: "\n")
  }

  static func renderPlain(_ snapshot: SPListSnapshot) -> String {
    snapshot.items.map { item in
      let parent = parentReference(for: item, snapshot: snapshot) ?? "-"
      let agent =
        item.agent.map {
          "\($0.kind.rawValue):\($0.phase.rawValue):\($0.sessionID)"
        } ?? "-"
      return [
        reference(for: item, snapshot: snapshot),
        item.kind.rawValue,
        selector(for: item, snapshot: snapshot) ?? "-",
        String(item.windowIndex),
        parent,
        item.selected ? "selected" : item.isWarm == false ? "cold" : "-",
        escaped(item.title),
        escaped(item.cwd ?? "-"),
        escaped(agent),
      ].joined(separator: "\t")
    }.joined(separator: "\n")
  }

  private static func renderChildren(
    _ items: [SPListSnapshot.Item],
    snapshot: SPListSnapshot,
    prefix: String
  ) -> [String] {
    items.enumerated().flatMap { offset, item in
      let isLast = offset == items.count - 1
      let branch = isLast ? "└─ " : "├─ "
      let childPrefix = prefix + (isLast ? "   " : "│  ")
      let children = snapshot.items.filter {
        $0.windowIndex == item.windowIndex && $0.parentID == item.id
      }
      return ["\(prefix)\(branch)\(itemLine(item, snapshot: snapshot))"]
        + renderChildren(children, snapshot: snapshot, prefix: childPrefix)
    }
  }

  private static func itemLine(_ item: SPListSnapshot.Item, snapshot: SPListSnapshot) -> String {
    let selector = selector(for: item, snapshot: snapshot).map { " \($0)" } ?? ""
    let title = "\"\(escaped(item.title, quoted: true))\""
    var labels: [String] = []
    if item.selected {
      labels.append("selected")
    }
    if item.isWarm == false {
      labels.append("cold")
    }
    if let agent = item.agent {
      labels.append("\(agent.kind.rawValue):\(agent.phase.rawValue)")
    }
    if let cwd = item.cwd {
      labels.append("cwd=\"\(escaped(cwd, quoted: true))\"")
    }
    let suffix = labels.isEmpty ? "" : " [\(labels.joined(separator: ", "))]"
    let reference = reference(for: item, snapshot: snapshot)
    return "\(reference) \(item.kind.rawValue)\(selector) \(title)\(suffix)"
  }

  private static func reference(
    for item: SPListSnapshot.Item,
    snapshot: SPListSnapshot
  ) -> String {
    SPShortReference.display(
      kind: item.kind.shortReferenceKind,
      id: item.id,
      among: snapshot.items.filter { $0.kind == item.kind }.map(\.id)
    )
  }

  private static func parentReference(
    for item: SPListSnapshot.Item,
    snapshot: SPListSnapshot
  ) -> String? {
    guard let parentID = item.parentID else { return nil }
    guard
      let parent = snapshot.items.first(where: {
        $0.windowIndex == item.windowIndex && $0.id == parentID
      })
    else { return nil }
    return reference(for: parent, snapshot: snapshot)
  }

  private static func selector(
    for item: SPListSnapshot.Item,
    snapshot: SPListSnapshot
  ) -> String? {
    switch item.kind {
    case .space:
      guard
        let index = snapshot.items.filter({
          $0.windowIndex == item.windowIndex && $0.kind == .space
        }).firstIndex(where: { $0.id == item.id })
      else { return nil }
      return String(index + 1)
    case .group:
      return nil
    case .tab:
      guard
        let targetSpaceID = spaceID(for: item, snapshot: snapshot),
        let index = snapshot.items.filter({ candidate in
          candidate.windowIndex == item.windowIndex && candidate.kind == .tab
            && spaceID(for: candidate, snapshot: snapshot) == targetSpaceID
        }).firstIndex(where: { $0.id == item.id }),
        let space = snapshot.items.first(where: {
          $0.windowIndex == item.windowIndex && $0.kind == .space && $0.id == targetSpaceID
        }),
        let spaceSelector = selector(for: space, snapshot: snapshot)
      else { return nil }
      return "\(spaceSelector)/\(index + 1)"
    case .pane:
      guard
        let tabID = item.parentID,
        let tab = snapshot.items.first(where: {
          $0.windowIndex == item.windowIndex && $0.kind == .tab && $0.id == tabID
        }),
        let tabSelector = selector(for: tab, snapshot: snapshot),
        let index = snapshot.items.filter({
          $0.windowIndex == item.windowIndex && $0.kind == .pane && $0.parentID == tabID
        }).firstIndex(where: { $0.id == item.id })
      else { return nil }
      return "\(tabSelector)/\(index + 1)"
    }
  }

  private static func spaceID(
    for tab: SPListSnapshot.Item,
    snapshot: SPListSnapshot
  ) -> UUID? {
    guard let parentID = tab.parentID else { return nil }
    guard
      let parent = snapshot.items.first(where: {
        $0.windowIndex == tab.windowIndex && $0.id == parentID
      })
    else { return nil }
    switch parent.kind {
    case .space:
      return parent.id
    case .group:
      return parent.parentID
    case .tab, .pane:
      return nil
    }
  }

  private static func escaped(_ value: String, quoted: Bool = false) -> String {
    value.unicodeScalars.map { scalar in
      switch scalar.value {
      case 9:
        return "\\t"
      case 10:
        return "\\n"
      case 13:
        return "\\r"
      case 34 where quoted:
        return "\\\""
      case 92:
        return "\\\\"
      default:
        switch scalar.properties.generalCategory {
        case .control, .format, .lineSeparator, .paragraphSeparator:
          return "\\u{\(String(scalar.value, radix: 16, uppercase: false))}"
        default:
          return String(scalar)
        }
      }
    }.joined()
  }
}

struct SPDebugReport: Encodable {
  struct Invocation: Encodable {
    let isRunningInsideSupaterm: Bool
    let context: SupatermCLIContext?
    let explicitSocketPath: String?
    let environmentSocketPath: String?
    let requestedInstance: String?
    let selectionSource: String?
    let resolvedSocketPath: String?
  }

  struct Discovery: Encodable {
    let reachableInstances: [SupatermSocketEndpoint]
    let removedStalePaths: [String]
  }

  struct Socket: Encodable {
    var path: String?
    var isReachable: Bool
    var requestSucceeded: Bool
    var error: String?
  }

  let invocation: Invocation
  let discovery: Discovery
  let socket: Socket
  let app: SupatermAppDebugSnapshot?
  let problems: [String]
}

enum SPDebugRenderer {
  static func render(_ report: SPDebugReport) -> String {
    var lines = section(
      "Invocation",
      [
        "inside Supaterm: \(yesNo(report.invocation.isRunningInsideSupaterm))",
        "surface: \(report.invocation.context?.surfaceID.uuidString ?? "none")",
        "tab: \(report.invocation.context?.tabID.uuidString ?? "none")",
        "explicit socket path: \(report.invocation.explicitSocketPath ?? "none")",
        "environment socket path: \(report.invocation.environmentSocketPath ?? "none")",
        "requested instance: \(report.invocation.requestedInstance ?? "none")",
        "selection source: \(report.invocation.selectionSource ?? "none")",
        "resolved socket path: \(report.invocation.resolvedSocketPath ?? "none")",
      ]
    )

    lines.append("")
    lines.append(
      contentsOf: section(
        "Discovery",
        [
          "reachable instances: \(report.discovery.reachableInstances.count)",
          "removed stale paths: \(report.discovery.removedStalePaths.count)",
        ]
      ))

    if !report.discovery.reachableInstances.isEmpty {
      lines.append(
        contentsOf: report.discovery.reachableInstances.map { endpoint in
          "- \(SPSocketSelection.formatEndpoint(endpoint))"
        })
    }

    if !report.discovery.removedStalePaths.isEmpty {
      lines.append(
        contentsOf: report.discovery.removedStalePaths.map { path in
          "- removed stale socket: \(path)"
        })
    }

    lines.append("")
    lines.append(
      contentsOf: section(
        "Socket",
        [
          "path: \(report.socket.path ?? "none")",
          "reachable: \(yesNo(report.socket.isReachable))",
          "request succeeded: \(yesNo(report.socket.requestSucceeded))",
          "error: \(report.socket.error ?? "none")",
        ]
      ))

    if let app = report.app {
      lines.append(contentsOf: appLines(app))
    }

    let allProblems = report.problems + (report.app?.problems ?? [])
    if !allProblems.isEmpty {
      lines.append("")
      lines.append("Problems")
      lines.append(contentsOf: allProblems.map { "- \($0)" })
    }

    return lines.joined(separator: "\n")
  }

  private static func appLines(_ app: SupatermAppDebugSnapshot) -> [String] {
    var lines = [""]
    lines.append(
      contentsOf: section(
        "App",
        [
          "version: \(app.build.version.isEmpty ? "unknown" : app.build.version)",
          "build: \(app.build.buildNumber.isEmpty ? "unknown" : app.build.buildNumber)",
          "development build: \(yesNo(app.build.isDevelopmentBuild))",
          "stub update checks: \(yesNo(app.build.usesStubUpdateChecks))",
        ]
      ))

    lines.append("")
    lines.append(
      contentsOf: section(
        "Windows",
        [
          "window count: \(app.summary.windowCount)",
          "space count: \(app.summary.spaceCount)",
          "tab count: \(app.summary.tabCount)",
          "pane count: \(app.summary.paneCount)",
          "key window: \(app.summary.keyWindowIndex.map(String.init) ?? "none")",
        ]
      ))

    lines.append("")
    lines.append(contentsOf: currentTargetSection(app))

    if let currentTab = currentTab(in: app) {
      lines.append("")
      lines.append(
        contentsOf: section(
          "Current Tab",
          [
            "title: \(currentTab.title)",
            "selected: \(yesNo(currentTab.isSelected))",
            "dirty: \(yesNo(currentTab.isDirty))",
            "title locked: \(yesNo(currentTab.isTitleLocked))",
            "running: \(yesNo(currentTab.hasRunningActivity))",
            "bell: \(yesNo(currentTab.hasBell))",
            "read only: \(yesNo(currentTab.hasReadOnly))",
            "secure input: \(yesNo(currentTab.hasSecureInput))",
          ]
        ))
    }

    if let currentPane = currentPane(in: app) {
      lines.append("")
      lines.append(
        contentsOf: section(
          "Current Pane",
          [
            "title: \(currentPane.displayTitle)",
            "pwd: \(currentPane.pwd ?? "none")",
            "foreground process group: \(value(currentPane.foregroundProcessGroupID))",
            "tty: \(currentPane.ttyName ?? "none")",
            "focused: \(yesNo(currentPane.isFocused))",
            "read only: \(yesNo(currentPane.isReadOnly))",
            "secure input: \(yesNo(currentPane.hasSecureInput))",
            "bell count: \(currentPane.bellCount)",
            "running: \(yesNo(currentPane.isRunning))",
            "progress: \(progressDescription(currentPane))",
            "close confirmation: \(yesNo(currentPane.needsCloseConfirmation))",
            "last command exit: \(value(currentPane.lastCommandExitCode))",
            "last command duration ms: \(value(currentPane.lastCommandDurationMs))",
            "last child exit: \(value(currentPane.lastChildExitCode))",
            "last child exit time ms: \(value(currentPane.lastChildExitTimeMs))",
          ]
        ))
    }

    lines.append("")
    lines.append(
      contentsOf: section(
        "Update",
        [
          "can check for updates: \(yesNo(app.update.canCheckForUpdates))",
          "phase: \(app.update.phase)",
          "detail: \(app.update.detail.isEmpty ? "none" : app.update.detail)",
        ]
      ))

    lines.append("")
    lines.append("Topology")
    lines.append(SPDiagnosticTopologyRenderer.render(app))
    return lines
  }

  private static func currentTargetSection(_ app: SupatermAppDebugSnapshot) -> [String] {
    guard let currentTarget = app.currentTarget else {
      return section(
        "Current Target",
        ["unresolved"]
      )
    }

    return section(
      "Current Target",
      [
        "window: \(currentTarget.windowIndex)",
        "space: \(currentTarget.spaceIndex) \"\(currentTarget.spaceName)\"",
        "tab: \(currentTarget.tabIndex) \"\(currentTarget.tabTitle)\"",
        "pane: \(currentTarget.paneIndex.map(String.init) ?? "none")",
      ]
    )
  }

  private static func currentTab(
    in app: SupatermAppDebugSnapshot
  ) -> SupatermAppDebugSnapshot.Tab? {
    guard let currentTarget = app.currentTarget else { return nil }

    for window in app.windows {
      for space in window.spaces {
        if let tab = space.flattenedTabs.first(where: { $0.id == currentTarget.tabID }) {
          return tab
        }
      }
    }

    return nil
  }

  private static func currentPane(
    in app: SupatermAppDebugSnapshot
  ) -> SupatermAppDebugSnapshot.Pane? {
    guard let paneID = app.currentTarget?.paneID else { return nil }

    for window in app.windows {
      for space in window.spaces {
        for tab in space.flattenedTabs {
          if let pane = tab.panes.first(where: { $0.id == paneID }) {
            return pane
          }
        }
      }
    }

    return nil
  }

  private static func progressDescription(
    _ pane: SupatermAppDebugSnapshot.Pane
  ) -> String {
    guard let progressState = pane.progressState else {
      return "none"
    }
    guard let progressValue = pane.progressValue else {
      return progressState
    }
    return "\(progressState) \(progressValue)"
  }

  private static func section(
    _ title: String,
    _ rows: [String]
  ) -> [String] {
    [title] + rows
  }

  private static func yesNo(_ value: Bool) -> String {
    value ? "yes" : "no"
  }

  private static func value<T: CustomStringConvertible>(_ value: T?) -> String {
    value?.description ?? "none"
  }
}

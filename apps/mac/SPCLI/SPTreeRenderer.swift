import Foundation
import SupatermCLIShared

enum SPTreeRenderer {
  private struct Snapshot {
    struct Window {
      let index: Int
      let isKey: Bool
      let spaces: [Space]
    }

    struct Space {
      let index: Int
      let name: String
      let isSelected: Bool
      let tabs: [Tab]
    }

    struct Tab {
      let index: Int
      let title: String
      let isSelected: Bool
      let panes: [Pane]
    }

    struct Pane {
      let index: Int
      let displayTitle: String?
      let isFocused: Bool
    }

    let windows: [Window]
  }

  static func render(_ snapshot: SupatermTreeSnapshot) -> String {
    render(projectedSnapshot(from: snapshot))
  }

  static func render(_ snapshot: SupatermAppDebugSnapshot) -> String {
    render(projectedSnapshot(from: snapshot))
  }

  static func renderPlain(_ snapshot: SupatermTreeSnapshot) -> String {
    renderPlain(projectedSnapshot(from: snapshot))
  }

  static func renderPlain(_ snapshot: SupatermAppDebugSnapshot) -> String {
    renderPlain(projectedSnapshot(from: snapshot))
  }

  private static func render(_ snapshot: Snapshot) -> String {
    var lines: [String] = []

    for (windowOffset, window) in snapshot.windows.enumerated() {
      lines.append(windowLine(window))
      lines.append(contentsOf: renderSpaces(window.spaces))

      if windowOffset < snapshot.windows.count - 1 {
        lines.append("")
      }
    }

    return lines.joined(separator: "\n")
  }

  private static func renderPlain(_ snapshot: Snapshot) -> String {
    snapshot.windows.flatMap { window in
      window.spaces.flatMap { space in
        let spaceSelector = "\(space.index)"
        let spaceFlags = space.isSelected ? "\tselected" : ""
        let spaceLine = "\(spaceSelector)\tspace\t\(space.name)\(spaceFlags)"

        let tabLines = space.tabs.flatMap { tab -> [String] in
          let tabSelector = "\(space.index)/\(tab.index)"
          let tabFlags = tab.isSelected ? "\tselected" : ""
          let tabLine = "\(tabSelector)\ttab\t\(tab.title)\(tabFlags)"

          let paneLines = tab.panes.map { pane in
            let paneSelector = "\(space.index)/\(tab.index)/\(pane.index)"
            return plainPaneLine(pane, selector: paneSelector)
          }

          return [tabLine] + paneLines
        }

        return [spaceLine] + tabLines
      }
    }
    .joined(separator: "\n")
  }

  private static func projectedSnapshot(from snapshot: SupatermTreeSnapshot) -> Snapshot {
    .init(
      windows: snapshot.windows.map { window in
        .init(
          index: window.index,
          isKey: window.isKey,
          spaces: window.spaces.map { space in
            .init(
              index: space.index,
              name: space.name,
              isSelected: space.isSelected,
              tabs: space.tabs.map { tab in
                .init(
                  index: tab.index,
                  title: tab.title,
                  isSelected: tab.isSelected,
                  panes: tab.panes.map { pane in
                    .init(
                      index: pane.index,
                      displayTitle: nil,
                      isFocused: pane.isFocused
                    )
                  }
                )
              }
            )
          }
        )
      }
    )
  }

  private static func projectedSnapshot(from snapshot: SupatermAppDebugSnapshot) -> Snapshot {
    .init(
      windows: snapshot.windows.map { window in
        .init(
          index: window.index,
          isKey: window.isKey,
          spaces: window.spaces.map { space in
            .init(
              index: space.index,
              name: space.name,
              isSelected: space.isSelected,
              tabs: space.tabs.map { tab in
                .init(
                  index: tab.index,
                  title: tab.title,
                  isSelected: tab.isSelected,
                  panes: tab.panes.map { pane in
                    .init(
                      index: pane.index,
                      displayTitle: pane.displayTitle,
                      isFocused: pane.isFocused
                    )
                  }
                )
              }
            )
          }
        )
      }
    )
  }

  private static func renderSpaces(_ spaces: [Snapshot.Space]) -> [String] {
    spaces.enumerated().flatMap { spaceOffset, space in
      let isLastSpace = spaceOffset == spaces.count - 1
      let spaceBranch = isLastSpace ? "└─ " : "├─ "
      let spacePrefix = isLastSpace ? "   " : "│  "

      var lines = ["\(spaceBranch)\(spaceLine(space))"]
      lines.append(contentsOf: renderTabs(space.tabs, prefix: spacePrefix))
      return lines
    }
  }

  private static func renderTabs(
    _ tabs: [Snapshot.Tab],
    prefix: String
  ) -> [String] {
    tabs.enumerated().flatMap { tabOffset, tab in
      let isLastTab = tabOffset == tabs.count - 1
      let tabBranch = isLastTab ? "└─ " : "├─ "
      let tabPrefix = prefix + (isLastTab ? "   " : "│  ")

      var lines = ["\(prefix)\(tabBranch)\(tabLine(tab))"]
      lines.append(
        contentsOf: tab.panes.enumerated().map { paneOffset, pane in
          let paneBranch = paneOffset == tab.panes.count - 1 ? "└─ " : "├─ "
          return "\(tabPrefix)\(paneBranch)\(paneLine(pane))"
        }
      )
      return lines
    }
  }

  private static func windowLine(_ window: Snapshot.Window) -> String {
    var labels: [String] = []
    if window.isKey {
      labels.append("key")
    }

    if labels.isEmpty {
      return "window \(window.index)"
    }
    return "window \(window.index) [\(labels.joined(separator: ", "))]"
  }

  private static func spaceLine(_ space: Snapshot.Space) -> String {
    var labels: [String] = []
    if space.isSelected {
      labels.append("selected")
    }

    if labels.isEmpty {
      return "space \(space.index) \"\(space.name)\""
    }
    return "space \(space.index) \"\(space.name)\" [\(labels.joined(separator: ", "))]"
  }

  private static func tabLine(_ tab: Snapshot.Tab) -> String {
    var labels: [String] = []
    if tab.isSelected {
      labels.append("selected")
    }

    if labels.isEmpty {
      return "tab \(tab.index) \"\(tab.title)\""
    }
    return "tab \(tab.index) \"\(tab.title)\" [\(labels.joined(separator: ", "))]"
  }

  private static func paneLine(_ pane: Snapshot.Pane) -> String {
    var labels: [String] = []
    if pane.isFocused {
      labels.append("focused")
    }
    let title = pane.displayTitle.map { " \"\($0)\"" } ?? ""

    if labels.isEmpty {
      return "pane \(pane.index)\(title)"
    }
    return "pane \(pane.index)\(title) [\(labels.joined(separator: ", "))]"
  }

  private static func plainPaneLine(_ pane: Snapshot.Pane, selector: String) -> String {
    var columns = [selector, "pane"]
    if let displayTitle = pane.displayTitle {
      columns.append(displayTitle)
    }
    if pane.isFocused {
      columns.append("focused")
    }
    return columns.joined(separator: "\t")
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
      lines.append("")
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
              "pinned: \(yesNo(currentTab.isPinned))",
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
      lines.append(SPTreeRenderer.render(app))
    }

    let allProblems = report.problems + (report.app?.problems ?? [])
    if !allProblems.isEmpty {
      lines.append("")
      lines.append("Problems")
      lines.append(contentsOf: allProblems.map { "- \($0)" })
    }

    return lines.joined(separator: "\n")
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
        if let tab = space.tabs.first(where: { $0.id == currentTarget.tabID }) {
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
        for tab in space.tabs {
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

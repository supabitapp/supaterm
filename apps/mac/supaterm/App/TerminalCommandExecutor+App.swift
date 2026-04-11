import ComposableArchitecture
import Foundation
import SupatermCLIShared
import SupatermUpdateFeature

extension TerminalCommandExecutor {
  func treeSnapshot() -> SupatermTreeSnapshot {
    let windows: [SupatermTreeSnapshot.Window] = registry.activeEntries().enumerated().map {
      offset,
      entry in
      let snapshot = entry.terminal.treeSnapshot()
      return SupatermTreeSnapshot.Window(
        index: offset + 1,
        isKey: entry.terminal.windowActivity.isKeyWindow,
        spaces: snapshot.windows.first?.spaces ?? []
      )
    }
    return .init(windows: windows)
  }

  func onboardingSnapshot() -> SupatermOnboardingSnapshot? {
    guard let entry = registry.shortcutEntry() else { return nil }
    return SupatermOnboardingSnapshotBuilder.snapshot(hasShortcutSource: true) { action in
      entry.keyboardShortcutForAction(action)
    }
  }

  func debugSnapshot(_ request: SupatermDebugRequest) -> SupatermAppDebugSnapshot {
    let activeEntries = registry.activeEntries()
    let windows = activeEntries.enumerated().map { offset, entry in
      entry.terminal.debugWindowSnapshot(index: offset + 1)
    }
    let resolution = SupatermDebugSnapshotResolver.resolve(
      windows: windows,
      context: request.context
    )
    let updateEntry =
      activeEntries.first(where: { $0.terminal.windowActivity.isKeyWindow })
      ?? activeEntries.first
    var problems = resolution.problems
    if windows.isEmpty {
      problems.append("No active windows.")
    }

    return .init(
      build: .init(
        version: AppBuild.version,
        buildNumber: AppBuild.buildNumber,
        isDevelopmentBuild: AppBuild.isDevelopmentBuild,
        usesStubUpdateChecks: AppBuild.usesStubUpdateChecks
      ),
      update: updateSnapshot(updateEntry.map { $0.store.withState(\.update) }),
      summary: .init(
        windowCount: windows.count,
        spaceCount: windows.reduce(0) { $0 + $1.spaces.count },
        tabCount: windows.reduce(0) { partial, window in
          partial + window.spaces.reduce(0) { $0 + $1.tabs.count }
        },
        paneCount: windows.reduce(0) { partial, window in
          partial
            + window.spaces.reduce(0) { spacePartial, space in
              spacePartial + space.tabs.reduce(0) { $0 + $1.panes.count }
            }
        },
        keyWindowIndex: windows.first(where: \.isKey)?.index
      ),
      currentTarget: resolution.currentTarget,
      windows: windows,
      problems: problems
    )
  }

  func notify(_ request: TerminalNotifyRequest) throws -> SupatermNotifyResult {
    switch request.target {
    case .contextPane:
      return try notifyContextPane(request)

    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      let entry = try registry.entry(for: windowIndex)
      let localRequest = TerminalNotifyRequest(
        body: request.body,
        subtitle: request.subtitle,
        target: .pane(
          windowIndex: 1,
          spaceIndex: spaceIndex,
          tabIndex: tabIndex,
          paneIndex: paneIndex
        ),
        title: request.title
      )
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.notify(localRequest),
          windowIndex: windowIndex
        )
      } catch let error as TerminalCreatePaneError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }

    case .tab(let windowIndex, let spaceIndex, let tabIndex):
      let entry = try registry.entry(for: windowIndex)
      let localRequest = TerminalNotifyRequest(
        body: request.body,
        subtitle: request.subtitle,
        target: .tab(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex),
        title: request.title
      )
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.notify(localRequest),
          windowIndex: windowIndex
        )
      } catch let error as TerminalCreatePaneError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func notifyContextPane(_ request: TerminalNotifyRequest) throws -> SupatermNotifyResult {
    for (offset, entry) in registry.activeEntries().enumerated() {
      do {
        let result = try entry.terminal.notify(request)
        return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
      } catch let error as TerminalCreatePaneError {
        if case .contextPaneNotFound = error {
          continue
        }
        throw error
      }
    }
    throw TerminalCreatePaneError.contextPaneNotFound
  }

  func notifyStructuredAgent(
    _ request: TerminalNotifyRequest,
    semantic: TerminalHostState.NotificationSemantic
  ) throws -> SupatermNotifyResult {
    for (offset, entry) in registry.activeEntries().enumerated() {
      do {
        let result = try entry.terminal.notifyStructuredAgent(request, semantic: semantic)
        return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
      } catch let error as TerminalCreatePaneError {
        if case .contextPaneNotFound = error {
          continue
        }
        throw error
      }
    }
    throw TerminalCreatePaneError.contextPaneNotFound
  }

  func updateSnapshot(_ state: UpdateFeature.State?) -> SupatermAppDebugSnapshot.Update {
    guard let state else {
      return .init(
        canCheckForUpdates: false,
        phase: "idle",
        detail: ""
      )
    }
    return .init(
      canCheckForUpdates: state.canCheckForUpdates,
      phase: state.phase.debugIdentifier,
      detail: state.phase.detailMessage
    )
  }
}

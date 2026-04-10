import AppKit
import ComposableArchitecture
import Foundation
import SupatermCLIShared
import SupatermSocketFeature
import SupatermSupport
import SupatermTerminalCore
import SupatermUpdateFeature

@MainActor
final class TerminalCommandExecutor: TerminalAgentSessionStoreDelegate {
  private struct AgentHookNotification {
    let body: String
    let semantic: TerminalHostState.NotificationSemantic
    let subtitle: String
  }

  private let agentSessionStore: TerminalAgentSessionStore
  private unowned let registry: TerminalWindowRegistry

  init<C: Clock<Duration>>(
    registry: TerminalWindowRegistry,
    agentRunningTimeout: Duration = .seconds(15),
    transcriptPollInterval: Duration = .seconds(1),
    clock: C = ContinuousClock()
  ) {
    self.registry = registry
    let sleep = { (duration: Duration) in
      try await clock.sleep(for: duration)
    }
    agentSessionStore = TerminalAgentSessionStore(
      agentRunningTimeout: agentRunningTimeout,
      transcriptPollInterval: transcriptPollInterval,
      sleep: sleep
    )
    agentSessionStore.delegate = self
  }

  func attach(terminal: TerminalHostState) {
    terminal.onCommandFinished = { [weak self] surfaceID in
      self?.agentSessionStore.clearSessions(for: surfaceID)
    }
  }

  func execute(_ request: SocketRequestExecutor.AppRequest) throws -> SocketRequestExecutor.AppResult {
    switch request {
    case .onboardingSnapshot:
      return .onboardingSnapshot(onboardingSnapshot())
    case .debugSnapshot(let debugRequest):
      return .debugSnapshot(debugSnapshot(debugRequest))
    case .treeSnapshot:
      return .treeSnapshot(treeSnapshot())
    case .notify(let notifyRequest):
      return .notify(try notify(notifyRequest))
    case .agentHook(let hookRequest):
      return .agentHook(try handleAgentHook(hookRequest))
    }
  }

  func execute(
    _ request: SocketRequestExecutor.TerminalCreationRequest
  ) throws -> SocketRequestExecutor.TerminalCreationResult {
    switch request {
    case .createTab(let createTabRequest):
      return .createTab(try createTab(createTabRequest))
    case .createPane(let createPaneRequest):
      return .createPane(try createPane(createPaneRequest))
    }
  }

  func execute(
    _ request: SocketRequestExecutor.TerminalPaneRequest
  ) throws -> SocketRequestExecutor.TerminalPaneResult {
    switch request {
    case .focusPane(let target):
      return .focusPane(try focusPane(target))
    case .lastPane(let target):
      return .lastPane(try lastPane(target))
    case .closePane(let target):
      return .closePane(try closePane(target))
    case .sendText(let sendTextRequest):
      return .sendText(try sendText(sendTextRequest))
    case .sendKey(let sendKeyRequest):
      return .sendKey(try sendKey(sendKeyRequest))
    case .capturePane(let capturePaneRequest):
      return .capturePane(try capturePane(capturePaneRequest))
    case .resizePane(let resizePaneRequest):
      return .resizePane(try resizePane(resizePaneRequest))
    case .setPaneSize(let setPaneSizeRequest):
      return .setPaneSize(try setPaneSize(setPaneSizeRequest))
    }
  }

  func execute(
    _ request: SocketRequestExecutor.TerminalTabRequest
  ) throws -> SocketRequestExecutor.TerminalTabResult {
    switch request {
    case .tilePanes(let tilePanesRequest):
      return .tilePanes(try tilePanes(tilePanesRequest))
    case .equalizePanes(let equalizePanesRequest):
      return .equalizePanes(try equalizePanes(equalizePanesRequest))
    case .mainVerticalPanes(let mainVerticalPanesRequest):
      return .mainVerticalPanes(try mainVerticalPanes(mainVerticalPanesRequest))
    case .selectTab(let target):
      return .selectTab(try selectTab(target))
    case .closeTab(let target):
      return .closeTab(try closeTab(target))
    case .renameTab(let renameTabRequest):
      return .renameTab(try renameTab(renameTabRequest))
    case .nextTab(let navigationRequest):
      return .nextTab(try nextTab(navigationRequest))
    case .previousTab(let navigationRequest):
      return .previousTab(try previousTab(navigationRequest))
    case .lastTab(let navigationRequest):
      return .lastTab(try lastTab(navigationRequest))
    }
  }

  func execute(
    _ request: SocketRequestExecutor.TerminalSpaceRequest
  ) throws -> SocketRequestExecutor.TerminalSpaceResult {
    switch request {
    case .createSpace(let createSpaceRequest):
      return .createSpace(try createSpace(createSpaceRequest))
    case .selectSpace(let target):
      return .selectSpace(try selectSpace(target))
    case .closeSpace(let target):
      return .closeSpace(try closeSpace(target))
    case .renameSpace(let renameSpaceRequest):
      return .renameSpace(try renameSpace(renameSpaceRequest))
    case .nextSpace(let navigationRequest):
      return .nextSpace(try nextSpace(navigationRequest))
    case .previousSpace(let navigationRequest):
      return .previousSpace(try previousSpace(navigationRequest))
    case .lastSpace(let navigationRequest):
      return .lastSpace(try lastSpace(navigationRequest))
    }
  }

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

  func createTab(_ request: TerminalCreateTabRequest) throws -> SupatermNewTabResult {
    switch request.target {
    case .contextPane:
      return try createContextTab(request)

    case .space(let windowIndex, let spaceIndex):
      let entry = try registry.entry(for: windowIndex)
      let localRequest = TerminalCreateTabRequest(
        command: request.command,
        cwd: request.cwd,
        focus: request.focus,
        target: .space(windowIndex: 1, spaceIndex: spaceIndex)
      )
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.createTab(localRequest),
          windowIndex: windowIndex
        )
      } catch let error as TerminalCreateTabError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func createPane(_ request: TerminalCreatePaneRequest) throws -> SupatermNewPaneResult {
    switch request.target {
    case .contextPane:
      return try createContextPane(request)

    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      let entry = try registry.entry(for: windowIndex)
      let localRequest = TerminalCreatePaneRequest(
        command: request.command,
        cwd: request.cwd,
        direction: request.direction,
        focus: request.focus,
        equalize: request.equalize,
        target: .pane(
          windowIndex: 1,
          spaceIndex: spaceIndex,
          tabIndex: tabIndex,
          paneIndex: paneIndex
        )
      )
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.createPane(localRequest),
          windowIndex: windowIndex
        )
      } catch let error as TerminalCreatePaneError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }

    case .tab(let windowIndex, let spaceIndex, let tabIndex):
      let entry = try registry.entry(for: windowIndex)
      let localRequest = TerminalCreatePaneRequest(
        command: request.command,
        cwd: request.cwd,
        direction: request.direction,
        focus: request.focus,
        equalize: request.equalize,
        target: .tab(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex)
      )
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.createPane(localRequest),
          windowIndex: windowIndex
        )
      } catch let error as TerminalCreatePaneError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func focusPane(_ target: TerminalPaneTarget) throws -> SupatermFocusPaneResult {
    switch target {
    case .contextPane:
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.focusPane(target)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      let entry = try registry.entry(for: windowIndex)
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.focusPane(
            .pane(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex, paneIndex: paneIndex)
          ),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func lastPane(_ target: TerminalPaneTarget) throws -> SupatermFocusPaneResult {
    switch target {
    case .contextPane:
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.lastPane(target)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      let entry = try registry.entry(for: windowIndex)
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.lastPane(
            .pane(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex, paneIndex: paneIndex)
          ),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func closePane(_ target: TerminalPaneTarget) throws -> SupatermClosePaneResult {
    switch target {
    case .contextPane:
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.closePane(target)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      let entry = try registry.entry(for: windowIndex)
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.closePane(
            .pane(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex, paneIndex: paneIndex)
          ),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func selectTab(_ target: TerminalTabTarget) throws -> SupatermSelectTabResult {
    switch target {
    case .contextPane:
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.selectTab(target)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .tab(let windowIndex, let spaceIndex, let tabIndex):
      let entry = try registry.entry(for: windowIndex)
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.selectTab(
            .tab(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex)
          ),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func closeTab(_ target: TerminalTabTarget) throws -> SupatermCloseTabResult {
    switch target {
    case .contextPane:
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.closeTab(target)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .tab(let windowIndex, let spaceIndex, let tabIndex):
      let entry = try registry.entry(for: windowIndex)
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.closeTab(
            .tab(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex)
          ),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func sendText(_ request: TerminalSendTextRequest) throws -> SupatermSendTextResult {
    switch request.target {
    case .contextPane:
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.sendText(request)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      let entry = try registry.entry(for: windowIndex)
      let localRequest = TerminalSendTextRequest(
        target: .pane(
          windowIndex: 1,
          spaceIndex: spaceIndex,
          tabIndex: tabIndex,
          paneIndex: paneIndex
        ),
        text: request.text
      )
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.sendText(localRequest),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func sendKey(_ request: TerminalSendKeyRequest) throws -> SupatermSendKeyResult {
    switch request.target {
    case .contextPane:
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.sendKey(request)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      let entry = try registry.entry(for: windowIndex)
      let localRequest = TerminalSendKeyRequest(
        key: request.key,
        target: .pane(
          windowIndex: 1,
          spaceIndex: spaceIndex,
          tabIndex: tabIndex,
          paneIndex: paneIndex
        )
      )
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.sendKey(localRequest),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func capturePane(_ request: TerminalCapturePaneRequest) throws -> SupatermCapturePaneResult {
    switch request.target {
    case .contextPane:
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.capturePane(request)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      let entry = try registry.entry(for: windowIndex)
      let localRequest = TerminalCapturePaneRequest(
        lines: request.lines,
        scope: request.scope,
        target: .pane(
          windowIndex: 1,
          spaceIndex: spaceIndex,
          tabIndex: tabIndex,
          paneIndex: paneIndex
        )
      )
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.capturePane(localRequest),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func resizePane(_ request: TerminalResizePaneRequest) throws -> SupatermResizePaneResult {
    switch request.target {
    case .contextPane:
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.resizePane(request)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      let entry = try registry.entry(for: windowIndex)
      let localRequest = TerminalResizePaneRequest(
        amount: request.amount,
        direction: request.direction,
        target: .pane(
          windowIndex: 1,
          spaceIndex: spaceIndex,
          tabIndex: tabIndex,
          paneIndex: paneIndex
        )
      )
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.resizePane(localRequest),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func setPaneSize(_ request: TerminalSetPaneSizeRequest) throws -> SupatermSetPaneSizeResult {
    switch request.target {
    case .contextPane:
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.setPaneSize(request)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      let entry = try registry.entry(for: windowIndex)
      let localRequest = TerminalSetPaneSizeRequest(
        amount: request.amount,
        axis: request.axis,
        target: .pane(
          windowIndex: 1,
          spaceIndex: spaceIndex,
          tabIndex: tabIndex,
          paneIndex: paneIndex
        ),
        unit: request.unit
      )
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.setPaneSize(localRequest),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func renameTab(_ request: TerminalRenameTabRequest) throws -> SupatermRenameTabResult {
    switch request.target {
    case .contextPane:
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.renameTab(request)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .tab(let windowIndex, let spaceIndex, let tabIndex):
      let entry = try registry.entry(for: windowIndex)
      let localRequest = TerminalRenameTabRequest(
        target: .tab(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex),
        title: request.title
      )
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.renameTab(localRequest),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func equalizePanes(_ request: TerminalEqualizePanesRequest) throws -> SupatermEqualizePanesResult {
    switch request.target {
    case .contextPane:
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.equalizePanes(request)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .tab(let windowIndex, let spaceIndex, let tabIndex):
      let entry = try registry.entry(for: windowIndex)
      let localRequest = TerminalEqualizePanesRequest(
        target: .tab(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex)
      )
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.equalizePanes(localRequest),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func mainVerticalPanes(
    _ request: TerminalMainVerticalPanesRequest
  ) throws -> SupatermMainVerticalPanesResult {
    switch request.target {
    case .contextPane:
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.mainVerticalPanes(request)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .tab(let windowIndex, let spaceIndex, let tabIndex):
      let entry = try registry.entry(for: windowIndex)
      let localRequest = TerminalMainVerticalPanesRequest(
        target: .tab(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex)
      )
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.mainVerticalPanes(localRequest),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func tilePanes(_ request: TerminalTilePanesRequest) throws -> SupatermTilePanesResult {
    switch request.target {
    case .contextPane:
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.tilePanes(request)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .tab(let windowIndex, let spaceIndex, let tabIndex):
      let entry = try registry.entry(for: windowIndex)
      let localRequest = TerminalTilePanesRequest(
        target: .tab(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex)
      )
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.tilePanes(localRequest),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func createSpace(_ request: TerminalCreateSpaceRequest) throws -> SupatermCreateSpaceResult {
    if request.target.contextPaneID != nil && request.target.windowIndex == nil {
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.createSpace(request)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound
    }

    if let windowIndex = request.target.windowIndex {
      let entry = try registry.entry(for: windowIndex)
      let localRequest = TerminalCreateSpaceRequest(
        name: request.name,
        target: .init(contextPaneID: request.target.contextPaneID, windowIndex: 1)
      )
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.createSpace(localRequest),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }

    guard let entry = registry.preferredActiveEntry() ?? registry.activeEntries().first else {
      throw TerminalControlError.windowNotFound(1)
    }
    return try TerminalWindowRegistry.rewrite(entry.terminal.createSpace(request), windowIndex: 1)
  }

  func selectSpace(_ target: TerminalSpaceTarget) throws -> SupatermSelectSpaceResult {
    switch target {
    case .contextPane:
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.selectSpace(target)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .space(let windowIndex, let spaceIndex):
      let entry = try registry.entry(for: windowIndex)
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.selectSpace(.space(windowIndex: 1, spaceIndex: spaceIndex)),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func closeSpace(_ target: TerminalSpaceTarget) throws -> SupatermCloseSpaceResult {
    switch target {
    case .contextPane:
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.closeSpace(target)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .space(let windowIndex, let spaceIndex):
      let entry = try registry.entry(for: windowIndex)
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.closeSpace(.space(windowIndex: 1, spaceIndex: spaceIndex)),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func renameSpace(_ request: TerminalRenameSpaceRequest) throws -> SupatermSpaceTarget {
    switch request.target {
    case .contextPane:
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.renameSpace(request)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .space(let windowIndex, let spaceIndex):
      let entry = try registry.entry(for: windowIndex)
      let localRequest = TerminalRenameSpaceRequest(
        name: request.name,
        target: .space(windowIndex: 1, spaceIndex: spaceIndex)
      )
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.renameSpace(localRequest),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func nextSpace(_ request: TerminalSpaceNavigationRequest) throws -> SupatermSelectSpaceResult {
    if request.contextPaneID != nil && request.windowIndex == nil {
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.nextSpace(request)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound
    }

    if let windowIndex = request.windowIndex {
      let entry = try registry.entry(for: windowIndex)
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.nextSpace(.init(contextPaneID: request.contextPaneID, windowIndex: 1)),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
    guard let entry = registry.preferredActiveEntry() ?? registry.activeEntries().first else {
      throw TerminalControlError.windowNotFound(1)
    }
    return try TerminalWindowRegistry.rewrite(entry.terminal.nextSpace(request), windowIndex: 1)
  }

  func previousSpace(_ request: TerminalSpaceNavigationRequest) throws -> SupatermSelectSpaceResult {
    if request.contextPaneID != nil && request.windowIndex == nil {
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.previousSpace(request)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound
    }

    if let windowIndex = request.windowIndex {
      let entry = try registry.entry(for: windowIndex)
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.previousSpace(
            .init(contextPaneID: request.contextPaneID, windowIndex: 1)
          ),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
    guard let entry = registry.preferredActiveEntry() ?? registry.activeEntries().first else {
      throw TerminalControlError.windowNotFound(1)
    }
    return try TerminalWindowRegistry.rewrite(entry.terminal.previousSpace(request), windowIndex: 1)
  }

  func lastSpace(_ request: TerminalSpaceNavigationRequest) throws -> SupatermSelectSpaceResult {
    if request.contextPaneID != nil && request.windowIndex == nil {
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.lastSpace(request)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound
    }

    if let windowIndex = request.windowIndex {
      let entry = try registry.entry(for: windowIndex)
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.lastSpace(.init(contextPaneID: request.contextPaneID, windowIndex: 1)),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
    guard let entry = registry.preferredActiveEntry() ?? registry.activeEntries().first else {
      throw TerminalControlError.windowNotFound(1)
    }
    return try TerminalWindowRegistry.rewrite(entry.terminal.lastSpace(request), windowIndex: 1)
  }

  func nextTab(_ request: TerminalTabNavigationRequest) throws -> SupatermSelectTabResult {
    if request.contextPaneID != nil && request.windowIndex == nil {
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.nextTab(request)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound
    }

    let windowIndex = request.windowIndex ?? 1
    let entry = try registry.entry(for: windowIndex)
    do {
      return TerminalWindowRegistry.rewrite(
        try entry.terminal.nextTab(
          .init(contextPaneID: request.contextPaneID, spaceIndex: request.spaceIndex, windowIndex: 1)
        ),
        windowIndex: windowIndex
      )
    } catch let error as TerminalControlError {
      throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
    }
  }

  func previousTab(_ request: TerminalTabNavigationRequest) throws -> SupatermSelectTabResult {
    if request.contextPaneID != nil && request.windowIndex == nil {
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.previousTab(request)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound
    }

    let windowIndex = request.windowIndex ?? 1
    let entry = try registry.entry(for: windowIndex)
    do {
      return TerminalWindowRegistry.rewrite(
        try entry.terminal.previousTab(
          .init(contextPaneID: request.contextPaneID, spaceIndex: request.spaceIndex, windowIndex: 1)
        ),
        windowIndex: windowIndex
      )
    } catch let error as TerminalControlError {
      throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
    }
  }

  func lastTab(_ request: TerminalTabNavigationRequest) throws -> SupatermSelectTabResult {
    if request.contextPaneID != nil && request.windowIndex == nil {
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.lastTab(request)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound
    }

    let windowIndex = request.windowIndex ?? 1
    let entry = try registry.entry(for: windowIndex)
    do {
      return TerminalWindowRegistry.rewrite(
        try entry.terminal.lastTab(
          .init(contextPaneID: request.contextPaneID, spaceIndex: request.spaceIndex, windowIndex: 1)
        ),
        windowIndex: windowIndex
      )
    } catch let error as TerminalControlError {
      throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
    }
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

  func handleAgentHook(_ request: SupatermAgentHookRequest) throws -> TerminalAgentHookResult {
    let event = request.event
    if let sessionID = event.sessionID {
      agentSessionStore.recordSession(
        agent: request.agent,
        sessionID: sessionID,
        context: request.context,
        transcriptPath: event.transcriptPath
      )
    }

    switch event.hookEventName {
    case .sessionStart:
      if let sessionID = event.sessionID {
        agentSessionStore.cancelRunningTimeout(agent: request.agent, sessionID: sessionID)
        if request.agent == .codex {
          _ = agentSessionStore.beginCodexTracking(
            sessionID: sessionID,
            context: request.context
          )
        }
      }
      return .init(desktopNotification: nil)

    case .unsupported:
      return .init(desktopNotification: nil)

    case .postToolUse, .preToolUse:
      if request.agent == .codex {
        return .init(desktopNotification: nil)
      }
      return handleRunningAgentHook(request)

    case .userPromptSubmit:
      return handleUserPromptSubmitAgentHook(request)

    case .stop:
      return try handleStopAgentHook(request)

    case .sessionEnd:
      return handleSessionEndAgentHook(request)

    case .notification:
      return try handleAttentionAgentHook(request)
    }
  }

  func terminalAgentSessionStore(
    _ store: TerminalAgentSessionStore,
    didReceiveCodexTranscriptUpdate update: CodexTranscriptUpdate,
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  ) {
    if update.status?.startsNewTurn == true {
      _ = clearCodexHoverMessages(
        agent: agent,
        context: context,
        sessionID: sessionID
      )
    }
    if !update.messages.isEmpty {
      _ = updateCodexHoverMessages(
        update.messages,
        replacing: update.replacesMessages,
        agent: agent,
        sessionID: sessionID,
        context: context
      )
    }
    if update.status?.isFinal == true {
      _ = updateAgentActivity(
        .init(kind: agent, phase: .idle, detail: nil),
        agent: agent,
        sessionID: sessionID,
        context: context
      )
      return
    }
    _ = updateAgentActivity(
      .init(kind: agent, phase: .running, detail: update.detail),
      agent: agent,
      sessionID: sessionID,
      context: context
    )
  }

  func terminalAgentSessionStore(
    _ store: TerminalAgentSessionStore,
    didExpireRunningTimeoutFor agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  ) {
    _ = updateAgentActivity(
      .init(kind: agent, phase: .idle, detail: nil),
      agent: agent,
      sessionID: sessionID,
      context: context
    )
  }

  private func createContextTab(_ request: TerminalCreateTabRequest) throws -> SupatermNewTabResult {
    for (offset, entry) in registry.activeEntries().enumerated() {
      do {
        let result = try entry.terminal.createTab(request)
        return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
      } catch let error as TerminalCreateTabError {
        if case .contextPaneNotFound = error {
          continue
        }
        throw error
      }
    }
    throw TerminalCreateTabError.contextPaneNotFound
  }

  private func createContextPane(_ request: TerminalCreatePaneRequest) throws
    -> SupatermNewPaneResult
  {
    for (offset, entry) in registry.activeEntries().enumerated() {
      do {
        let result = try entry.terminal.createPane(request)
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

  private func notifyContextPane(_ request: TerminalNotifyRequest) throws -> SupatermNotifyResult {
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

  private func handleRunningAgentHook(
    _ request: SupatermAgentHookRequest
  ) -> TerminalAgentHookResult {
    guard let sessionID = prepareAgentTurn(request) else {
      return .init(desktopNotification: nil)
    }
    _ = setAgentActivity(
      .init(
        kind: request.agent,
        phase: .running
      ),
      agent: request.agent,
      sessionID: sessionID,
      context: request.context
    )
    return .init(desktopNotification: nil)
  }

  private func handleUserPromptSubmitAgentHook(
    _ request: SupatermAgentHookRequest
  ) -> TerminalAgentHookResult {
    guard let sessionID = prepareAgentTurn(request) else {
      return .init(desktopNotification: nil)
    }
    if request.agent == .codex {
      _ = agentSessionStore.beginCodexTracking(
        sessionID: sessionID,
        context: request.context
      )
    } else {
      _ = setAgentActivity(
        .init(kind: request.agent, phase: .running),
        agent: request.agent,
        sessionID: sessionID,
        context: request.context
      )
    }
    return .init(desktopNotification: nil)
  }

  private func handleStopAgentHook(
    _ request: SupatermAgentHookRequest
  ) throws -> TerminalAgentHookResult {
    let event = request.event
    if let sessionID = event.sessionID {
      _ = setAgentActivity(
        .init(kind: request.agent, phase: .idle),
        agent: request.agent,
        sessionID: sessionID,
        context: request.context
      )
      if request.agent == .codex {
        _ = updateCodexHoverMessages(
          event.lastAssistantMessage.map { [$0] } ?? [],
          replacing: true,
          agent: request.agent,
          sessionID: sessionID,
          context: request.context
        )
      }
    }
    guard
      let body = event.lastAssistantMessage?.trimmingCharacters(in: .whitespacesAndNewlines),
      !body.isEmpty
    else {
      return .init(desktopNotification: nil)
    }
    return try handleAgentEventNotification(
      request.agent,
      event: event,
      context: request.context,
      notification: .init(
        body: body,
        semantic: .completion,
        subtitle: "Turn complete"
      )
    )
  }

  private func handleSessionEndAgentHook(
    _ request: SupatermAgentHookRequest
  ) -> TerminalAgentHookResult {
    guard let sessionID = request.event.sessionID else {
      return .init(desktopNotification: nil)
    }
    _ = clearAgentActivity(agent: request.agent, sessionID: sessionID, context: request.context)
    if request.agent == .codex {
      _ = clearCodexHoverMessages(
        agent: request.agent,
        context: request.context,
        sessionID: sessionID
      )
    }
    agentSessionStore.clearSession(agent: request.agent, sessionID: sessionID)
    return .init(desktopNotification: nil)
  }

  private func handleAttentionAgentHook(
    _ request: SupatermAgentHookRequest
  ) throws -> TerminalAgentHookResult {
    let event = request.event
    if let sessionID = event.sessionID {
      _ = setAgentActivity(
        .init(kind: request.agent, phase: .needsInput),
        agent: request.agent,
        sessionID: sessionID,
        context: request.context
      )
    }
    return try handleAgentEventNotification(
      request.agent,
      event: event,
      context: request.context,
      notification: .init(
        body: try event.notificationMessage(),
        semantic: .attention,
        subtitle: event.title ?? "Attention"
      )
    )
  }

  private func notifyStructuredAgent(
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

  private func handleAgentEventNotification(
    _ agent: SupatermAgentKind,
    event: SupatermAgentHookEvent,
    context: SupatermCLIContext?,
    notification: AgentHookNotification
  ) throws -> TerminalAgentHookResult {
    let title = agent.notificationTitle
    let candidateSurfaceIDs = agentCandidateSurfaceIDs(
      agent: agent,
      sessionID: event.sessionID,
      context: context
    )

    for surfaceID in candidateSurfaceIDs {
      do {
        let result = try notifyStructuredAgent(
          .init(
            body: notification.body,
            subtitle: notification.subtitle,
            target: .contextPane(surfaceID),
            title: title,
            allowDesktopNotificationWhenAgentActive: true
          ),
          semantic: notification.semantic
        )
        return .init(
          desktopNotification: result.desktopNotificationDisposition.shouldDeliver
            ? .init(
              body: notification.body,
              subtitle: notification.subtitle,
              title: result.resolvedTitle
            )
            : nil
        )
      } catch let error as TerminalCreatePaneError {
        guard case .contextPaneNotFound = error else {
          throw error
        }
        if let sessionID = event.sessionID {
          agentSessionStore.clearRecordedSessionIfSurfaceMatches(
            agent: agent,
            sessionID: sessionID,
            surfaceID: surfaceID
          )
          return .init(desktopNotification: nil)
        }
      }
    }

    return .init(desktopNotification: nil)
  }

  private func prepareAgentTurn(
    _ request: SupatermAgentHookRequest
  ) -> String? {
    guard let sessionID = request.event.sessionID else { return nil }
    clearRecentStructuredNotifications(
      agent: request.agent,
      context: request.context,
      sessionID: sessionID
    )
    return sessionID
  }

  @discardableResult
  private func setAgentActivity(
    _ activity: TerminalHostState.AgentActivity,
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  ) -> Bool {
    guard updateAgentActivity(activity, agent: agent, sessionID: sessionID, context: context)
    else {
      return false
    }
    switch activity.phase {
    case .running where agent == .codex:
      agentSessionStore.cancelRunningTimeout(agent: agent, sessionID: sessionID)
    case .running:
      agentSessionStore.cancelTranscriptMonitor(agent: agent, sessionID: sessionID)
      agentSessionStore.armRunningTimeout(agent: agent, sessionID: sessionID, context: context)
    default:
      agentSessionStore.cancelTranscriptMonitor(agent: agent, sessionID: sessionID)
      agentSessionStore.cancelRunningTimeout(agent: agent, sessionID: sessionID)
    }
    return true
  }

  private func clearRecentStructuredNotifications(
    agent: SupatermAgentKind,
    context: SupatermCLIContext?,
    sessionID: String
  ) {
    let candidateSurfaceIDs = agentCandidateSurfaceIDs(
      agent: agent,
      sessionID: sessionID,
      context: context
    )
    for surfaceID in candidateSurfaceIDs {
      for entry in registry.activeEntries()
      where entry.terminal.clearRecentStructuredNotification(for: surfaceID) {
        break
      }
    }
  }

  @discardableResult
  private func clearCodexHoverMessages(
    agent: SupatermAgentKind,
    context: SupatermCLIContext?,
    sessionID: String
  ) -> Bool {
    updateCodexHoverMessages(
      [],
      replacing: true,
      agent: agent,
      sessionID: sessionID,
      context: context
    )
  }

  @discardableResult
  private func updateCodexHoverMessages(
    _ messages: [String],
    replacing: Bool,
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  ) -> Bool {
    let candidateSurfaceIDs = agentCandidateSurfaceIDs(
      agent: agent,
      sessionID: sessionID,
      context: context
    )
    for surfaceID in candidateSurfaceIDs {
      for entry in registry.activeEntries()
      where entry.terminal.recordCodexHoverMessages(
        messages,
        replacing: replacing,
        for: surfaceID
      ) {
        return true
      }
    }
    return false
  }

  @discardableResult
  private func clearAgentActivity(
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  ) -> Bool {
    agentSessionStore.cancelTranscriptMonitor(agent: agent, sessionID: sessionID)
    agentSessionStore.cancelRunningTimeout(agent: agent, sessionID: sessionID)
    return updateAgentActivity(nil, agent: agent, sessionID: sessionID, context: context)
  }

  @discardableResult
  private func updateAgentActivity(
    _ activity: TerminalHostState.AgentActivity?,
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  ) -> Bool {
    let candidateSurfaceIDs = agentCandidateSurfaceIDs(
      agent: agent,
      sessionID: sessionID,
      context: context
    )
    for surfaceID in candidateSurfaceIDs {
      for entry in registry.activeEntries() {
        if let activity {
          if entry.terminal.setAgentActivity(activity, for: surfaceID) {
            return true
          }
        } else if entry.terminal.clearAgentActivity(for: surfaceID) {
          return true
        }
      }
    }
    return false
  }

  private func agentCandidateSurfaceIDs(
    agent: SupatermAgentKind,
    sessionID: String?,
    context: SupatermCLIContext?
  ) -> [UUID] {
    var candidateSurfaceIDs: [UUID] = []
    if let surfaceID = context?.surfaceID {
      candidateSurfaceIDs.append(surfaceID)
    }
    if let sessionID,
      let surfaceID = agentSessionStore.sessionSurfaceID(agent: agent, sessionID: sessionID),
      !candidateSurfaceIDs.contains(surfaceID)
    {
      candidateSurfaceIDs.append(surfaceID)
    }
    return candidateSurfaceIDs
  }

  private func updateSnapshot(_ state: UpdateFeature.State?) -> SupatermAppDebugSnapshot.Update {
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

import Foundation
import SupatermCLIShared
import SupatermTerminalCore

extension TerminalCommandExecutor {
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

  func pinTab(_ target: TerminalTabTarget) throws -> SupatermPinTabResult {
    switch target {
    case .contextPane:
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.pinTab(target)
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
          try entry.terminal.pinTab(
            .tab(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex)
          ),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func unpinTab(_ target: TerminalTabTarget) throws -> SupatermPinTabResult {
    switch target {
    case .contextPane:
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.unpinTab(target)
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
          try entry.terminal.unpinTab(
            .tab(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex)
          ),
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
}

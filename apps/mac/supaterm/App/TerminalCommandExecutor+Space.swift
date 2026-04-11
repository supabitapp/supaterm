import Foundation
import SupatermCLIShared
import SupatermTerminalCore

extension TerminalCommandExecutor {
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
}

import Foundation
import SupatermCLIShared
import SupatermTerminalCore

extension TerminalCommandExecutor {
  func createTab(_ request: TerminalCreateTabRequest) throws -> SupatermNewTabResult {
    for entry in targetedEntries(for: request) {
      do {
        let result = try entry.terminal.createTab(request)
        return TerminalWindowRegistry.rewrite(result, windowIndex: registry.windowIndex(of: entry))
      } catch let error as TerminalCreateTabError {
        if case .contextPaneNotFound = error {
          continue
        }
        throw error
      }
    }
    throw TerminalCreateTabError.contextPaneNotFound
  }

  private func targetedEntries(
    for request: TerminalCreateTabRequest
  ) -> [TerminalWindowRegistry.Entry] {
    switch request.target {
    case .pane(let paneID):
      return registry.activeEntries().filter {
        $0.terminal.tabID(containing: paneID) != nil
          || $0.terminal.spaceManager.pendingInstance(containingSurface: paneID) != nil
      }
    case .space:
      return registry.ambientEntries(for: request.context)
    }
  }

  func createPane(_ request: TerminalCreatePaneRequest) throws -> SupatermNewPaneResult {
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
}

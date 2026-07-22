import Foundation
import SupatermCLIShared
import SupatermTerminalCore

extension TerminalCommandExecutor {
  func createTab(_ request: TerminalCreateTabRequest) throws -> SupatermNewTabResult {
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

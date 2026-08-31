import ComposableArchitecture
import Foundation
import SwiftUI

@testable import supaterm

extension TerminalWindowRegistry {
  func register(
    keyboardShortcutForAction: @escaping (String) -> KeyboardShortcut?,
    windowControllerID: UUID,
    store: StoreOf<AppFeature>,
    terminal: TerminalHostState,
    requestConfirmedWindowClose: @escaping @MainActor () -> Void,
    setTerminatesTerminalSessionsOnClose: @escaping @MainActor (Bool) -> Void = { _ in }
  ) {
    setShortcutSourceForTesting { action in
      keyboardShortcutForAction(action).map { GhosttyShortcut(keyboardShortcut: $0) }
    }
    register(
      windowControllerID: windowControllerID,
      store: store,
      terminal: terminal,
      requestConfirmedWindowClose: requestConfirmedWindowClose,
      setTerminatesTerminalSessionsOnClose: setTerminatesTerminalSessionsOnClose
    )
  }

  func register(
    ghosttyShortcutForAction: @escaping (String) -> GhosttyShortcut?,
    windowControllerID: UUID,
    store: StoreOf<AppFeature>,
    terminal: TerminalHostState,
    requestConfirmedWindowClose: @escaping @MainActor () -> Void,
    setTerminatesTerminalSessionsOnClose: @escaping @MainActor (Bool) -> Void = { _ in }
  ) {
    setShortcutSourceForTesting(ghosttyShortcutForAction)
    register(
      windowControllerID: windowControllerID,
      store: store,
      terminal: terminal,
      requestConfirmedWindowClose: requestConfirmedWindowClose,
      setTerminatesTerminalSessionsOnClose: setTerminatesTerminalSessionsOnClose
    )
  }
}

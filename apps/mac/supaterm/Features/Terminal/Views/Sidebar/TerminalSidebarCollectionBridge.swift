import ComposableArchitecture
import SupaTheme
import SwiftUI

struct TerminalSidebarOutlineList: NSViewControllerRepresentable {
  let store: StoreOf<TerminalWindowFeature>
  let terminal: TerminalHostState
  let palette: Palette
  let outline: TerminalSidebarOutline
  let rows: [TerminalSidebarEntryID: TerminalSidebarRowPresentation]
  let selectedTabID: TerminalTabID?
  let reduceMotion: Bool
  let actions: TerminalSidebarRowActions
  let onDrop: (TerminalSidebarDragValue, TerminalSidebarDropDestination) -> TerminalSidebarDropResult

  func makeNSViewController(context: Context) -> TerminalSidebarListController {
    TerminalSidebarListController()
  }

  func updateNSViewController(
    _ controller: TerminalSidebarListController,
    context: Context
  ) {
    controller.onDrop = onDrop
    controller.apply(
      outline: outline,
      rows: rows,
      context: TerminalSidebarRowContext(
        store: store,
        terminal: terminal,
        palette: palette,
        renameState: controller.renameState,
        actions: actions
      ),
      selectedTabID: selectedTabID,
      reduceMotion: reduceMotion
    )
  }
}

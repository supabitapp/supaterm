import SupaTheme
import SwiftUI

struct TerminalSidebarOutlineList: NSViewControllerRepresentable {
  let terminal: TerminalHostState
  let palette: Palette
  let swipe: SpaceSwipeController
  let controllerCache: TerminalSidebarControllerCache
  let spaceID: TerminalSpaceID
  let outline: TerminalSidebarOutline
  let rows: [TerminalSidebarEntryID: TerminalSidebarRowPresentation]
  let selectedTabID: TerminalTabID?
  let fixedHoveredGroupID: TerminalTabGroupID?
  let reduceMotion: Bool
  let actions: TerminalSidebarRowActions
  let performDrop: (TerminalSidebarDropCommand) -> TerminalSidebarDropReceipt?

  func makeNSViewController(context: Context) -> TerminalSidebarListController {
    controllerCache.controller(for: spaceID)
  }

  func updateNSViewController(
    _ controller: TerminalSidebarListController,
    context: Context
  ) {
    controller.performDrop = performDrop
    controller.swipe = swipe
    controller.apply(
      outline: outline,
      rows: rows,
      context: TerminalSidebarRowContext(
        terminal: terminal,
        palette: palette,
        renameState: controller.renameState,
        groupHeaderHoverState: controller.groupHeaderHoverState,
        tabSelectionState: controller.tabSelectionState,
        outline: outline,
        fixedHoveredGroupID: fixedHoveredGroupID,
        actions: actions
      ),
      selectedTabID: selectedTabID,
      reduceMotion: reduceMotion
    )
  }
}

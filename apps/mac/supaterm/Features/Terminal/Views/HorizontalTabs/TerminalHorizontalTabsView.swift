import ComposableArchitecture
import Sharing
import SupaTheme
import SupatermSettingsFeature
import SwiftUI

struct TerminalHorizontalTabsView: View {
  private enum Metrics {
    static let spacing: CGFloat = 6
    static let spaceSwitcherWidth: CGFloat = 120
  }

  let store: StoreOf<TerminalWindowFeature>
  let tabDragRegistry: TerminalTabDragRegistry
  let terminal: TerminalHostState
  let windowControllerID: UUID

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Shared(.supatermSettings) private var supatermSettings = .default

  private var palette: Palette {
    terminal.chromePalette(appearanceMode: supatermSettings.appearanceMode)
  }

  var body: some View {
    HStack(spacing: Metrics.spacing) {
      WindowTrafficLights()
        .frame(width: WindowTrafficLightMetrics.clusterWidth)

      TerminalSpaceSwitcher(
        store: store,
        terminal: terminal,
        palette: palette,
        spaces: terminal.spaces,
        selectedSpaceID: terminal.displayedSpaceID
      )
      .frame(width: Metrics.spaceSwitcherWidth, alignment: .leading)
      .clipped()

      TerminalHorizontalTabStripBridge(
        snapshot: terminal.spaceManager.displayedInstance.tabSurfaceSnapshot,
        palette: palette,
        reduceMotion: reduceMotion,
        tabDragRegistry: tabDragRegistry,
        windowControllerID: windowControllerID,
        actions: TerminalHorizontalTabStripController.Actions(
          closeTab: { terminal.requestCloseTab($0) },
          newTab: newTab,
          selectTab: { terminal.selectTab($0) },
          toggleGroup: { _ = terminal.toggleGroupCollapsed($0) },
          performDrop: { TerminalSidebarDropTransaction.commit($0, to: terminal) }
        )
      )
      .frame(maxWidth: .infinity)

      TerminalAgentsPopoverButton(
        items: terminal.windowAgentPresentations(),
        palette: palette
      )

      ToolbarIconButton(
        symbol: "sidebar.left",
        palette: palette,
        accessibilityLabel: "Show Tabs in Sidebar"
      ) {
        _ = store.send(.toggleTabLayoutButtonTapped)
      }
      .padding(.trailing, Metrics.spacing)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .environment(
      \.colorScheme,
      supatermSettings.appearanceMode.colorScheme ?? terminal.terminalChromeColorScheme
    )
  }

  private func newTab() {
    AppPostHog.capture("terminal_tab_created")
    _ = terminal.createTab(inheritingFromSurfaceID: terminal.selectedSurfaceView?.id)
  }
}

private struct TerminalHorizontalTabStripBridge: NSViewControllerRepresentable {
  let snapshot: TerminalTabSurfaceSnapshot
  let palette: Palette
  let reduceMotion: Bool
  let tabDragRegistry: TerminalTabDragRegistry
  let windowControllerID: UUID
  let actions: TerminalHorizontalTabStripController.Actions

  func makeNSViewController(context: Context) -> TerminalHorizontalTabStripController {
    TerminalHorizontalTabStripController(
      windowControllerID: windowControllerID,
      tabDragRegistry: tabDragRegistry
    )
  }

  func updateNSViewController(
    _ controller: TerminalHorizontalTabStripController,
    context: Context
  ) {
    controller.apply(
      snapshot: snapshot,
      palette: palette,
      reduceMotion: reduceMotion,
      actions: actions
    )
  }
}

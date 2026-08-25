import ComposableArchitecture
import Sharing
import SupaTheme
import SupatermSupport
import SwiftUI

struct TerminalDetailView: View {
  @Shared(.supatermSettings) private var supatermSettings = .default
  let store: StoreOf<TerminalWindowFeature>
  let palette: Palette
  let terminal: TerminalHostState
  let selectedTabID: TerminalTabID

  var body: some View {
    TerminalSurfacePaneView(
      dimmingColor: terminal.unfocusedSplitDimmingColor,
      dimmingOpacity: terminal.unfocusedSplitDimmingOpacity,
      focusedSurfaceID: terminal.currentFocusedSurfaceID(),
      notificationColor: terminal.notificationAttentionColor,
      palette: palette,
      showsGlowingPaneRing: supatermSettings.glowingPaneRingEnabled,
      splitDividerColor: terminal.splitDividerColor,
      store: store,
      terminal: terminal,
      tabID: selectedTabID
    )
  }
}

private struct TerminalSurfacePaneView: View {
  @Shared(.supatermSettings) private var supatermSettings = .default
  @Environment(CommandHoldObserver.self) private var commandHoldObserver

  let dimmingColor: Color
  let dimmingOpacity: Double
  let focusedSurfaceID: UUID?
  let notificationColor: Color
  let palette: Palette
  let showsGlowingPaneRing: Bool
  let splitDividerColor: Color
  let store: StoreOf<TerminalWindowFeature>
  let terminal: TerminalHostState
  let tabID: TerminalTabID

  var body: some View {
    let tree = terminal.splitTree(for: tabID)
    TerminalSplitTreeAXContainer(
      agentPanelPresentations: agentPanelPresentations,
      dimmingColor: dimmingColor,
      dimmingOpacity: dimmingOpacity,
      focusedSurfaceID: focusedSurfaceID,
      hiddenAgentPanelSurfaceIDs: store.hiddenAgentPanelSurfaceIDs,
      isSidebarCollapsed: store.isSidebarCollapsed,
      notificationColor: notificationColor,
      palette: palette,
      agentPanelForksDown: agentPanelForksDown,
      agentPanelShortcutHint: agentPanelShortcutHint,
      showsGlowingPaneRing: showsGlowingPaneRing,
      showsSidebarAttentionIndicator: store.isSidebarCollapsed
        && terminal.hasUnreadSidebarNotifications,
      splitDividerColor: splitDividerColor,
      tree: tree,
      unreadSurfaceIDs: terminal.unreadNotifiedSurfaceIDs(in: tabID)
    ) { operation in
      switch operation {
      case .agentPanelCopyText(let text):
        _ = store.send(.agentPanelCopyText(text))
      case .agentPanelForkSessionRequested(
        let surfaceID,
        let direction,
        let session
      ):
        _ = try? terminal.createPane(
          TerminalCreatePaneRequest(
            startupCommand: session.forkStartupCommand,
            cwd: session.workingDirectoryPath,
            direction: direction,
            focus: true,
            equalize: false,
            target: .pane(surfaceID)
          )
        )
      case .agentPanelVisibilityToggled(let surfaceID):
        _ = store.send(.agentPanelVisibilityToggled(surfaceID))
      case .agentPanelURLTapped(let url):
        _ = store.send(.agentPanelURLTapped(url))
      case .equalizePanes(let surfaceID):
        _ = terminal.performSplitAction(.equalizeSplits, for: surfaceID)
      case .splitPane(let surfaceID, let direction):
        let splitDirection: GhosttySplitAction.NewDirection =
          switch direction {
          case .horizontal: .right
          case .vertical: .down
          }
        _ = terminal.performSplitAction(.newSplit(direction: splitDirection), for: surfaceID)
      case .togglePaneZoom(let surfaceID):
        _ = terminal.performSplitAction(.toggleSplitZoom, for: surfaceID)
      case .toggleSidebar:
        _ = store.send(.toggleSidebarButtonTapped)
      case .resize, .drop, .equalize:
        AppPostHog.capture("terminal_pane_created")
        terminal.performSplitOperation(operation, in: tabID)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(tree.isSplit ? Color.clear : palette.detailBackground)
  }

  private var agentPanelPresentations: [UUID: PaneAgentPanelPresentation] {
    terminal.agentPanelPresentations(for: tabID)
  }

  private var agentPanelShortcutHint: String? {
    guard commandHoldObserver.isPressed else { return nil }
    return SupatermShortcuts.binding(
      for: .toggleAgentPanel,
      overrides: supatermSettings.shortcutOverrides
    )?.display
  }

  private var agentPanelForksDown: Bool {
    commandHoldObserver.isOptionPressed
  }
}

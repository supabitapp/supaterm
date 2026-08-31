import ComposableArchitecture
import Sharing
import SupaTheme
import SupatermSettingsFeature
import SwiftUI

@MainActor
final class HorizontalTabControllerReference {
  weak var controller: TerminalHorizontalTabStripController?

  func cancelInteractions() {
    controller?.cancelInteractions()
  }
}

struct TerminalHorizontalTabsView: View {
  private enum Metrics {
    static let spacing: CGFloat = 6
    static let spaceSwitcherWidth: CGFloat = 120
  }

  let store: StoreOf<TerminalWindowFeature>
  let groupIconStore: TerminalTabGroupIconStore
  let tabDragRegistry: TerminalTabDragRegistry
  let terminal: TerminalHostState
  let windowControllerID: UUID
  let captureRequest: () -> TerminalWindowCaptureRequest?
  let controllerReference: HorizontalTabControllerReference

  @State private var swipe = SpaceSwipeController()
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Shared(.supatermSettings) private var supatermSettings = .default

  private var palette: Palette {
    terminal.chromePalette(appearanceMode: supatermSettings.appearanceMode)
  }

  var body: some View {
    let instance = terminal.spaceManager.displayedInstance
    let snapshot = instance.tabSurfaceSnapshot
    let tabSelectionState = instance.tabSelectionState
    let _ = tabSelectionState.secondaryTabIDs
    let groupIconRequests = terminal.tabGroupIconRequests(for: snapshot)
    let surfacePresentation = terminal.horizontalTabSurfacePresentation(
      for: snapshot,
      groupIconStore: groupIconStore
    )
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
        snapshot: snapshot,
        tabSelectionState: tabSelectionState,
        surfacePresentation: surfacePresentation,
        palette: palette,
        reduceMotion: reduceMotion,
        shouldPlayTabMoveHaptics: supatermSettings.tabMoveHapticsEnabled,
        tabDragRegistry: tabDragRegistry,
        windowControllerID: windowControllerID,
        captureRequest: captureRequest,
        controllerReference: controllerReference,
        actions: TerminalHorizontalTabStripController.Actions(
          closeGroup: { terminal.requestCloseGroup($0) },
          closeTab: { terminal.requestCloseTab($0) },
          newTab: newTab,
          newTabInGroup: { groupID in
            AppPostHog.capture("terminal_tab_created")
            _ = terminal.createTab(
              in: groupID,
              inheritingFromSurfaceID: terminal.contextSurfaceID(for: groupID)
            )
          },
          selectTab: { terminal.selectTab($0) },
          toggleGroup: { _ = terminal.toggleGroupCollapsed($0) },
          performDrop: { TerminalSidebarDropTransaction.commit($0, to: terminal) },
          mergeTabIntoSelectedTab: { terminal.mergeTabIntoSelectedTab($0) },
          contextMenu: {
            TerminalHorizontalTabContextMenu.menu(
              for: $0,
              snapshot: snapshot,
              surface: surfacePresentation,
              terminal: terminal,
              selectionState: tabSelectionState
            )
          }
        )
      )
      .frame(maxWidth: .infinity)

      TerminalAgentsPopoverButton(
        items: terminal.windowAgentPresentations(),
        palette: palette
      )
      .padding(.trailing, Metrics.spacing)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background {
      SpaceSwipeGestureView(
        swipe: swipe,
        isActive: true,
        isRowDragActive: { tabDragRegistry.activePayload != nil }
      )
    }
    .environment(
      \.colorScheme,
      supatermSettings.appearanceMode.colorScheme ?? terminal.terminalChromeColorScheme
    )
    .onAppear {
      TerminalHorizontalSpacePaging.connect(swipe, to: terminal)
    }
    .onDisappear {
      TerminalHorizontalSpacePaging.disconnect(swipe, from: terminal)
    }
    .task(id: groupIconRequests) {
      await groupIconStore.load(groupIconRequests)
    }
  }

  private func newTab() {
    AppPostHog.capture("terminal_tab_created")
    _ = terminal.createTab(inheritingFromSurfaceID: terminal.selectedSurfaceView?.id)
  }
}

enum TerminalHorizontalSpacePaging {
  @MainActor
  static func connect(_ swipe: SpaceSwipeController, to terminal: TerminalHostState) {
    swipe.pageCount = { [weak terminal] in terminal?.spaces.count ?? 0 }
    swipe.displayedIndex = { [weak terminal] in terminal?.displayedSpaceIndex ?? 0 }
    let select: (Int) -> Void = { [weak terminal] index in
      guard let terminal, terminal.spaces.indices.contains(index) else { return }
      terminal.selectSpace(terminal.spaces[index].id)
    }
    swipe.selected = select
    swipe.swipeSelected = select
    terminal.spacePager = swipe
  }

  @MainActor
  static func disconnect(_ swipe: SpaceSwipeController, from terminal: TerminalHostState) {
    swipe.positionChanged = nil
    swipe.selected = nil
    swipe.swipeSelected = nil
    swipe.slide = nil
    swipe.isRowDragActive = false
    guard terminal.spacePager === swipe else { return }
    terminal.spacePager = nil
  }
}

private struct TerminalHorizontalTabStripBridge: NSViewControllerRepresentable {
  let snapshot: TerminalTabSurfaceSnapshot
  let tabSelectionState: TerminalTabSelectionState
  let surfacePresentation: TerminalHorizontalTabSurfacePresentation
  let palette: Palette
  let reduceMotion: Bool
  let shouldPlayTabMoveHaptics: Bool
  let tabDragRegistry: TerminalTabDragRegistry
  let windowControllerID: UUID
  let captureRequest: () -> TerminalWindowCaptureRequest?
  let controllerReference: HorizontalTabControllerReference
  let actions: TerminalHorizontalTabStripController.Actions

  final class Coordinator {
    let controllerReference: HorizontalTabControllerReference

    init(controllerReference: HorizontalTabControllerReference) {
      self.controllerReference = controllerReference
    }
  }

  func makeCoordinator() -> Coordinator {
    Coordinator(controllerReference: controllerReference)
  }

  func makeNSViewController(context: Context) -> TerminalHorizontalTabStripController {
    let controller = TerminalHorizontalTabStripController(
      windowControllerID: windowControllerID,
      tabDragRegistry: tabDragRegistry,
      captureRequest: captureRequest
    )
    context.coordinator.controllerReference.controller = controller
    return controller
  }

  func updateNSViewController(
    _ controller: TerminalHorizontalTabStripController,
    context: Context
  ) {
    controller.apply(
      snapshot: snapshot,
      tabSelectionState: tabSelectionState,
      surfacePresentation: surfacePresentation,
      palette: palette,
      reduceMotion: reduceMotion,
      shouldPlayTabMoveHaptics: shouldPlayTabMoveHaptics,
      actions: actions
    )
  }

  static func dismantleNSViewController(
    _ controller: TerminalHorizontalTabStripController,
    coordinator: Coordinator
  ) {
    controller.cancelInteractions()
    if coordinator.controllerReference.controller === controller {
      coordinator.controllerReference.controller = nil
    }
  }
}

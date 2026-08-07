import AppKit
import ComposableArchitecture
import Sharing
import SupaTheme
import SupatermSupport
import SwiftUI

enum TerminalSpaceShortcut {
  static func shortcutBinding(
    forSpaceAt index: Int,
    overrides: [SupatermShortcutID: SupatermShortcutOverride]
  ) -> SupatermShortcutBinding? {
    let slot = index + 1
    guard (1...10).contains(slot) else { return nil }
    return SupatermShortcuts.binding(for: .selectSpace(slot), overrides: overrides)
  }
}

enum TerminalWindowHeaderMetrics {
  static let spacing: CGFloat = 10
  static let switcherHeight: CGFloat = 28

  static var switcherTopPadding: CGFloat {
    WindowTrafficLightMetrics.edgePadding
      + WindowTrafficLightMetrics.buttonSize / 2
      - switcherHeight / 2
  }
}

struct TerminalWindowHeader: View {
  let store: StoreOf<TerminalWindowFeature>
  let palette: Palette
  let terminal: TerminalHostState

  var body: some View {
    HStack(alignment: .top, spacing: 0) {
      HStack(alignment: .top, spacing: 0) {
        WindowTrafficLights()
          .frame(
            width: WindowTrafficLightMetrics.clusterWidth,
            height: TerminalSidebarLayout.scrollViewportTopInset
          )

        WindowDragSurface()
          .frame(width: TerminalWindowHeaderMetrics.spacing)
          .frame(maxHeight: .infinity)

        TerminalSpaceSwitcher(
          store: store,
          palette: palette,
          terminal: terminal,
          spaces: terminal.spaces,
          selectedSpaceID: terminal.displayedSpaceID
        )
        .padding(.top, TerminalWindowHeaderMetrics.switcherTopPadding)
        .frame(height: TerminalSidebarLayout.scrollViewportTopInset, alignment: .top)
        .background {
          WindowDragSurface()
        }
      }
      .fixedSize(horizontal: true, vertical: false)

      WindowDragSurface()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .frame(height: TerminalSidebarLayout.scrollViewportTopInset, alignment: .topLeading)
  }
}

struct TerminalSpaceSwitcher: View {
  let store: StoreOf<TerminalWindowFeature>
  let palette: Palette
  let terminal: TerminalHostState
  let spaces: [TerminalSpaceItem]
  let selectedSpaceID: TerminalSpaceID

  @Shared(.supatermSettings) private var supatermSettings = .default

  var body: some View {
    if spaces.contains(where: { $0.id == selectedSpaceID }) {
      TerminalNativeSpaceSwitcher(
        configuration: TerminalNativeSpaceSwitcherConfiguration(
          palette: palette,
          spaces: spaces,
          selectedSpaceID: selectedSpaceID,
          shortcutOverrides: supatermSettings.shortcutOverrides,
          select: { _ = store.send(.selectSpaceButtonTapped($0)) },
          create: { _ = store.send(.spaceCreateButtonTapped) },
          edit: { space in _ = store.send(.spaceRenameRequested(space)) },
          delete: { space in _ = store.send(.spaceDeleteRequested(space)) },
          reorder: { terminal.reorderSpace($0, toInsertionIndex: $1) },
          dropTab: { terminal.dropTab($0, on: $1) }
        )
      )
      .frame(height: TerminalWindowHeaderMetrics.switcherHeight)
    }
  }
}

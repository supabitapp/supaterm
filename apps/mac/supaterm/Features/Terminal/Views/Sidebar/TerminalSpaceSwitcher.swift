import AppKit
import ComposableArchitecture
import Sharing
import SupaTheme
import SupatermSupport
import SwiftUI

struct TerminalSpaceSwitcherPresentation: Equatable {
  let selectedSpace: TerminalSpaceItem
  let canDelete: Bool

  init?(spaces: [TerminalSpaceItem], selectedSpaceID: TerminalSpaceID?) {
    guard let selectedSpace = spaces.first(where: { $0.id == selectedSpaceID }) else {
      return nil
    }
    self.selectedSpace = selectedSpace
    self.canDelete = spaces.count > 1
  }

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
  let selectedSpaceID: TerminalSpaceID?

  var body: some View {
    if let presentation = TerminalSpaceSwitcherPresentation(
      spaces: spaces,
      selectedSpaceID: selectedSpaceID
    ) {
      TerminalNativeSpaceSwitcher(
        palette: palette,
        spaces: spaces,
        selectedSpaceID: selectedSpaceID,
        canDelete: presentation.canDelete,
        select: { _ = store.send(.selectSpaceButtonTapped($0)) },
        create: { _ = store.send(.spaceCreateButtonTapped) },
        edit: { space in _ = store.send(.spaceRenameRequested(space)) },
        delete: { space in _ = store.send(.spaceDeleteRequested(space)) },
        reorder: { terminal.reorderSpace($0, toInsertionIndex: $1) },
        dropTab: { terminal.dropTab($0, on: $1) }
      )
      .frame(height: TerminalWindowHeaderMetrics.switcherHeight)
    }
  }
}

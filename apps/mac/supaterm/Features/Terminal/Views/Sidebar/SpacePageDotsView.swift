import ComposableArchitecture
import SupaTheme
import SwiftUI

enum SpacePageDotMetrics {
  static let diameter: CGFloat = 6
  static let slot: CGFloat = 10
  static let restOpacity: Double = 0.3
  static let displayedOpacity: Double = 0.9

  static func emphasis(at index: Int, position: Double) -> Double {
    max(0, 1 - abs(position - Double(index)))
  }

  static func opacity(emphasis: Double) -> Double {
    restOpacity + (displayedOpacity - restOpacity) * emphasis
  }
}

struct SpacePageDotsView: View {
  let store: StoreOf<TerminalWindowFeature>
  let terminal: TerminalHostState
  let palette: Palette
  let position: Double?

  var body: some View {
    TerminalNativeSpaceDots(
      configuration: TerminalNativeSpaceDotsConfiguration(
        palette: palette,
        spaces: terminal.spaces,
        selectionPosition: position ?? Double(terminal.displayedSpaceIndex),
        select: { spaceID in
          guard spaceID != terminal.displayedSpaceID else { return }
          terminal.onSpaceAction(.select(spaceID))
        },
        edit: { space in _ = store.send(.spaceRenameRequested(space)) },
        delete: { space in _ = store.send(.spaceDeleteRequested(space)) },
        newTab: {
          AppPostHog.capture("terminal_tab_created")
          terminal.createTabInSpace($0)
        },
        reorder: { terminal.reorderSpace($0, toInsertionIndex: $1) },
        dropTab: { terminal.dropTab($0, on: $1) }
      )
    )
    .fixedSize()
    .frame(maxWidth: .infinity)
  }
}

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
    ZStack {
      HStack(spacing: 0) {
        ForEach(Array(terminal.spaces.enumerated()), id: \.element.id) { index, space in
          dot(space, at: index)
        }
      }
      newSpaceButton
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
  }

  private var selectionPosition: Double {
    position ?? Double(terminal.displayedSpaceIndex)
  }

  private func dot(_ space: TerminalSpaceItem, at index: Int) -> some View {
    let emphasis = SpacePageDotMetrics.emphasis(at: index, position: selectionPosition)
    return Button {
      select(space, at: index)
    } label: {
      Circle()
        .fill(palette.primaryText.opacity(SpacePageDotMetrics.opacity(emphasis: emphasis)))
        .frame(width: SpacePageDotMetrics.diameter, height: SpacePageDotMetrics.diameter)
        .frame(width: SpacePageDotMetrics.slot, height: SpacePageDotMetrics.slot)
        .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .help(space.name)
    .accessibilityLabel("Space \(space.name)")
    .accessibilityIdentifier(TerminalSidebarAccessibilityIdentifier.spaceDot(space.id))
    .contextMenu {
      Button("Edit Space", systemImage: "textformat") {
        _ = store.send(.spaceRenameRequested(space))
      }
      Button("New Tab Here", systemImage: "plus") {
        _ = store.send(.newTabInSpaceRequested(space.id))
      }
      Divider()
      Button(role: .destructive) {
        _ = store.send(.spaceDeleteRequested(space))
      } label: {
        Label("Delete Space", systemImage: "trash")
      }
      .disabled(terminal.spaces.count == 1)
    }
  }

  private var newSpaceButton: some View {
    Button {
      _ = store.send(.spaceCreateButtonTapped)
    } label: {
      Image(systemName: "plus")
        .font(.system(size: 11, weight: .semibold))
        .foregroundStyle(palette.primaryText.opacity(SpacePageDotMetrics.restOpacity))
    }
    .buttonStyle(TerminalSidebarButtonStyle(palette: palette, layout: .icon))
    .controlSize(.mini)
    .help("New Space")
    .accessibilityLabel("New Space")
    .accessibilityIdentifier(TerminalSidebarAccessibilityIdentifier.newSpace)
  }

  private func select(_ space: TerminalSpaceItem, at index: Int) {
    guard index != terminal.displayedSpaceIndex else { return }
    _ = store.send(.selectSpaceButtonTapped(space.id))
  }
}

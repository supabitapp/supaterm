import ComposableArchitecture
import SupaTheme
import SwiftUI

enum SpacePageDotMetrics {
  static let restDiameter: CGFloat = 6
  static let displayedDiameter: CGFloat = 10
  static let slot: CGFloat = 18
  static let restOpacity: Double = 0.35

  static func emphasis(at index: Int, position: Double) -> Double {
    max(0, 1 - abs(position - Double(index)))
  }

  static func diameter(emphasis: Double) -> CGFloat {
    restDiameter + (displayedDiameter - restDiameter) * emphasis
  }

  static func opacity(emphasis: Double) -> Double {
    restOpacity + (1 - restOpacity) * emphasis
  }
}

struct SpacePageDotsView: View {
  let store: StoreOf<TerminalWindowFeature>
  let terminal: TerminalHostState
  let palette: Palette
  let position: Double?

  var body: some View {
    HStack(spacing: 0) {
      ForEach(Array(terminal.spaces.enumerated()), id: \.element.id) { index, space in
        dot(space, at: index)
      }
      Spacer(minLength: 0)
      newSpaceButton
    }
  }

  private var displayedIndex: Int {
    terminal.spaces.firstIndex { $0.id == terminal.displayedSpaceID } ?? 0
  }

  private var selectionPosition: Double {
    position ?? Double(displayedIndex)
  }

  private func dot(_ space: TerminalSpaceItem, at index: Int) -> some View {
    let emphasis = SpacePageDotMetrics.emphasis(at: index, position: selectionPosition)
    let diameter = SpacePageDotMetrics.diameter(emphasis: emphasis)
    return Button {
      select(space, at: index)
    } label: {
      Circle()
        .fill(space.color.sidebarColor(palette: palette))
        .opacity(SpacePageDotMetrics.opacity(emphasis: emphasis))
        .frame(width: diameter, height: diameter)
        .frame(width: SpacePageDotMetrics.slot, height: SpacePageDotMetrics.slot)
        .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .help(space.name)
    .accessibilityLabel("Space \(space.name)")
    .accessibilityIdentifier(TerminalSidebarAccessibilityIdentifier.spaceDot(space.id))
    .contextMenu {
      Button {
        _ = store.send(.spaceRenameRequested(space))
      } label: {
        Label("Edit Space", systemImage: "textformat")
      }

      Button {
        _ = store.send(.newTabInSpaceRequested(space.id))
      } label: {
        Label("New Tab Here", systemImage: "plus")
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
        .foregroundStyle(palette.secondaryText)
    }
    .buttonStyle(TerminalSidebarButtonStyle(palette: palette, layout: .icon))
    .controlSize(.mini)
    .help("New Space")
    .accessibilityLabel("New Space")
    .accessibilityIdentifier(TerminalSidebarAccessibilityIdentifier.newSpace)
  }

  private func select(_ space: TerminalSpaceItem, at index: Int) {
    let step = index - displayedIndex
    guard step != 0 else { return }
    if abs(step) == 1, terminal.pageSpace(by: step) { return }
    _ = store.send(.selectSpaceButtonTapped(space.id))
  }
}

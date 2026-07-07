import ComposableArchitecture
import Foundation
import SupaTheme
import SwiftUI

struct TerminalSidebarSpaceBar: View {
  let store: StoreOf<TerminalWindowFeature>
  let palette: Palette
  let terminal: TerminalHostState

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var hoveredSpaceID: TerminalSpaceID?
  @State private var showPreview = false
  @State private var isHoveringList = false

  var body: some View {
    HStack(alignment: .bottom, spacing: 10) {
      spaceList
      Button {
        _ = store.send(.spaceCreateButtonTapped)
      } label: {
        Image(systemName: "plus")
          .font(.system(size: 12, weight: .semibold))
          .frame(width: 32, height: 32)
      }
      .buttonStyle(TerminalSidebarButtonStyle(layout: .icon))
      .foregroundStyle(palette.primaryText)
      .accessibilityLabel("Create Space")
      .help("Create Space")
    }
    .fixedSize(horizontal: false, vertical: true)
    .frame(height: 32)
  }

  private var spaceList: some View {
    Color.clear
      .overlay {
        spaceItems
          .onHover { hovering in
            isHoveringList = hovering
            if !hovering {
              showPreview = false
              hoveredSpaceID = nil
            }
          }
          .overlay(alignment: .top) {
            if showPreview,
              let hoveredSpaceID,
              hoveredSpaceID != terminal.selectedSpaceID,
              let hoveredSpace = terminal.spaces.first(where: { $0.id == hoveredSpaceID })
            {
              Text(hoveredSpace.name)
                .font(.caption)
                .foregroundStyle(palette.primaryText.opacity(0.7))
                .lineLimit(1)
                .id(hoveredSpace.id)
                .terminalTransition(
                  .opacity.combined(with: .scale(scale: 0.96)),
                  reduceMotion: reduceMotion
                )
                .offset(y: -20)
            }
          }
      }
      .frame(maxWidth: .infinity)
  }

  @ViewBuilder
  private var spaceItems: some View {
    if TerminalSidebarLayout.showsSpaceList(spacesCount: terminal.spaces.count) {
      HStack(spacing: 0) {
        ForEach(Array(terminal.spaces.enumerated()), id: \.element.id) { index, space in
          TerminalSidebarSpaceItemView(
            space: space,
            monogram: TerminalSidebarLayout.spaceMonogram(
              for: space.name,
              fallbackIndex: index
            ),
            isSelected: terminal.selectedSpaceID == space.id,
            palette: palette,
            spacesCount: terminal.spaces.count,
            onHoverChange: { isHovering in
              if isHovering {
                hoveredSpaceID = space.id
                if !showPreview {
                  DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
                    if hoveredSpaceID == space.id && isHoveringList {
                      TerminalMotion.animate(
                        .easeInOut(duration: 0.2),
                        reduceMotion: reduceMotion
                      ) {
                        showPreview = true
                      }
                    }
                  }
                }
              } else if hoveredSpaceID == space.id {
                hoveredSpaceID = nil
              }
            },
            onSelect: {
              TerminalMotion.animate(
                .easeOut(duration: 0.1),
                reduceMotion: reduceMotion
              ) {
                _ = store.send(.selectSpaceButtonTapped(space.id))
              }
            },
            onRename: {
              _ = store.send(.spaceRenameRequested(space))
            },
            onDelete: {
              _ = store.send(.spaceDeleteRequested(space))
            }
          )

          if index != terminal.spaces.count - 1 {
            Spacer()
              .frame(minWidth: 1, maxWidth: 8)
              .layoutPriority(-1)
          }
        }
      }
    }
  }
}

private struct TerminalSidebarSpaceItemView: View {
  let space: TerminalSpaceItem
  let monogram: String
  let isSelected: Bool
  let palette: Palette
  let spacesCount: Int
  let onHoverChange: (Bool) -> Void
  let onSelect: () -> Void
  let onRename: () -> Void
  let onDelete: () -> Void

  @State private var isHovering = false

  var body: some View {
    Button(action: onSelect) {
      Text(monogram)
        .font(.system(size: 12, weight: .semibold, design: .rounded))
        .frame(maxWidth: .infinity)
        .foregroundStyle(palette.primaryText)
        .opacity(isSelected ? 1 : 0.7)
    }
    .buttonStyle(TerminalSidebarButtonStyle(layout: .space))
    .onHover { hovering in
      isHovering = hovering
      onHoverChange(hovering)
    }
    .contextMenu {
      Button {
        onRename()
      } label: {
        Label("Rename Space", systemImage: "textformat")
      }

      Divider()

      Button(role: .destructive) {
        onDelete()
      } label: {
        Label("Delete Space", systemImage: "trash")
      }
      .disabled(spacesCount <= 1)
    }
    .accessibilityLabel("Space \(space.name)")
  }
}

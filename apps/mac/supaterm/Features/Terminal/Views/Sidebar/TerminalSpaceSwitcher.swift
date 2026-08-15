import AppKit
import ComposableArchitecture
import Sharing
import SupaTheme
import SupatermSupport
import SwiftUI

struct TerminalSpaceSwitcherPresentation: Equatable {
  let selectedSpace: TerminalSpaceItem
  let canDelete: Bool

  init?(spaces: [TerminalSpaceItem], selectedSpaceID: TerminalSpaceID) {
    guard let selectedSpace = spaces.first(where: { $0.id == selectedSpaceID }) else {
      return nil
    }
    self.selectedSpace = selectedSpace
    canDelete = spaces.count > 1
  }
}

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

      TerminalAgentsPopoverButton(palette: palette)
        .padding(.top, TerminalWindowHeaderMetrics.switcherTopPadding)
        .padding(.trailing, TerminalWindowHeaderMetrics.spacing)
        .frame(height: TerminalSidebarLayout.scrollViewportTopInset, alignment: .top)
        .background {
          WindowDragSurface()
        }
    }
    .frame(height: TerminalSidebarLayout.scrollViewportTopInset, alignment: .topLeading)
  }
}

struct TerminalSpaceSwitcher: View {
  let store: StoreOf<TerminalWindowFeature>
  let palette: Palette
  let spaces: [TerminalSpaceItem]
  let selectedSpaceID: TerminalSpaceID

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Shared(.supatermSettings) private var supatermSettings = .default
  @State private var isHovered = false

  var body: some View {
    if let presentation = TerminalSpaceSwitcherPresentation(
      spaces: spaces,
      selectedSpaceID: selectedSpaceID
    ) {
      Menu {
        ForEach(Array(spaces.enumerated()), id: \.element.id) { index, space in
          Toggle(
            isOn: Binding(
              get: { space.id == selectedSpaceID },
              set: { _ in _ = store.send(.selectSpaceButtonTapped(space.id)) }
            )
          ) {
            Label {
              Text(space.name)
            } icon: {
              Image(nsImage: colorDot(for: space.color))
                .accessibilityHidden(true)
            }
          }
          .supatermKeyboardShortcut(
            TerminalSpaceShortcut.shortcutBinding(
              forSpaceAt: index,
              overrides: supatermSettings.shortcutOverrides
            )?.keyboardShortcut
          )
        }

        Divider()

        Button {
          _ = store.send(.spaceCreateButtonTapped)
        } label: {
          Label("New Space", systemImage: "plus")
        }

        Button {
          _ = store.send(.spaceRenameRequested(presentation.selectedSpace))
        } label: {
          Label("Edit Space", systemImage: "textformat")
        }

        Button(role: .destructive) {
          _ = store.send(.spaceDeleteRequested(presentation.selectedSpace))
        } label: {
          Label("Delete Space", systemImage: "trash")
        }
        .disabled(!presentation.canDelete)
      } label: {
        TerminalSpaceSwitcherLabel(
          palette: palette,
          name: presentation.selectedSpace.name,
          isHovered: isHovered
        )
      }
      .menuStyle(.button)
      .buttonStyle(.plain)
      .menuIndicator(.hidden)
      .fixedSize()
      .onHover { hovering in
        TerminalMotion.animate(.easeInOut(duration: 0.1), reduceMotion: reduceMotion) {
          isHovered = hovering
        }
      }
      .accessibilityLabel("Space \(presentation.selectedSpace.name)")
      .accessibilityIdentifier("titlebar.space-switcher")
      .help("Switch Space")
    }
  }

  private func colorDot(for color: ThemeTint) -> NSImage {
    let nsColor = color.sidebarNSColor(palette: palette)
    let image = NSImage(size: NSSize(width: 10, height: 10), flipped: false) { rect in
      nsColor.setFill()
      NSBezierPath(ovalIn: rect).fill()
      return true
    }
    image.isTemplate = false
    return image
  }
}

struct TerminalSpaceSwitcherLabel: View {
  let palette: Palette
  let name: String
  let isHovered: Bool

  var body: some View {
    Text(name)
      .font(.system(size: 12, weight: .bold))
      .lineLimit(1)
      .foregroundStyle(palette.spaceTitle)
      .padding(.horizontal, 8)
      .frame(height: TerminalWindowHeaderMetrics.switcherHeight)
      .background(
        isHovered ? palette.secondaryText.opacity(0.1) : .clear,
        in: .rect(cornerRadius: 7)
      )
  }
}

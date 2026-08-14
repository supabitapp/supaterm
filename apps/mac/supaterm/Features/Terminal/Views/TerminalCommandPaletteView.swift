import SupaTheme
import SupatermUI
import SwiftUI

struct TerminalCommandPaletteOverlay: View {
  let palette: Palette
  let state: TerminalCommandPaletteState
  let matches: [TerminalCommandPaletteMatch]
  let onActivate: () -> Void
  let onClose: () -> Void
  let onQueryChange: (String) -> Void
  let onMoveSelection: (Int) -> Void
  let onSelectionChange: (Int) -> Void

  @Environment(CommandHoldObserver.self) private var commandHoldObserver

  private var selectedRowID: TerminalCommandPaletteRow.ID? {
    TerminalCommandPalettePresentation.normalizedSelection(state.selectedRowID, in: matches)
  }

  var body: some View {
    GeometryReader { geometry in
      let width = min(334, max(280, geometry.size.width - 32))

      ZStack {
        SearchPanelSurface(
          theme: .palette(palette),
          query: queryBinding,
          selection: selectionBinding,
          items: items,
          prompt: "Search commands...",
          accessibilityNamespace: "palette",
          layout: SearchPanelLayout(width: width, height: 360),
          onActivate: { _ in onActivate() },
          onDismiss: onClose
        )

        Group {
          Button(action: { onMoveSelection(-1) }, label: { Color.clear })
            .keyboardShortcut(KeyEquivalent("p"), modifiers: [.control])
          Button(action: { onMoveSelection(1) }, label: { Color.clear })
            .keyboardShortcut(KeyEquivalent("n"), modifiers: [.control])
        }
        .buttonStyle(.plain)
        .frame(width: 0, height: 0)
        .accessibilityHidden(true)
      }
    }
  }

  private var items: [SearchPanelItem<TerminalCommandPaletteRow.ID>] {
    matches.enumerated().map { index, match in
      SearchPanelItem(
        id: match.id,
        title: highlightedText(
          match.row.title,
          offsets: match.titleMatchedCharacterOffsets,
          fontSize: 13,
          isSelected: match.id == selectedRowID
        ),
        subtitle: match.displaySubtitle.map {
          highlightedText(
            $0,
            offsets: match.displaySubtitleMatchedCharacterOffsets,
            fontSize: 11,
            isSelected: match.id == selectedRowID
          )
        },
        detail: match.row.description,
        leadingIcon: match.row.leadingIcon,
        badge: match.row.badge,
        shortcut: shortcutHint(for: match.row, index: index),
        isEmphasized: match.row.emphasis
      )
    }
  }

  private var queryBinding: Binding<String> {
    Binding(
      get: { state.query },
      set: { onQueryChange($0) }
    )
  }

  private var selectionBinding: Binding<TerminalCommandPaletteRow.ID?> {
    Binding(
      get: { selectedRowID },
      set: { selectedID in
        guard let selectedID, let index = matches.firstIndex(where: { $0.id == selectedID }) else { return }
        onSelectionChange(index)
      }
    )
  }

  private func shortcutHint(for row: TerminalCommandPaletteRow, index: Int) -> String? {
    if commandHoldObserver.isPressed, (0..<9).contains(index) {
      return "⌘\(index + 1)"
    }
    return row.shortcut
  }

  private func highlightedText(
    _ text: String,
    offsets: [Int],
    fontSize: CGFloat,
    isSelected: Bool
  ) -> AttributedString {
    var attributedText = AttributedString(text)
    for offset in offsets {
      let start = attributedText.index(attributedText.startIndex, offsetByCharacters: offset)
      let end = attributedText.index(start, offsetByCharacters: 1)
      attributedText[start..<end].font = .system(size: fontSize, weight: .bold)
      attributedText[start..<end].foregroundColor = isSelected ? palette.selectedText : palette.accent
    }
    return attributedText
  }
}

#Preview("Command Palette") {
  let matches = TerminalCommandPalettePresentation.matches(
    in: [
      TerminalCommandPaletteRow(
        id: "ghostty:new_split:right",
        title: "Split Right",
        subtitle: "Terminal",
        description: "Split the focused terminal to the right.",
        leadingIcon: "rectangle.split.2x1",
        badge: nil,
        emphasis: false,
        shortcut: "⌘D",
        command: .ghosttyBindingAction("new_split:right")
      ),
      TerminalCommandPaletteRow(
        id: "ghostty:new_split:down",
        title: "Split Down",
        subtitle: "Terminal",
        description: "Split the focused terminal below.",
        leadingIcon: "rectangle.split.1x2",
        badge: nil,
        emphasis: false,
        shortcut: "⌘⇧D",
        command: .ghosttyBindingAction("new_split:down")
      ),
    ],
    query: "split"
  )

  TerminalCommandPaletteOverlay(
    palette: Palette(colorScheme: .dark, backgroundSeed: previewBackgroundSeed(for: .dark)),
    state: TerminalCommandPaletteState(query: "split", selectedRowID: matches.first?.id),
    matches: matches,
    onActivate: {},
    onClose: {},
    onQueryChange: { _ in },
    onMoveSelection: { _ in },
    onSelectionChange: { _ in }
  )
  .frame(width: 840, height: 420)
  .environment(\.colorScheme, .dark)
  .environment(CommandHoldObserver())
}

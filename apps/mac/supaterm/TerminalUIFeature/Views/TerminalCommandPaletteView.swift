import AppKit
import SupatermTerminalModels
import SupatermTerminalPresentationFeature
import SwiftUI

struct TerminalCommandPaletteOverlay: View {
  let palette: TerminalPalette
  let state: TerminalCommandPaletteState
  let rows: [TerminalCommandPaletteRow]
  let onActivate: () -> Void
  let onClose: () -> Void
  let onQueryChange: (String) -> Void
  let onMoveSelection: (Int) -> Void
  let onSelectionChange: (Int) -> Void

  @Environment(\.colorScheme) private var colorScheme
  @Environment(CommandHoldObserver.self) private var commandHoldObserver
  @FocusState private var isQueryFocused: Bool
  @State private var hoveredRowID: TerminalCommandPaletteRow.ID?

  private let cardHeight: CGFloat = 272
  private let cardCornerRadius: CGFloat = 26
  private let maxWidth: CGFloat = 750
  private let minWidth: CGFloat = 280

  private var selectedRowID: TerminalCommandPaletteRow.ID? {
    TerminalCommandPalettePresentation.normalizedSelection(state.selectedRowID, in: rows)
  }

  private var theme: TerminalCommandPaletteTheme {
    TerminalCommandPaletteTheme(
      colorScheme: colorScheme,
      accent: palette.sky
    )
  }

  var body: some View {
    GeometryReader { geometry in
      let cardWidth = min(maxWidth, max(minWidth, geometry.size.width - 32))

      ZStack {
        Button(action: onClose) {
          Color.clear
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Close command palette")

        VStack(alignment: .leading, spacing: 5) {
          searchField

          if !rows.isEmpty {
            RoundedRectangle(cornerRadius: 100, style: .continuous)
              .fill(theme.separator)
              .frame(height: 0.5)
          }

          ScrollViewReader { proxy in
            Group {
              if rows.isEmpty {
                VStack {
                  Spacer(minLength: 0)
                  Text("No matches")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(theme.secondaryText)
                    .frame(maxWidth: .infinity, alignment: .center)
                  Spacer(minLength: 0)
                }
              } else {
                ScrollView {
                  LazyVStack(alignment: .leading, spacing: 3) {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                      CommandPaletteRowButton(
                        row: row,
                        shortcutHint: shortcutHint(for: row, index: index),
                        theme: theme,
                        isHovered: hoveredRowID == row.id,
                        isSelected: selectedRowID == row.id,
                        action: {
                          onSelectionChange(index)
                          onActivate()
                        }
                      )
                      .id(row.id)
                      .onHover { isHovering in
                        hoveredRowID = isHovering ? row.id : nil
                      }
                    }
                  }
                  .frame(maxWidth: .infinity, alignment: .leading)
                }
              }
            }
            .scrollIndicators(.never)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .onAppear {
              scrollSelection(into: proxy)
            }
            .onChange(of: selectedRowID) { _, _ in
              scrollSelection(into: proxy)
            }
          }
        }
        .padding(9)
        .frame(width: cardWidth, height: cardHeight, alignment: .top)
        .background(theme.surfaceTint, in: .rect(cornerRadius: cardCornerRadius))
        .background {
          BlurEffectView(material: .popover, blendingMode: .withinWindow)
            .clipShape(.rect(cornerRadius: cardCornerRadius))
        }
        .compositingGroup()
        .clipShape(.rect(cornerRadius: cardCornerRadius))
        .overlay {
          RoundedRectangle(cornerRadius: cardCornerRadius, style: .continuous)
            .stroke(theme.surfaceStroke, lineWidth: 0.5)
        }
        .overlay {
          RoundedRectangle(cornerRadius: cardCornerRadius - 1, style: .continuous)
            .stroke(theme.surfaceHighlight, lineWidth: 0.5)
            .padding(1)
        }
        .shadow(color: theme.shadow, radius: 22, y: 12)
        .frame(width: geometry.size.width, height: geometry.size.height, alignment: .center)
      }
    }
    .task {
      focusQueryField()
    }
  }

  private var searchField: some View {
    ZStack {
      Group {
        Button(action: { onMoveSelection(-1) }, label: { Color.clear })
          .buttonStyle(.plain)
          .keyboardShortcut(KeyEquivalent("p"), modifiers: [.control])

        Button(action: { onMoveSelection(1) }, label: { Color.clear })
          .buttonStyle(.plain)
          .keyboardShortcut(KeyEquivalent("n"), modifiers: [.control])
      }
      .frame(width: 0, height: 0)
      .accessibilityHidden(true)

      HStack(spacing: 12) {
        Image(systemName: "magnifyingglass")
          .font(.system(size: 13, weight: .regular))
          .foregroundStyle(theme.fieldIcon)
          .frame(width: 13)
          .accessibilityHidden(true)

        TextField("Search commands...", text: queryBinding)
          .textFieldStyle(.plain)
          .font(.system(size: 17, weight: .medium))
          .foregroundStyle(state.query.isEmpty ? theme.placeholderText : theme.primaryText)
          .tint(theme.tint)
          .focused($isQueryFocused)
          .onChange(of: isQueryFocused) { _, isFocused in
            if !isFocused {
              onClose()
            }
          }
          .onKeyPress(.escape) {
            onClose()
            return .handled
          }
          .onKeyPress(.return) {
            onActivate()
            return .handled
          }
          .onKeyPress(.upArrow) {
            onMoveSelection(-1)
            return .handled
          }
          .onKeyPress(.downArrow) {
            onMoveSelection(1)
            return .handled
          }
      }
    }
    .padding(.vertical, 6)
    .padding(.horizontal, 7)
  }

  private var queryBinding: Binding<String> {
    Binding(
      get: { state.query },
      set: { onQueryChange($0) }
    )
  }

  private func focusQueryField() {
    isQueryFocused = false
    Task { @MainActor in
      await Task.yield()
      isQueryFocused = true
      await Task.yield()
      NSApp.sendAction(#selector(NSText.selectAll(_:)), to: nil, from: nil)
    }
  }

  private func scrollSelection(into proxy: ScrollViewProxy) {
    guard let selectedRowID else { return }
    proxy.scrollTo(selectedRowID, anchor: .center)
  }

  private func shortcutHint(
    for row: TerminalCommandPaletteRow,
    index: Int
  ) -> String? {
    if commandHoldObserver.isPressed {
      let slot = index + 1
      if (1...9).contains(slot) {
        return "⌘\(slot)"
      }
    }
    return row.shortcut
  }
}

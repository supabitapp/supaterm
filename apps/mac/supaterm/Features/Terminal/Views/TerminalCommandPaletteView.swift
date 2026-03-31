import AppKit
import SwiftUI

struct TerminalCommandPaletteOverlay: View {
  let palette: TerminalPalette
  let state: TerminalCommandPaletteState
  let onActivate: () -> Void
  let onClose: () -> Void
  let onQueryChange: (String) -> Void
  let onMoveSelection: (Int) -> Void
  let onSelectionChange: (Int) -> Void

  @Environment(\.colorScheme) private var colorScheme
  @FocusState private var isQueryFocused: Bool
  @State private var hoveredRowID: TerminalCommandPaletteRow.ID?

  private let cardHeight: CGFloat = 328
  private let cardCornerRadius: CGFloat = 26
  private let maxWidth: CGFloat = 765
  private let minWidth: CGFloat = 200

  private var rows: [TerminalCommandPaletteRow] {
    state.rows
  }

  private var theme: TerminalCommandPaletteTheme {
    .init(
      colorScheme: colorScheme,
      accent: palette.sky
    )
  }

  var body: some View {
    GeometryReader { geometry in
      let cardWidth = min(maxWidth, max(minWidth, geometry.size.width - 20))

      ZStack {
        Button(action: onClose) {
          Color.clear
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Close command palette")

        VStack {
          Spacer()

          VStack(alignment: .leading, spacing: 6) {
            searchField

            if !rows.isEmpty {
              RoundedRectangle(cornerRadius: 100, style: .continuous)
                .fill(theme.separator)
                .frame(height: 0.5)
            }

            ScrollViewReader { proxy in
              ScrollView {
                LazyVStack(spacing: 5) {
                  ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                    CommandPaletteRowButton(
                      row: row,
                      theme: theme,
                      isHovered: hoveredRowID == row.id,
                      isSelected: state.selectedIndex == index,
                      action: {
                        onSelectionChange(index)
                        onActivate()
                      }
                    )
                    .id(row.id)
                    .onHover { isHovering in
                      hoveredRowID = isHovering ? row.id : nil
                      if isHovering {
                        onSelectionChange(index)
                      }
                    }
                  }
                }
              }
              .scrollIndicators(.hidden)
              .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
              .animation(.easeInOut(duration: 0.15), value: state.selectedIndex)
              .onAppear {
                scrollSelection(into: proxy)
              }
              .onChange(of: state.selectedIndex) { _, _ in
                scrollSelection(into: proxy)
              }
            }
          }
          .padding(10)
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

          Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .transition(.scale(scale: 0.98).combined(with: .opacity))
    .task {
      focusQueryField()
    }
  }

  private var searchField: some View {
    HStack(spacing: 15) {
      Image(systemName: "magnifyingglass")
        .font(.system(size: 14, weight: .regular))
        .foregroundStyle(theme.fieldIcon)
        .frame(width: 15)
        .accessibilityHidden(true)

      TextField("Search commands...", text: queryBinding)
        .textFieldStyle(.plain)
        .font(.system(size: 18, weight: .medium))
        .foregroundStyle(state.query.isEmpty ? theme.placeholderText : theme.primaryText)
        .tint(theme.tint)
        .focused($isQueryFocused)
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
    .padding(.vertical, 8)
    .padding(.horizontal, 8)
  }

  private var queryBinding: Binding<String> {
    Binding(
      get: { state.query },
      set: onQueryChange
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
    guard rows.indices.contains(state.selectedIndex) else { return }
    withAnimation(.easeOut(duration: 0.12)) {
      proxy.scrollTo(rows[state.selectedIndex].id, anchor: .center)
    }
  }
}

private struct CommandPaletteRowButton: View {
  let row: TerminalCommandPaletteRow
  let theme: TerminalCommandPaletteTheme
  let isHovered: Bool
  let isSelected: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 0) {
        HStack(spacing: 9) {
          Image(systemName: row.symbol)
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(iconForeground)
            .frame(width: 24, height: 24)
            .background(iconBackground, in: .rect(cornerRadius: 4))
            .overlay {
              RoundedRectangle(cornerRadius: 4, style: .continuous)
                .stroke(iconStroke, lineWidth: 0.5)
            }
            .accessibilityHidden(true)

          HStack(spacing: 4) {
            Text(row.title)
              .font(.system(size: 13, weight: .semibold))
              .foregroundStyle(titleColor)
              .lineLimit(1)
              .truncationMode(.tail)

            Text("—")
              .font(.system(size: 13, weight: .semibold))
              .foregroundStyle(subtitleColor.opacity(0.72))

            Text(row.subtitle)
              .font(.system(size: 13, weight: .semibold))
              .foregroundStyle(subtitleColor)
              .lineLimit(1)
              .truncationMode(.tail)
          }
        }

        Spacer()
      }
      .padding(.horizontal, 10)
      .padding(.vertical, 11)
      .frame(maxWidth: .infinity)
      .background(rowBackground, in: .rect(cornerRadius: 6))
      .overlay {
        RoundedRectangle(cornerRadius: 6, style: .continuous)
          .stroke(rowStroke, lineWidth: 0.5)
      }
      .contentShape(.rect(cornerRadius: 6))
    }
    .buttonStyle(.plain)
  }

  private var titleColor: Color {
    if isSelected {
      return theme.selectedText
    }
    return theme.primaryText
  }

  private var subtitleColor: Color {
    if isSelected {
      return theme.selectedSecondaryText
    }
    return theme.secondaryText
  }

  private var iconForeground: Color {
    if isSelected {
      return theme.selectedIconForeground
    }
    return theme.iconForeground
  }

  private var iconBackground: Color {
    if isSelected {
      return theme.selectedIconFill
    }
    return theme.iconFill
  }

  private var iconStroke: Color {
    if isSelected {
      return theme.selectedIconStroke
    }
    return theme.iconStroke
  }

  private var rowBackground: Color {
    if isSelected {
      return theme.selectedFill
    }
    if isHovered {
      return theme.rowHoverFill
    }
    return .clear
  }

  private var rowStroke: Color {
    if isSelected {
      return theme.selectedStroke
    }
    return .clear
  }
}

private struct TerminalCommandPaletteTheme {
  let surfaceTint: Color
  let surfaceStroke: Color
  let surfaceHighlight: Color
  let separator: Color
  let primaryText: Color
  let placeholderText: Color
  let secondaryText: Color
  let selectedText: Color
  let selectedSecondaryText: Color
  let fieldIcon: Color
  let tint: Color
  let rowHoverFill: Color
  let selectedFill: Color
  let selectedStroke: Color
  let iconFill: Color
  let iconStroke: Color
  let iconForeground: Color
  let selectedIconFill: Color
  let selectedIconStroke: Color
  let selectedIconForeground: Color
  let shadow: Color

  init(colorScheme: ColorScheme, accent: Color) {
    surfaceTint = Color(nsColor: .windowBackgroundColor).opacity(0.35)
    tint = accent

    if colorScheme == .dark {
      surfaceStroke = Color.white.opacity(0.12)
      surfaceHighlight = Color.white.opacity(0.06)
      separator = Color.white.opacity(0.28)
      primaryText = Color.white.opacity(0.9)
      placeholderText = Color.white.opacity(0.25)
      secondaryText = Color.white.opacity(0.5)
      selectedText = .white
      selectedSecondaryText = Color.white.opacity(0.7)
      fieldIcon = .white
      rowHoverFill = Color.white.opacity(0.06)
      selectedFill = accent.opacity(0.96)
      selectedStroke = Color.white.opacity(0.14)
      iconFill = Color.white.opacity(0.04)
      iconStroke = Color.white.opacity(0.08)
      iconForeground = Color.white.opacity(0.72)
      selectedIconFill = Color.white.opacity(0.96)
      selectedIconStroke = Color.white.opacity(0.18)
      selectedIconForeground = accent.opacity(0.96)
      shadow = Color.black.opacity(0.2)
    } else {
      surfaceStroke = Color.black.opacity(0.08)
      surfaceHighlight = Color.white.opacity(0.5)
      separator = Color.black.opacity(0.22)
      primaryText = Color.black.opacity(0.88)
      placeholderText = Color.black.opacity(0.25)
      secondaryText = Color.black.opacity(0.44)
      selectedText = .white
      selectedSecondaryText = Color.white.opacity(0.74)
      fieldIcon = Color.black.opacity(0.94)
      rowHoverFill = Color.black.opacity(0.05)
      selectedFill = accent.opacity(0.94)
      selectedStroke = Color.white.opacity(0.16)
      iconFill = Color.black.opacity(0.03)
      iconStroke = Color.black.opacity(0.06)
      iconForeground = Color.black.opacity(0.72)
      selectedIconFill = Color.white.opacity(0.96)
      selectedIconStroke = Color.white.opacity(0.18)
      selectedIconForeground = accent.opacity(0.96)
      shadow = Color.black.opacity(0.1)
    }
  }
}

private struct TerminalCommandPalettePreviewColumn: View {
  let colorScheme: ColorScheme

  var body: some View {
    ZStack {
      Rectangle()
        .fill(
          LinearGradient(
            colors: colorScheme == .dark
              ? [
                Color(red: 0.16, green: 0.16, blue: 0.18),
                Color(red: 0.06, green: 0.06, blue: 0.08),
              ]
              : [
                Color(red: 0.98, green: 0.95, blue: 0.91),
                Color(red: 0.89, green: 0.92, blue: 0.96),
              ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
          )
        )
        .overlay {
          RoundedRectangle(cornerRadius: 32, style: .continuous)
            .fill(Color.white.opacity(colorScheme == .dark ? 0.03 : 0.2))
            .padding(60)
        }

      TerminalCommandPaletteOverlay(
        palette: TerminalPalette(colorScheme: colorScheme),
        state: .init(query: "split", selectedIndex: 1),
        onActivate: {},
        onClose: {},
        onQueryChange: { _ in },
        onMoveSelection: { _ in },
        onSelectionChange: { _ in }
      )
    }
    .frame(width: 840, height: 420)
    .environment(\.colorScheme, colorScheme)
  }
}

private struct TerminalCommandPalettePreviewComparison: View {
  var body: some View {
    ScrollView(.horizontal) {
      HStack(alignment: .top, spacing: 16) {
        TerminalCommandPalettePreviewColumn(colorScheme: .light)
        TerminalCommandPalettePreviewColumn(colorScheme: .dark)
      }
      .padding(16)
    }
    .frame(width: 1712, height: 452)
  }
}

#Preview("Command Palette") {
  TerminalCommandPalettePreviewComparison()
}

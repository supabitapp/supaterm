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

  @FocusState private var isQueryFocused: Bool
  @State private var hoveredRowID: TerminalCommandPaletteRow.ID?

  private let cardHeight: CGFloat = 328
  private let cardCornerRadius: CGFloat = 26
  private let maxWidth: CGFloat = 765
  private let minWidth: CGFloat = 200

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

            RoundedRectangle(cornerRadius: 100, style: .continuous)
              .fill(palette.secondaryText.opacity(0.24))
              .frame(height: 0.5)

            ScrollViewReader { proxy in
              ScrollView {
                LazyVStack(spacing: 5) {
                  ForEach(Array(state.rows.enumerated()), id: \.element.id) { index, row in
                    CommandPaletteRowButton(
                      palette: palette,
                      row: row,
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
          .background(palette.dialogOuterBackground.opacity(0.44), in: .rect(cornerRadius: cardCornerRadius))
          .background {
            BlurEffectView(material: .hudWindow, blendingMode: .withinWindow)
              .clipShape(.rect(cornerRadius: cardCornerRadius))
          }
          .compositingGroup()
          .clipShape(.rect(cornerRadius: cardCornerRadius))
          .overlay {
            RoundedRectangle(cornerRadius: cardCornerRadius, style: .continuous)
              .stroke(palette.detailStroke, lineWidth: 0.5)
          }
          .shadow(color: palette.shadow, radius: 24, y: 14)

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
        .foregroundStyle(palette.primaryText)
        .frame(width: 15)
        .accessibilityHidden(true)

      TextField("Search commands...", text: queryBinding)
        .textFieldStyle(.plain)
        .font(.system(size: 18, weight: .medium))
        .foregroundStyle(state.query.isEmpty ? palette.secondaryText.opacity(0.55) : palette.primaryText)
        .tint(palette.sky)
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
    guard state.rows.indices.contains(state.selectedIndex) else { return }
    withAnimation(.easeOut(duration: 0.12)) {
      proxy.scrollTo(state.rows[state.selectedIndex].id, anchor: .center)
    }
  }
}

private struct CommandPaletteRowButton: View {
  let palette: TerminalPalette
  let row: TerminalCommandPaletteRow
  let isHovered: Bool
  let isSelected: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 0) {
        HStack(spacing: 9) {
          Image(systemName: row.symbol)
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(isSelected ? palette.selectedText : palette.secondaryText)
            .frame(width: 24, height: 24)
            .background(iconBackground, in: .rect(cornerRadius: 4))
            .accessibilityHidden(true)

          HStack(spacing: 4) {
            Text(row.title)
              .font(.system(size: 13, weight: .semibold))
              .foregroundStyle(isSelected ? palette.selectedText : palette.primaryText)
              .lineLimit(1)
              .truncationMode(.tail)

            Text("—")
              .font(.system(size: 13, weight: .semibold))
              .foregroundStyle(isSelected ? palette.selectedText.opacity(0.5) : palette.secondaryText.opacity(0.7))

            Text(row.subtitle)
              .font(.system(size: 13, weight: .semibold))
              .foregroundStyle(isSelected ? palette.selectedText.opacity(0.62) : palette.secondaryText)
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
      .contentShape(.rect(cornerRadius: 6))
    }
    .buttonStyle(.plain)
  }

  private var iconBackground: Color {
    if isSelected {
      return palette.dialogInnerBackground.opacity(0.82)
    }
    return palette.clearFill
  }

  private var rowBackground: Color {
    if isSelected {
      return palette.selectedFill
    }
    if isHovered {
      return palette.rowFill
    }
    return .clear
  }
}

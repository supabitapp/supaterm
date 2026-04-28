import AppKit
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

private struct CommandPaletteRowButton: View {
  let row: TerminalCommandPaletteRow
  let shortcutHint: String?
  let theme: TerminalCommandPaletteTheme
  let isHovered: Bool
  let isSelected: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 12) {
        leadingContent

        VStack(alignment: .leading, spacing: row.subtitle == nil ? 0 : 2) {
          HStack(spacing: 6) {
            Text(row.title)
              .font(.system(size: 13, weight: .semibold))
              .foregroundStyle(titleColor)
              .lineLimit(1)
              .truncationMode(.tail)

            if let badge = row.badge {
              Text(badge)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(badgeTextColor)
                .lineLimit(1)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(badgeBackground, in: Capsule(style: .continuous))
            }
          }

          if let subtitle = row.subtitle {
            Text(subtitle)
              .font(.system(size: 11, weight: .medium))
              .foregroundStyle(subtitleColor)
              .lineLimit(1)
              .truncationMode(.tail)
          }
        }

        Spacer()

        if let shortcutHint {
          Text(shortcutHint)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(shortcutHintColor)
        }
      }
      .padding(.horizontal, 11)
      .padding(.vertical, 9)
      .frame(maxWidth: .infinity)
      .background(rowBackground, in: .rect(cornerRadius: 5))
      .overlay {
        RoundedRectangle(cornerRadius: 5, style: .continuous)
          .stroke(rowStroke, lineWidth: 0.5)
      }
      .contentShape(.rect(cornerRadius: 5))
    }
    .buttonStyle(.plain)
    .help(row.description ?? "")
  }

  @ViewBuilder
  private var leadingContent: some View {
    if let leadingIcon = row.leadingIcon {
      Image(systemName: leadingIcon)
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(iconColor)
        .frame(width: 14, height: 14)
        .accessibilityHidden(true)
    }
  }

  private var titleColor: Color {
    if isSelected {
      return theme.selectedText
    }
    if row.emphasis {
      return theme.emphasisText
    }
    return theme.primaryText
  }

  private var subtitleColor: Color {
    if isSelected {
      return theme.selectedSecondaryText
    }
    if row.emphasis {
      return theme.emphasisSecondaryText
    }
    return theme.secondaryText
  }

  private var shortcutHintColor: Color {
    if isSelected {
      return theme.selectedSecondaryText.opacity(0.72)
    }
    return theme.secondaryText
  }

  private var iconColor: Color {
    if isSelected {
      return theme.selectedSecondaryText
    }
    if row.emphasis {
      return theme.emphasisText
    }
    return theme.secondaryText
  }

  private var rowBackground: Color {
    if isSelected {
      return theme.selectedFill
    }
    if row.emphasis {
      return isHovered ? theme.emphasisFill : theme.emphasisFill.opacity(0.88)
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

  private var badgeBackground: Color {
    if isSelected {
      return Color.white.opacity(0.18)
    }
    return row.emphasis ? theme.emphasisBadgeFill : theme.badgeFill
  }

  private var badgeTextColor: Color {
    if isSelected {
      return theme.selectedText
    }
    return row.emphasis ? theme.emphasisText : theme.primaryText
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
  let badgeFill: Color
  let emphasisFill: Color
  let emphasisText: Color
  let emphasisSecondaryText: Color
  let emphasisBadgeFill: Color
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
      badgeFill = Color.white.opacity(0.08)
      emphasisFill = accent.opacity(0.18)
      emphasisText = accent
      emphasisSecondaryText = accent.opacity(0.82)
      emphasisBadgeFill = accent.opacity(0.22)
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
      badgeFill = Color.black.opacity(0.08)
      emphasisFill = accent.opacity(0.14)
      emphasisText = accent.opacity(0.95)
      emphasisSecondaryText = accent.opacity(0.8)
      emphasisBadgeFill = accent.opacity(0.18)
      shadow = Color.black.opacity(0.1)
    }
  }
}

private struct TerminalCommandPalettePreviewColumn: View {
  let colorScheme: ColorScheme

  private var rows: [TerminalCommandPaletteRow] {
    TerminalCommandPalettePresentation.visibleRows(
      in: [
        TerminalCommandPaletteRow(
          id: "update:install",
          title: "Install and Relaunch",
          subtitle: "Update Available",
          description: "Supaterm 1.2.3 is ready to download and install.",
          leadingIcon: "shippingbox.fill",
          badge: "1.2.3",
          emphasis: true,
          shortcut: nil,
          command: .update(.install)
        ),
        TerminalCommandPaletteRow(
          id: "focus:ping",
          title: "Focus: ping 1.1.1.1",
          subtitle: "~/Projects/network",
          description: nil,
          leadingIcon: "rectangle.on.rectangle",
          badge: nil,
          emphasis: false,
          shortcut: nil,
          command: .focusPane(
            TerminalCommandPaletteFocusTarget(
              windowControllerID: UUID(),
              surfaceID: UUID(),
              title: "ping 1.1.1.1",
              subtitle: "~/Projects/network"
            )
          )
        ),
        TerminalCommandPaletteRow(
          id: "ghostty:new_split:right",
          title: "Split Right",
          subtitle: nil,
          description: "Split the focused terminal to the right.",
          leadingIcon: nil,
          badge: nil,
          emphasis: false,
          shortcut: "⌘D",
          command: .ghosttyBindingAction("new_split:right")
        ),
        TerminalCommandPaletteRow(
          id: "ghostty:new_split:down",
          title: "Split Down",
          subtitle: nil,
          description: "Split the focused terminal below.",
          leadingIcon: nil,
          badge: nil,
          emphasis: false,
          shortcut: "⌘⇧D",
          command: .ghosttyBindingAction("new_split:down")
        ),
        TerminalCommandPaletteRow(
          id: "supaterm:toggle-sidebar",
          title: "Toggle Sidebar",
          subtitle: "View",
          description: nil,
          leadingIcon: nil,
          badge: nil,
          emphasis: false,
          shortcut: "⌘S",
          command: .toggleSidebar
        ),
      ],
      query: "split"
    )
  }

  private var state: TerminalCommandPaletteState {
    TerminalCommandPaletteState(
      query: "split",
      selectedRowID: rows.indices.contains(1) ? rows[1].id : rows.first?.id
    )
  }

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
        state: state,
        rows: rows,
        onActivate: {},
        onClose: {},
        onQueryChange: { _ in },
        onMoveSelection: { _ in },
        onSelectionChange: { _ in }
      )
    }
    .frame(width: 840, height: 420)
    .environment(\.colorScheme, colorScheme)
    .environment(CommandHoldObserver())
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

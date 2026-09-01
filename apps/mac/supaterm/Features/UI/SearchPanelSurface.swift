import AppKit
import SwiftUI

public struct SearchPanelItem<ID: Hashable>: Identifiable {
  public let id: ID
  public let title: AttributedString
  public let subtitle: AttributedString?
  public let detail: String?
  public let leadingIcon: String?
  public let badge: String?
  public let shortcut: String?
  public let isEmphasized: Bool
  public let isEnabled: Bool
  public let showsPreview: Bool
  public let children: [SearchPanelItem<ID>]

  public init(
    id: ID,
    title: AttributedString,
    subtitle: AttributedString? = nil,
    detail: String? = nil,
    leadingIcon: String? = nil,
    badge: String? = nil,
    shortcut: String? = nil,
    isEmphasized: Bool = false,
    isEnabled: Bool = true,
    showsPreview: Bool = false,
    children: [SearchPanelItem<ID>] = []
  ) {
    self.id = id
    self.title = title
    self.subtitle = subtitle
    self.detail = detail
    self.leadingIcon = leadingIcon
    self.badge = badge
    self.shortcut = shortcut
    self.isEmphasized = isEmphasized
    self.isEnabled = isEnabled
    self.showsPreview = showsPreview
    self.children = children
  }
}

public struct SearchPanelLayout: Sendable {
  public var width: CGFloat
  public var height: CGFloat
  public var accessoryWidth: CGFloat

  public init(width: CGFloat = 640, height: CGFloat = 272, accessoryWidth: CGFloat = 260) {
    self.width = width
    self.height = height
    self.accessoryWidth = accessoryWidth
  }
}

enum SearchPanelSelection {
  static func normalized<ID: Hashable>(
    _ selection: ID?,
    in items: [SearchPanelItem<ID>]
  ) -> ID? {
    items.first { $0.id == selection && $0.isEnabled }?.id
      ?? items.first(where: \.isEnabled)?.id
  }

  static func moved<ID: Hashable>(
    _ selection: ID?,
    in items: [SearchPanelItem<ID>],
    by delta: Int
  ) -> ID? {
    let enabledItems = items.filter(\.isEnabled)
    guard !enabledItems.isEmpty else { return nil }
    guard let selection, let index = enabledItems.firstIndex(where: { $0.id == selection }) else {
      return delta < 0 ? enabledItems.last?.id : enabledItems.first?.id
    }
    let nextIndex = (index + delta % enabledItems.count + enabledItems.count) % enabledItems.count
    return enabledItems[nextIndex].id
  }
}

public struct SearchPanelSurface<ID: Hashable, Preview: View>: View {
  private let theme: SurfaceTheme
  private let query: Binding<String>
  private let selection: Binding<ID?>
  private let items: [SearchPanelItem<ID>]
  private let prompt: String
  private let emptyMessage: String
  private let accessibilityNamespace: String
  private let layout: SearchPanelLayout
  private let onActivate: (SearchPanelItem<ID>) -> Void
  private let onDismiss: () -> Void
  private let preview: (SearchPanelItem<ID>) -> Preview

  @FocusState private var isQueryFocused: Bool

  @Environment(\.colorScheme) private var colorScheme

  public init(
    theme: SurfaceTheme = .system,
    query: Binding<String>,
    selection: Binding<ID?>,
    items: [SearchPanelItem<ID>],
    prompt: String = "Search…",
    emptyMessage: String = "No matches",
    accessibilityNamespace: String = "search-panel",
    layout: SearchPanelLayout = SearchPanelLayout(),
    onActivate: @escaping (SearchPanelItem<ID>) -> Void,
    onDismiss: @escaping () -> Void,
    @ViewBuilder preview: @escaping (SearchPanelItem<ID>) -> Preview
  ) {
    self.theme = theme
    self.query = query
    self.selection = selection
    self.items = items
    self.prompt = prompt
    self.emptyMessage = emptyMessage
    self.accessibilityNamespace = accessibilityNamespace
    self.layout = layout
    self.onActivate = onActivate
    self.onDismiss = onDismiss
    self.preview = preview
  }

  public var body: some View {
    let colors = theme.colors(for: colorScheme)

    ZStack {
      Button(action: onDismiss) {
        Color.clear
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .contentShape(.rect)
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Close search panel")

      HStack(alignment: .top, spacing: 8) {
        panel(colors: colors)

        if let selectedItem, !selectedItem.children.isEmpty || selectedItem.showsPreview {
          accessory(for: selectedItem, colors: colors)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
    }
    .task {
      await focusQuery()
      normalizeSelection()
    }
    .onChange(of: items.filter(\.isEnabled).map(\.id)) { _, _ in
      normalizeSelection()
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("\(accessibilityNamespace).surface")
  }

  private func panel(colors: SurfaceColors) -> some View {
    PopoverSurface(
      theme: theme,
      style: SurfaceCardStyle(
        background: .material,
        corners: SurfaceCorners(26),
        shadowRadius: 22,
        shadowY: 12
      ),
      contentPadding: 9,
      size: CGSize(width: layout.width, height: layout.height)
    ) {
      VStack(alignment: .leading, spacing: 5) {
        searchField(colors: colors)

        if !items.isEmpty {
          Capsule()
            .fill(colors.divider)
            .frame(height: 0.5)
        }

        results(colors: colors)
      }
    }
  }

  private func searchField(colors: SurfaceColors) -> some View {
    HStack(spacing: 12) {
      Image(systemName: "magnifyingglass")
        .font(.system(size: 13))
        .foregroundStyle(colors.primaryText)
        .frame(width: 13)
        .accessibilityHidden(true)

      TextField(prompt, text: query)
        .textFieldStyle(.plain)
        .font(.system(size: 17, weight: .medium))
        .foregroundStyle(query.wrappedValue.isEmpty ? colors.secondaryText : colors.primaryText)
        .tint(colors.accent)
        .focused($isQueryFocused)
        .onKeyPress(.escape) {
          onDismiss()
          return .handled
        }
        .onKeyPress(.return) {
          activateSelection()
          return .handled
        }
        .onKeyPress(.upArrow) {
          selection.wrappedValue = SearchPanelSelection.moved(selection.wrappedValue, in: items, by: -1)
          return .handled
        }
        .onKeyPress(.downArrow) {
          selection.wrappedValue = SearchPanelSelection.moved(selection.wrappedValue, in: items, by: 1)
          return .handled
        }
        .accessibilityIdentifier("\(accessibilityNamespace).input")

      if !query.wrappedValue.isEmpty {
        Button {
          query.wrappedValue = ""
        } label: {
          Image(systemName: "xmark.circle.fill")
            .foregroundStyle(colors.secondaryText)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Clear search")
      }
    }
    .padding(.vertical, 6)
    .padding(.horizontal, 7)
  }

  private func results(colors: SurfaceColors) -> some View {
    ScrollViewReader { proxy in
      Group {
        if items.isEmpty {
          Text(emptyMessage)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(colors.secondaryText)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        } else {
          ScrollView {
            LazyVStack(alignment: .leading, spacing: 3) {
              ForEach(items) { item in
                SearchPanelRow(
                  item: item,
                  theme: theme,
                  isSelected: selection.wrappedValue == item.id,
                  accessibilityIdentifier: "\(accessibilityNamespace).result-row"
                ) {
                  selection.wrappedValue = item.id
                  onActivate(item)
                }
                .id(item.id)
                .onHover { isHovering in
                  if isHovering, item.isEnabled {
                    selection.wrappedValue = item.id
                  }
                }
              }
            }
          }
        }
      }
      .scrollIndicators(.never)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
      .onChange(of: selection.wrappedValue) { _, selectedID in
        guard let selectedID else { return }
        proxy.scrollTo(selectedID, anchor: .center)
      }
    }
  }

  private func accessory(for item: SearchPanelItem<ID>, colors: SurfaceColors) -> some View {
    PopoverSurface(
      theme: theme,
      style: SurfaceCardStyle(background: .material, corners: SurfaceCorners(16), shadowRadius: 16, shadowY: 8),
      contentPadding: 8
    ) {
      VStack(alignment: .leading, spacing: 8) {
        if !item.children.isEmpty {
          Text("Actions")
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(colors.secondaryText)
            .padding(.horizontal, 8)

          ForEach(item.children) { child in
            SearchPanelRow(
              item: child,
              theme: theme,
              isSelected: false,
              accessibilityIdentifier: "\(accessibilityNamespace).result-row",
              action: { onActivate(child) }
            )
          }
        }

        if !item.children.isEmpty && item.showsPreview {
          Divider()
        }

        if item.showsPreview {
          preview(item)
        }
      }
    }
    .frame(width: layout.accessoryWidth)
    .fixedSize(horizontal: false, vertical: true)
  }

  private var selectedItem: SearchPanelItem<ID>? {
    guard let selectedID = selection.wrappedValue else { return nil }
    return items.first { $0.id == selectedID }
  }

  private func activateSelection() {
    guard let selectedItem, selectedItem.isEnabled else { return }
    onActivate(selectedItem)
  }

  private func normalizeSelection() {
    selection.wrappedValue = SearchPanelSelection.normalized(selection.wrappedValue, in: items)
  }

  private func focusQuery() async {
    isQueryFocused = false
    await Task.yield()
    isQueryFocused = true
    await Task.yield()
    NSApp.sendAction(#selector(NSText.selectAll(_:)), to: nil, from: nil)
  }
}

extension SearchPanelSurface where Preview == EmptyView {
  public init(
    theme: SurfaceTheme = .system,
    query: Binding<String>,
    selection: Binding<ID?>,
    items: [SearchPanelItem<ID>],
    prompt: String = "Search…",
    emptyMessage: String = "No matches",
    accessibilityNamespace: String = "search-panel",
    layout: SearchPanelLayout = SearchPanelLayout(),
    onActivate: @escaping (SearchPanelItem<ID>) -> Void,
    onDismiss: @escaping () -> Void
  ) {
    self.init(
      theme: theme,
      query: query,
      selection: selection,
      items: items,
      prompt: prompt,
      emptyMessage: emptyMessage,
      accessibilityNamespace: accessibilityNamespace,
      layout: layout,
      onActivate: onActivate,
      onDismiss: onDismiss,
      preview: { _ in EmptyView() }
    )
  }
}

private struct SearchPanelRow<ID: Hashable>: View {
  let item: SearchPanelItem<ID>
  let theme: SurfaceTheme
  let isSelected: Bool
  let accessibilityIdentifier: String
  let action: () -> Void

  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    let colors = theme.colors(for: colorScheme)

    Button(action: action) {
      HStack(spacing: 12) {
        if let leadingIcon = item.leadingIcon {
          Image(systemName: leadingIcon)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(isSelected ? colors.selectedText : colors.secondaryText)
            .frame(width: 14, height: 14)
            .accessibilityHidden(true)
        }

        VStack(alignment: .leading, spacing: item.subtitle == nil ? 0 : 2) {
          HStack(spacing: 6) {
            Text(item.title)
              .font(.system(size: 13, weight: .semibold))
              .foregroundStyle(isSelected ? colors.selectedText : colors.primaryText)
              .lineLimit(1)

            if let badge = item.badge {
              Text(badge)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(isSelected ? colors.selectedText : colors.primaryText)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(colors.mutedBackground, in: .capsule)
            }
          }

          if let subtitle = item.subtitle {
            Text(subtitle)
              .font(.system(size: 11, weight: .medium))
              .foregroundStyle(isSelected ? colors.selectedText.opacity(0.72) : colors.secondaryText)
              .lineLimit(1)
          }
        }

        Spacer()

        if !item.children.isEmpty {
          Image(systemName: "chevron.right")
            .font(.system(size: 9, weight: .bold))
            .foregroundStyle(isSelected ? colors.selectedText.opacity(0.72) : colors.secondaryText)
            .accessibilityHidden(true)
        } else if let shortcut = item.shortcut {
          KeyboardShortcutPill(
            shortcut,
            color: isSelected ? colors.selectedText : colors.secondaryText,
            textOpacity: isSelected ? 0.72 : 1
          )
        }
      }
      .padding(.horizontal, 11)
      .padding(.vertical, 9)
      .frame(maxWidth: .infinity)
      .background(rowBackground(colors: colors), in: .rect(cornerRadius: 5))
    }
    .buttonStyle(.plain)
    .disabled(!item.isEnabled)
    .opacity(item.isEnabled ? 1 : 0.5)
    .accessibilityIdentifier(accessibilityIdentifier)
    .accessibilityAddTraits(isSelected ? .isSelected : [])
    .help(item.detail ?? "")
  }

  private func rowBackground(colors: SurfaceColors) -> Color {
    if isSelected { return colors.selectedBackground }
    if item.isEmphasized { return colors.mutedBackground }
    return .clear
  }
}

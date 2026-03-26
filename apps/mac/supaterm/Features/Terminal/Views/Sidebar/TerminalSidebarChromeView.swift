import AppKit
import ComposableArchitecture
import SwiftUI

private let terminalSidebarScrollSpace = "TerminalSidebarScrollSpace"
private let terminalSidebarScrollTopID = "TerminalSidebarScrollTop"
private let terminalSidebarScrollBottomID = "TerminalSidebarScrollBottom"

struct TerminalSidebarMeasuredTabFrame: Equatable {
  let zoneID: TerminalSidebarDropZoneID
  let scrollFrame: CGRect
  let zoneFrame: CGRect
}

extension TerminalSidebarDropZoneID {
  fileprivate var coordinateSpaceID: String {
    switch self {
    case .pinned:
      "TerminalSidebarPinnedZone"
    case .regular:
      "TerminalSidebarRegularZone"
    }
  }
}

private struct TerminalSidebarTabFramePreferenceKey: PreferenceKey {
  static let defaultValue: [TerminalTabID: TerminalSidebarMeasuredTabFrame] = [:]

  static func reduce(
    value: inout [TerminalTabID: TerminalSidebarMeasuredTabFrame],
    nextValue: () -> [TerminalTabID: TerminalSidebarMeasuredTabFrame]
  ) {
    value.merge(nextValue()) { $1 }
  }
}

private struct TerminalSidebarScrollOffsetPreferenceKey: PreferenceKey {
  static let defaultValue: CGFloat = 0

  static func reduce(
    value: inout CGFloat,
    nextValue: () -> CGFloat
  ) {
    value = nextValue()
  }
}

private struct TerminalSidebarContentHeightKey: PreferenceKey {
  static let defaultValue: CGFloat = 0

  static func reduce(
    value: inout CGFloat,
    nextValue: () -> CGFloat
  ) {
    value = nextValue()
  }
}

struct TerminalSidebarChromeView: View {
  let store: StoreOf<TerminalWindowFeature>
  let updateStore: StoreOf<UpdateFeature>
  let palette: TerminalPalette
  let terminal: TerminalHostState

  @Environment(\.colorScheme) private var colorScheme
  @StateObject private var dragSession = TerminalSidebarDragSession()
  @State private var scrollOffset: CGFloat = 0
  @State private var contentHeight: CGFloat = 0
  @State private var tabFrames: [TerminalTabID: TerminalSidebarMeasuredTabFrame] = [:]

  var body: some View {
    VStack(spacing: 10) {
      tabList
      if !updateStore.phase.isIdle {
        TerminalSidebarUpdateSection(
          store: updateStore,
          palette: palette
        )
      }
      TerminalSidebarSpaceBar(
        store: store,
        palette: palette,
        terminal: terminal
      )
    }
    .padding(.horizontal, 8)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .onAppear {
      dragSession.colorScheme = colorScheme
    }
    .onChange(of: colorScheme) { _, newValue in
      dragSession.colorScheme = newValue
    }
    .onChange(of: dragSession.pendingReorder) { _, pendingReorder in
      handle(pendingReorder)
    }
  }

  private var tabList: some View {
    GeometryReader { geometry in
      ScrollViewReader { proxy in
        ZStack {
          ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: 8) {
              Color.clear
                .frame(height: 0)
                .background {
                  GeometryReader { geometry in
                    Color.clear.preference(
                      key: TerminalSidebarScrollOffsetPreferenceKey.self,
                      value: max(0, -geometry.frame(in: .named(terminalSidebarScrollSpace)).minY)
                    )
                  }
                }
                .id(terminalSidebarScrollTopID)

              pinnedSection

              if !terminal.pinnedTabs.isEmpty {
                TerminalSidebarSectionDivider(palette: palette)
              }

              regularSection

              TerminalSidebarRegularSectionHeader(
                palette: palette,
                action: newTab
              )

              Color.clear
                .frame(height: 1)
                .id(terminalSidebarScrollBottomID)
            }
            .background {
              GeometryReader { geometry in
                Color.clear.preference(
                  key: TerminalSidebarContentHeightKey.self,
                  value: geometry.size.height
                )
              }
            }
            .padding(.bottom, 8)
          }
          .coordinateSpace(name: terminalSidebarScrollSpace)
          .onPreferenceChange(TerminalSidebarScrollOffsetPreferenceKey.self) { scrollOffset in
            self.scrollOffset = scrollOffset
          }
          .onPreferenceChange(TerminalSidebarContentHeightKey.self) { contentHeight in
            self.contentHeight = contentHeight
          }
          .onPreferenceChange(TerminalSidebarTabFramePreferenceKey.self) { tabFrames in
            self.tabFrames = tabFrames
            dragSession.updateMeasuredTabFrames(tabFrames)
          }

          if TerminalSidebarLayout.showsTopIndicator(scrollOffset: scrollOffset) {
            TerminalSidebarScrollIndicatorButton(
              symbol: "chevron.up",
              palette: palette
            ) {
              withAnimation(.easeInOut(duration: 0.3)) {
                proxy.scrollTo(terminalSidebarScrollTopID, anchor: .top)
              }
            }
            .frame(maxHeight: .infinity, alignment: .top)
            .padding(.top, 4)
          }

          if TerminalSidebarLayout.showsBottomIndicator(
            scrollOffset: scrollOffset,
            viewportHeight: geometry.size.height,
            contentHeight: contentHeight,
            selectedFrame: selectedTabFrame
          ) {
            TerminalSidebarScrollIndicatorButton(
              symbol: "chevron.down",
              palette: palette
            ) {
              scrollToBottom(using: proxy)
            }
            .frame(maxHeight: .infinity, alignment: .bottom)
            .padding(.bottom, 4)
          }
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  private var pinnedSection: some View {
    TerminalSidebarDropZoneHostView(
      zoneID: .pinned,
      manager: dragSession
    ) {
      VStack(spacing: TerminalSidebarLayout.tabRowSpacing) {
        ForEach(Array(terminal.pinnedTabs.enumerated()), id: \.element.id) { index, tab in
          draggableRow(
            tab: tab,
            index: index,
            zoneID: .pinned
          )
        }
      }
      .coordinateSpace(name: TerminalSidebarDropZoneID.pinned.coordinateSpaceID)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .onAppear {
      dragSession.updateTabIDs(terminal.pinnedTabs.map(\.id), for: .pinned)
    }
    .onChange(of: terminal.pinnedTabs.map(\.id)) { _, tabIDs in
      dragSession.updateTabIDs(tabIDs, for: .pinned)
    }
  }

  private var regularSection: some View {
    TerminalSidebarDropZoneHostView(
      zoneID: .regular,
      manager: dragSession
    ) {
      VStack(spacing: TerminalSidebarLayout.tabRowSpacing) {
        ForEach(Array(terminal.regularTabs.enumerated()), id: \.element.id) { index, tab in
          draggableRow(
            tab: tab,
            index: index,
            zoneID: .regular
          )
        }
      }
      .coordinateSpace(name: TerminalSidebarDropZoneID.regular.coordinateSpaceID)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .onAppear {
      dragSession.updateTabIDs(terminal.regularTabs.map(\.id), for: .regular)
    }
    .onChange(of: terminal.regularTabs.map(\.id)) { _, tabIDs in
      dragSession.updateTabIDs(tabIDs, for: .regular)
    }
  }

  @ViewBuilder
  private func draggableRow(
    tab: TerminalTabItem,
    index: Int,
    zoneID: TerminalSidebarDropZoneID
  ) -> some View {
    let hasFocusedNotificationAttention = terminal.hasFocusedNotificationAttention(for: tab.id)
    let latestNotificationText = terminal.latestNotificationText(for: tab.id)
    let paneWorkingDirectories = terminal.paneWorkingDirectories(for: tab.id)
    let unreadCount = terminal.unreadNotificationCount(for: tab.id)
    let preview = TerminalSidebarDragPreviewItem(
      hasFocusedNotificationAttention: hasFocusedNotificationAttention,
      tab: tab,
      latestNotificationText: latestNotificationText,
      paneWorkingDirectories: paneWorkingDirectories,
      notificationColor: terminal.notificationAttentionColor,
      unreadCount: unreadCount
    )

    TerminalSidebarDragSourceView(
      item: TerminalSidebarDragItem(
        tabID: tab.id
      ),
      preview: preview,
      zoneID: zoneID,
      index: index,
      manager: dragSession
    ) {
      TerminalSidebarTabRow(
        store: store,
        terminal: terminal,
        tab: tab,
        hasFocusedNotificationAttention: hasFocusedNotificationAttention,
        latestNotificationText: latestNotificationText,
        paneWorkingDirectories: paneWorkingDirectories,
        unreadCount: unreadCount,
        palette: palette
      )
      .id(tab.id)
      .background {
        GeometryReader { geometry in
          let measuredFrame = TerminalSidebarMeasuredTabFrame(
            zoneID: zoneID,
            scrollFrame: geometry.frame(in: .named(terminalSidebarScrollSpace)),
            zoneFrame: geometry.frame(in: .named(zoneID.coordinateSpaceID))
          )
          Color.clear.preference(
            key: TerminalSidebarTabFramePreferenceKey.self,
            value: [tab.id: measuredFrame]
          )
        }
      }
      .opacity(dragSession.draggedItem?.tabID == tab.id ? 0 : 1)
      .offset(y: dragSession.reorderOffset(for: zoneID, tabID: tab.id))
      .animation(
        .spring(response: 0.3, dampingFraction: 0.8),
        value: dragSession.insertionIndex[zoneID]
      )
    }
  }

  private var selectedTabFrame: CGRect? {
    guard let selectedTabID = terminal.selectedTabID else { return nil }
    return tabFrames[selectedTabID]?.scrollFrame
  }

  private func newTab() {
    withAnimation(.easeInOut(duration: 0.2)) {
      _ = store.send(
        .newTabButtonTapped(inheritingFromSurfaceID: terminal.selectedSurfaceView?.id)
      )
    }
  }

  private func scrollToBottom(
    using proxy: ScrollViewProxy
  ) {
    withAnimation(.easeInOut(duration: 0.3)) {
      if let selectedTabID = terminal.selectedTabID {
        proxy.scrollTo(selectedTabID, anchor: .bottom)
      } else {
        proxy.scrollTo(terminalSidebarScrollBottomID, anchor: .bottom)
      }
    }
  }

  private func handle(
    _ pendingReorder: TerminalSidebarPendingReorder?
  ) {
    guard let pendingReorder else { return }

    switch (pendingReorder.sourceZone, pendingReorder.targetZone) {
    case (.pinned, .pinned):
      let reorderedIDs = TerminalSidebarLayout.reorderedIDs(
        terminal.pinnedTabs.map(\.id),
        movingFrom: pendingReorder.fromIndex,
        to: pendingReorder.toIndex
      )
      if reorderedIDs != terminal.pinnedTabs.map(\.id) {
        _ = store.send(.pinnedTabOrderChanged(reorderedIDs))
      }

    case (.regular, .regular):
      let reorderedIDs = TerminalSidebarLayout.reorderedIDs(
        terminal.regularTabs.map(\.id),
        movingFrom: pendingReorder.fromIndex,
        to: pendingReorder.toIndex
      )
      if reorderedIDs != terminal.regularTabs.map(\.id) {
        _ = store.send(.regularTabOrderChanged(reorderedIDs))
      }

    case (.regular, .pinned):
      _ = store.send(
        .sidebarTabMoveCommitted(
          tabID: pendingReorder.item.tabID,
          pinnedOrder: TerminalSidebarLayout.insertingID(
            pendingReorder.item.tabID,
            into: terminal.pinnedTabs.map(\.id),
            at: pendingReorder.toIndex
          ),
          regularOrder: TerminalSidebarLayout.removingID(
            pendingReorder.item.tabID,
            from: terminal.regularTabs.map(\.id)
          )
        )
      )

    case (.pinned, .regular):
      _ = store.send(
        .sidebarTabMoveCommitted(
          tabID: pendingReorder.item.tabID,
          pinnedOrder: TerminalSidebarLayout.removingID(
            pendingReorder.item.tabID,
            from: terminal.pinnedTabs.map(\.id)
          ),
          regularOrder: TerminalSidebarLayout.insertingID(
            pendingReorder.item.tabID,
            into: terminal.regularTabs.map(\.id),
            at: pendingReorder.toIndex
          )
        )
      )
    }

    dragSession.pendingReorder = nil
  }
}

struct TerminalSidebarTabSummaryView: View {
  enum LeadingIndicator: Equatable {
    case claudeActivity(TerminalHostState.ClaudeActivity)
    case focusedNotification
    case tabSymbol(String, TerminalTabIconStyle)
    case unreadCount(Int)
  }

  let tab: TerminalTabItem
  let palette: TerminalPalette
  let isSelected: Bool
  let notificationColor: Color
  let hasFocusedNotificationAttention: Bool
  let latestNotificationText: String?
  let paneWorkingDirectories: [String]
  let unreadCount: Int
  let claudeActivity: TerminalHostState.ClaudeActivity?

  static func leadingIndicator(
    hasFocusedNotificationAttention: Bool,
    tab: TerminalTabItem,
    unreadCount: Int,
    claudeActivity: TerminalHostState.ClaudeActivity?
  ) -> LeadingIndicator {
    if unreadCount > 0 {
      return .unreadCount(unreadCount)
    }
    if let claudeActivity, claudeActivity.showsLeadingIndicator {
      return .claudeActivity(claudeActivity)
    }
    if hasFocusedNotificationAttention {
      return .focusedNotification
    }
    return .tabSymbol(tab.symbol, tab.iconStyle)
  }

  static func helpText(
    latestNotificationText: String?,
    paneWorkingDirectories: [String]
  ) -> String? {
    let details =
      [latestNotificationText]
      .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }
      + paneWorkingDirectories

    guard !details.isEmpty else { return nil }
    return details.joined(separator: "\n")
  }

  var body: some View {
    HStack(alignment: .top, spacing: 8) {
      switch Self.leadingIndicator(
        hasFocusedNotificationAttention: hasFocusedNotificationAttention,
        tab: tab,
        unreadCount: unreadCount,
        claudeActivity: claudeActivity
      ) {
      case .unreadCount(let unreadCount):
        Text(unreadCount.formatted())
          .font(.system(size: 9, weight: .bold))
          .foregroundStyle(isSelected ? palette.selectedText : Color.white)
          .padding(.horizontal, unreadCount > 9 ? 6 : 5)
          .frame(minWidth: 16, minHeight: 16)
          .background(
            isSelected ? palette.selectedText.opacity(0.16) : Color.accentColor,
            in: Capsule(style: .continuous)
          )

      case .claudeActivity(let activity):
        TerminalSidebarClaudeActivityView(
          activity: activity,
          isSelected: isSelected,
          palette: palette
        )

      case .focusedNotification:
        TerminalSidebarFocusedNotificationView(
          isSelected: isSelected,
          notificationColor: notificationColor
        )

      case .tabSymbol(let symbol, let style):
        RoundedRectangle(cornerRadius: 5, style: .continuous)
          .fill(symbolFill(for: style))
          .frame(width: 16, height: 16)
          .overlay {
            Image(systemName: symbol)
              .font(.system(size: 9, weight: .semibold))
              .foregroundStyle(symbolForeground(for: style))
              .accessibilityHidden(true)
          }
      }

      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 6) {
          Text(tab.title)
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(isSelected ? palette.selectedText : palette.primaryText)
            .lineLimit(1)
            .truncationMode(.tail)

          Spacer(minLength: 0)
        }

        if let latestNotificationText {
          Text(latestNotificationText)
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(
              isSelected
                ? palette.selectedText.opacity(0.82)
                : palette.secondaryText
            )
            .lineLimit(4)
            .truncationMode(.tail)
            .multilineTextAlignment(.leading)
        }

        ForEach(paneWorkingDirectories, id: \.self) { workingDirectory in
          Text(workingDirectory)
            .font(.system(size: 11, weight: .regular, design: .monospaced))
            .foregroundStyle(
              isSelected
                ? palette.selectedText.opacity(0.72)
                : palette.secondaryText
            )
            .lineLimit(1)
            .truncationMode(.middle)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  private func symbolFill(
    for style: TerminalTabIconStyle
  ) -> Color {
    switch style {
    case .accent(let tone):
      return palette.fill(for: tone)
    case .neutral:
      return isSelected ? palette.selectedText.opacity(0.12) : palette.secondaryText.opacity(0.14)
    }
  }

  private func symbolForeground(
    for style: TerminalTabIconStyle
  ) -> Color {
    switch style {
    case .accent:
      return isSelected ? palette.selectedIcon : palette.primaryText
    case .neutral:
      return isSelected ? palette.selectedText.opacity(0.72) : palette.secondaryText
    }
  }
}

private struct TerminalSidebarFocusedNotificationView: View {
  let isSelected: Bool
  let notificationColor: Color

  var body: some View {
    Circle()
      .strokeBorder(color.opacity(isSelected ? 0.75 : 0.55), lineWidth: 2.25)
      .frame(width: 16, height: 16)
      .overlay {
        Circle()
          .fill(color.opacity(isSelected ? 0.95 : 0.82))
          .frame(width: 4, height: 4)
      }
  }

  private var color: Color {
    notificationColor
  }
}

private struct TerminalSidebarClaudeActivityView: View {
  let activity: TerminalHostState.ClaudeActivity
  let isSelected: Bool
  let palette: TerminalPalette

  @Environment(\.accessibilityReduceMotion) private var accessibilityReduceMotion
  @State private var isAnimating = false

  var body: some View {
    RoundedRectangle(cornerRadius: 5, style: .continuous)
      .fill(backgroundColor)
      .frame(width: 16, height: 16)
      .overlay {
        switch activity {
        case .needsInput:
          Image(systemName: "bell.fill")
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(Color.white)
            .scaleEffect(scale)
            .offset(y: verticalOffset)
            .accessibilityHidden(true)

        case .running:
          runningIndicator

        case .idle:
          EmptyView()
        }
      }
      .onAppear {
        guard !accessibilityReduceMotion else { return }
        if let animation {
          withAnimation(animation) {
            isAnimating = true
          }
        }
      }
      .onChange(of: activity) { _, _ in
        isAnimating = false
        guard !accessibilityReduceMotion else { return }
        if let animation {
          withAnimation(animation) {
            isAnimating = true
          }
        }
      }
      .onChange(of: accessibilityReduceMotion) { _, reduceMotion in
        isAnimating = false
        guard !reduceMotion else { return }
        if let animation {
          withAnimation(animation) {
            isAnimating = true
          }
        }
      }
  }

  private var animation: Animation? {
    switch activity {
    case .needsInput:
      return .easeInOut(duration: 0.65)
        .repeatForever(autoreverses: true)
    case .running:
      return .easeInOut(duration: 0.9)
        .repeatForever(autoreverses: true)
    case .idle:
      return nil
    }
  }

  private var runningIndicator: some View {
    Group {
      if accessibilityReduceMotion {
        runningDots(phase: 0)
      } else {
        TimelineView(.periodic(from: .now, by: 0.24)) { context in
          runningDots(phase: runningPhase(at: context.date))
        }
      }
    }
  }

  private var backgroundColor: Color {
    color(for: activity.tone).opacity(isSelected ? 0.72 : 0.9)
  }

  private var scale: CGFloat {
    switch activity {
    case .needsInput:
      return isAnimating ? 1.14 : 1
    case .running:
      return 1
    case .idle:
      return 1
    }
  }

  private var verticalOffset: CGFloat {
    switch activity {
    case .needsInput:
      return isAnimating ? -1 : 0
    case .running:
      return 0
    case .idle:
      return 0
    }
  }

  private func runningPhase(at date: Date) -> Int {
    Int(date.timeIntervalSinceReferenceDate / 0.24) % 3
  }

  private func runningDots(phase: Int) -> some View {
    HStack(spacing: 2) {
      ForEach(0..<3, id: \.self) { index in
        Circle()
          .fill(Color.white)
          .frame(width: 3, height: 3)
          .scaleEffect(runningDotScale(for: index, phase: phase))
          .opacity(runningDotOpacity(for: index, phase: phase))
      }
    }
    .animation(.smooth(duration: 0.16), value: phase)
    .accessibilityHidden(true)
  }

  private func runningDotScale(for index: Int, phase: Int) -> CGFloat {
    switch (phase - index + 3) % 3 {
    case 0:
      return 1.15
    case 1:
      return 1
    default:
      return 0.82
    }
  }

  private func runningDotOpacity(for index: Int, phase: Int) -> Double {
    switch (phase - index + 3) % 3 {
    case 0:
      return 1
    case 1:
      return 0.62
    default:
      return 0.32
    }
  }

  private func color(for tone: TerminalHostState.ClaudeActivityTone) -> Color {
    switch tone {
    case .attention:
      return palette.attention
    case .active:
      return Color.accentColor
    case .muted:
      return palette.secondaryText
    }
  }
}

private struct TerminalSidebarSectionDivider: View {
  let palette: TerminalPalette

  var body: some View {
    RoundedRectangle(cornerRadius: 100, style: .continuous)
      .fill(palette.secondaryText.opacity(0.14))
      .frame(height: 1)
  }
}

private struct TerminalSidebarRegularSectionHeader: View {
  let palette: TerminalPalette
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 8) {
        Image(systemName: "plus")
          .font(.system(size: 12, weight: .semibold))
          .frame(width: 18, height: 18)
          .foregroundStyle(palette.secondaryText)
          .accessibilityHidden(true)

        Text("New Tab")
          .font(.system(size: 13, weight: .medium))
          .foregroundStyle(palette.primaryText)

        Spacer(minLength: 0)
      }
      .padding(.horizontal, 10)
      .frame(height: 36)
    }
    .buttonStyle(TerminalSidebarRectButtonStyle())
  }
}

struct TerminalSidebarTabRow: View {
  let store: StoreOf<TerminalWindowFeature>
  let terminal: TerminalHostState
  let tab: TerminalTabItem
  let hasFocusedNotificationAttention: Bool
  let latestNotificationText: String?
  let paneWorkingDirectories: [String]
  let unreadCount: Int
  let palette: TerminalPalette

  @State private var isHovering = false
  @State private var isCloseHovering = false

  private var isSelected: Bool {
    terminal.selectedTabID == tab.id
  }

  var body: some View {
    Button(action: select) {
      HStack(spacing: 8) {
        let summary = TerminalSidebarTabSummaryView(
          tab: tab,
          palette: palette,
          isSelected: isSelected,
          notificationColor: terminal.notificationAttentionColor,
          hasFocusedNotificationAttention: hasFocusedNotificationAttention,
          latestNotificationText: latestNotificationText,
          paneWorkingDirectories: paneWorkingDirectories,
          unreadCount: unreadCount,
          claudeActivity: terminal.claudeActivity(for: tab.id)
        )
        if let helpText = TerminalSidebarTabSummaryView.helpText(
          latestNotificationText: latestNotificationText,
          paneWorkingDirectories: paneWorkingDirectories
        ) {
          summary.help(helpText)
        } else {
          summary
        }

        if isHovering {
          Button(action: close) {
            Image(systemName: "xmark")
              .font(.system(size: 12, weight: .heavy))
              .foregroundStyle(isSelected ? palette.selectedText : palette.primaryText)
              .frame(width: 24, height: 24)
              .accessibilityHidden(true)
              .background(
                isCloseHovering
                  ? (isSelected ? palette.clearFill : palette.rowFill)
                  : .clear,
                in: RoundedRectangle(cornerRadius: 6, style: .continuous)
              )
          }
          .buttonStyle(.plain)
          .onHover { isCloseHovering = $0 }
        }
      }
      .padding(.horizontal, TerminalSidebarLayout.tabRowHorizontalPadding)
      .padding(.vertical, TerminalSidebarLayout.tabRowVerticalPadding)
      .frame(minHeight: TerminalSidebarLayout.tabRowMinHeight)
      .frame(maxWidth: .infinity)
      .background(backgroundColor)
      .clipShape(
        RoundedRectangle(cornerRadius: TerminalSidebarLayout.tabRowCornerRadius, style: .continuous)
      )
      .shadow(color: isSelected ? palette.shadow : .clear, radius: isSelected ? 2 : 0, y: 1.5)
      .contentShape(
        RoundedRectangle(cornerRadius: TerminalSidebarLayout.tabRowCornerRadius, style: .continuous)
      )
    }
    .buttonStyle(.plain)
    .overlay(
      TerminalSidebarMiddleClickActionView(action: close)
    )
    .onHover { isHovering in
      withAnimation(.easeInOut(duration: 0.05)) {
        self.isHovering = isHovering
      }
    }
    .contextMenu {
      Button {
        _ = store.send(
          .newTabButtonTapped(inheritingFromSurfaceID: terminal.selectedSurfaceView?.id)
        )
      } label: {
        Label("New Tab", systemImage: "plus")
      }

      Divider()

      Button {
        _ = store.send(.togglePinned(tab.id))
      } label: {
        Label(tab.isPinned ? "Unpin Tab" : "Pin Tab", systemImage: tab.isPinned ? "pin.slash" : "pin")
      }

      Divider()

      Button(role: .destructive) {
        _ = store.send(.closeTabRequested(tab.id))
      } label: {
        Label("Close", systemImage: "xmark")
      }
    }
  }

  private var backgroundColor: Color {
    if isSelected {
      return palette.selectedFill
    }
    if isHovering {
      return palette.rowFill
    }
    return .clear
  }

  private func select() {
    _ = store.send(.tabSelected(tab.id))
  }

  private func close() {
    withAnimation(.easeInOut(duration: 0.15)) {
      _ = store.send(.closeTabRequested(tab.id))
    }
  }
}

private struct TerminalSidebarMiddleClickActionView: NSViewRepresentable {
  let action: () -> Void

  func makeNSView(context: Context) -> TerminalSidebarMiddleClickNSView {
    TerminalSidebarMiddleClickNSView(action: action)
  }

  func updateNSView(_ nsView: TerminalSidebarMiddleClickNSView, context: Context) {
    nsView.action = action
  }
}

private final class TerminalSidebarMiddleClickNSView: NSView {
  var action: () -> Void

  init(action: @escaping () -> Void) {
    self.action = action
    super.init(frame: .zero)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError() }

  override func hitTest(_ point: NSPoint) -> NSView? {
    guard let event = NSApp.currentEvent,
      event.type == .otherMouseDown || event.type == .otherMouseUp
    else { return nil }
    return super.hitTest(point)
  }

  override func otherMouseUp(with event: NSEvent) {
    if event.buttonNumber == 2 {
      action()
    } else {
      super.otherMouseUp(with: event)
    }
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

private struct TerminalSidebarSpaceBar: View {
  let store: StoreOf<TerminalWindowFeature>
  let palette: TerminalPalette
  let terminal: TerminalHostState

  @State private var availableWidth: CGFloat = 0
  @State private var hoveredSpaceID: TerminalSpaceID?
  @State private var showPreview = false
  @State private var isHoveringList = false

  private var layoutMode: TerminalSidebarSpaceBarLayoutMode {
    TerminalSidebarSpaceBarLayoutMode.determine(
      spaceCount: terminal.spaces.count,
      availableWidth: availableWidth
    )
  }

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
      .buttonStyle(TerminalSidebarIconButtonStyle())
      .foregroundStyle(palette.primaryText)
      .accessibilityLabel("Add space")
    }
    .fixedSize(horizontal: false, vertical: true)
    .frame(height: 32)
  }

  private var spaceList: some View {
    Color.clear
      .overlay {
        HStack(spacing: 0) {
          ForEach(Array(terminal.spaces.enumerated()), id: \.element.id) { index, space in
            TerminalSidebarSpaceItemView(
              space: space,
              monogram: TerminalSidebarLayout.spaceMonogram(
                for: space.name,
                fallbackIndex: index
              ),
              isSelected: terminal.selectedSpaceID == space.id,
              compact: layoutMode == .compact,
              palette: palette,
              spacesCount: terminal.spaces.count,
              onHoverChange: { isHovering in
                if isHovering {
                  hoveredSpaceID = space.id
                  if !showPreview {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
                      if hoveredSpaceID == space.id && isHoveringList {
                        withAnimation(.easeInOut(duration: 0.2)) {
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
                withAnimation(.easeOut(duration: 0.1)) {
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
              .transition(.opacity.combined(with: .scale(scale: 0.96)))
              .offset(y: -20)
          }
        }
      }
      .background {
        GeometryReader { geometry in
          Color.clear
            .task(id: geometry.size.width) {
              availableWidth = geometry.size.width
            }
        }
      }
      .frame(maxWidth: .infinity)
  }
}

private struct TerminalSidebarSpaceItemView: View {
  let space: TerminalSpaceItem
  let monogram: String
  let isSelected: Bool
  let compact: Bool
  let palette: TerminalPalette
  let spacesCount: Int
  let onHoverChange: (Bool) -> Void
  let onSelect: () -> Void
  let onRename: () -> Void
  let onDelete: () -> Void

  @State private var isHovering = false

  var body: some View {
    Button(action: onSelect) {
      Group {
        if compact && !isSelected {
          Circle()
            .fill(palette.primaryText)
            .frame(width: 6, height: 6)
        } else {
          Text(monogram)
            .font(.system(size: 12, weight: .semibold, design: .rounded))
        }
      }
      .frame(maxWidth: .infinity)
      .foregroundStyle(palette.primaryText)
      .opacity(isSelected ? 1 : 0.7)
    }
    .buttonStyle(TerminalSidebarSpaceButtonStyle())
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

private struct TerminalSidebarScrollIndicatorButton: View {
  let symbol: String
  let palette: TerminalPalette
  let action: () -> Void

  var body: some View {
    HStack {
      RoundedRectangle(cornerRadius: 100, style: .continuous)
        .fill(palette.secondaryText.opacity(0.14))
        .frame(height: 1)

      Button(action: action) {
        Image(systemName: symbol)
          .font(.system(size: 12, weight: .medium))
          .foregroundStyle(palette.secondaryText)
          .frame(width: 24, height: 24)
          .background(palette.detailBackground.opacity(0.92), in: Circle())
          .accessibilityHidden(true)
          .overlay {
            Circle()
              .stroke(palette.selectionStroke.opacity(0.45), lineWidth: 1)
          }
      }
      .buttonStyle(.plain)
    }
    .padding(.horizontal, 8)
  }
}

private struct TerminalSidebarRectButtonStyle: ButtonStyle {
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.isEnabled) private var isEnabled
  @State private var isHovering = false

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .background {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
          .fill(.primary.opacity(backgroundOpacity(isPressed: configuration.isPressed)))
      }
      .contentShape(.rect)
      .opacity(isEnabled ? 1 : 0.3)
      .scaleEffect(configuration.isPressed && isEnabled ? 0.95 : 1)
      .animation(.easeInOut(duration: 0.1), value: configuration.isPressed)
      .animation(.easeInOut(duration: 0.15), value: isHovering)
      .onHover { isHovering = $0 }
  }

  private func backgroundOpacity(isPressed: Bool) -> Double {
    if (isHovering || isPressed) && isEnabled {
      return colorScheme == .dark ? 0.2 : 0.1
    }
    return 0
  }
}

private struct TerminalSidebarIconButtonStyle: ButtonStyle {
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.isEnabled) private var isEnabled
  @Environment(\.controlSize) private var controlSize
  @State private var isHovering = false

  func makeBody(configuration: Configuration) -> some View {
    ZStack {
      RoundedRectangle(cornerRadius: 8, style: .continuous)
        .fill(Color.primary.opacity(backgroundOpacity(isPressed: configuration.isPressed)))
      configuration.label
    }
    .frame(width: size, height: size)
    .opacity(isEnabled ? 1 : 0.3)
    .contentShape(.rect)
    .scaleEffect(configuration.isPressed && isEnabled ? 0.95 : 1)
    .animation(.easeInOut(duration: 0.1), value: configuration.isPressed)
    .animation(.easeInOut(duration: 0.15), value: isHovering)
    .onHover { isHovering = $0 }
  }

  private var size: CGFloat {
    switch controlSize {
    case .mini: 24
    case .small: 28
    case .regular: 32
    case .large: 40
    case .extraLarge: 48
    @unknown default: 32
    }
  }

  private func backgroundOpacity(isPressed: Bool) -> Double {
    if (isHovering || isPressed) && isEnabled {
      return colorScheme == .dark ? 0.2 : 0.1
    }
    return 0
  }
}

private struct TerminalSidebarSpaceButtonStyle: ButtonStyle {
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.isEnabled) private var isEnabled
  @Environment(\.controlSize) private var controlSize
  @State private var isHovering = false

  func makeBody(configuration: Configuration) -> some View {
    ZStack {
      RoundedRectangle(cornerRadius: 8, style: .continuous)
        .fill(Color.primary.opacity(backgroundOpacity(isPressed: configuration.isPressed)))
      configuration.label
    }
    .frame(height: size)
    .frame(maxWidth: size)
    .opacity(isEnabled ? 1 : 0.3)
    .contentShape(.rect)
    .scaleEffect(configuration.isPressed && isEnabled ? 0.95 : 1)
    .animation(.easeInOut(duration: 0.1), value: configuration.isPressed)
    .animation(.easeInOut(duration: 0.15), value: isHovering)
    .onHover { isHovering = $0 }
  }

  private var size: CGFloat {
    switch controlSize {
    case .mini: 24
    case .small: 28
    case .regular: 32
    case .large: 40
    case .extraLarge: 48
    @unknown default: 32
    }
  }

  private func backgroundOpacity(isPressed: Bool) -> Double {
    if (isHovering || isPressed) && isEnabled {
      return colorScheme == .dark ? 0.2 : 0.1
    }
    return 0
  }
}

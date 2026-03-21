import AppKit
import ComposableArchitecture
import SwiftUI

struct TerminalSplitView: View {
  let store: StoreOf<TerminalSceneFeature>
  let palette: TerminalPalette
  let terminal: TerminalHostState
  let totalWidth: CGFloat
  let isSidebarCollapsed: Bool
  @Binding var sidebarFraction: CGFloat
  let minFraction: CGFloat
  let maxFraction: CGFloat
  let onHide: () -> Void
  let updateStore: StoreOf<UpdateFeature>

  @State private var dragFraction: CGFloat?

  var body: some View {
    let effectiveFraction = TerminalSplitMetrics.clampedFraction(
      dragFraction ?? sidebarFraction,
      minFraction: minFraction,
      maxFraction: maxFraction
    )
    let isCollapsePreviewActive = TerminalSplitMetrics.isCollapsePreviewActive(
      dragFraction: dragFraction,
      minFraction: minFraction
    )
    let handleFraction = TerminalSplitMetrics.handleFraction(
      dragFraction: dragFraction,
      committedFraction: effectiveFraction,
      maxFraction: maxFraction
    )
    let currentSidebarWidth = TerminalSplitMetrics.sidebarWidth(
      for: totalWidth,
      fraction: effectiveFraction
    )
    let handleWidth = TerminalSplitMetrics.sidebarWidth(
      for: totalWidth,
      fraction: handleFraction
    )
    let visualSidebarCollapsed = isSidebarCollapsed || isCollapsePreviewActive
    let visibleSidebarWidth = visualSidebarCollapsed ? 0 : currentSidebarWidth

    ZStack(alignment: .leading) {
      HStack(spacing: 0) {
        TerminalSidebarView(
          store: store,
          palette: palette,
          terminal: terminal,
          updateStore: updateStore
        )
        .frame(width: currentSidebarWidth)
        .frame(maxHeight: .infinity)
        .offset(x: visualSidebarCollapsed ? -(currentSidebarWidth + 12) : 0)
        .frame(width: visibleSidebarWidth, alignment: .leading)
        .clipped()
        .allowsHitTesting(!visualSidebarCollapsed)

        if let selectedTabID = terminal.selectedTabID {
          TerminalDetailView(
            store: store,
            palette: palette,
            terminal: terminal,
            selectedTabID: selectedTabID
          )
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
          Color.clear
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      }

      if !isSidebarCollapsed {
        SidebarResizeHandle(
          totalWidth: totalWidth,
          sidebarFraction: $sidebarFraction,
          dragFraction: $dragFraction,
          minFraction: minFraction,
          maxFraction: maxFraction,
          onHide: onHide
        )
        .offset(x: TerminalSplitMetrics.resizeHandleOffset(for: handleWidth))
      }
    }
    .coordinateSpace(name: TerminalCoordinateSpace.split)
  }
}

struct TerminalSidebarView: View {
  let store: StoreOf<TerminalSceneFeature>
  let palette: TerminalPalette
  let terminal: TerminalHostState
  let updateStore: StoreOf<UpdateFeature>

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      SidebarHeaderView(store: store, palette: palette, updateStore: updateStore)
      SidebarContainerView(store: store, palette: palette, terminal: terminal)
      SidebarFooterView(store: store, palette: palette, terminal: terminal)
    }
    .padding(.horizontal, 10)
    .padding(.top, 8)
    .padding(.bottom, 10)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

private struct SidebarContainerView: View {
  let store: StoreOf<TerminalSceneFeature>
  let palette: TerminalPalette
  let terminal: TerminalHostState

  var body: some View {
    let showsSectionHeaders = !terminal.pinnedTabs.isEmpty

    List(
      selection: Binding(
        get: { terminal.selectedTabID },
        set: {
          guard let tabID = $0 else { return }
          _ = store.send(.tabSelected(tabID))
        }
      )
    ) {
      if showsSectionHeaders {
        Section {
          pinnedTabContent
        } header: {
          sectionHeader("Pinned")
        }
        .transition(Self.sidebarSectionTransition)
      }

      Section {
        regularTabContent
      } header: {
        if showsSectionHeaders {
          sectionHeader("Tabs")
            .transition(Self.sidebarSectionTransition)
        }
      }
    }
    .listStyle(.sidebar)
    .scrollContentBackground(.hidden)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .animation(.spring(response: 0.28, dampingFraction: 0.82), value: showsSectionHeaders)
  }

  private static let sidebarSectionTransition = AnyTransition.opacity
    .combined(with: .offset(y: -6))

  @ViewBuilder
  private var pinnedTabContent: some View {
    ForEach(pinnedTabs, editActions: .move) { tab in
      SidebarTabRow(
        store: store,
        terminal: terminal,
        tab: tab.wrappedValue,
        palette: palette
      )
    }
  }

  @ViewBuilder
  private var regularTabContent: some View {
    ForEach(regularTabs, editActions: .move) { tab in
      SidebarTabRow(
        store: store,
        terminal: terminal,
        tab: tab.wrappedValue,
        palette: palette
      )
    }

    NewTabButton(
      palette: palette,
      action: {
        withAnimation(.spring(response: 0.28, dampingFraction: 0.82)) {
          _ = store.send(
            .newTabButtonTapped(inheritingFromSurfaceID: terminal.selectedSurfaceView?.id)
          )
        }
      }
    )
  }

  private func sectionHeader(_ title: String) -> some View {
    Text(title)
      .font(.system(size: 12, weight: .medium))
      .foregroundStyle(palette.secondaryText)
  }

  private var pinnedTabs: Binding<[TerminalTabItem]> {
    Binding(
      get: { terminal.pinnedTabs },
      set: { _ = store.send(.pinnedTabOrderChanged($0.map(\.id))) }
    )
  }

  private var regularTabs: Binding<[TerminalTabItem]> {
    Binding(
      get: { terminal.regularTabs },
      set: { _ = store.send(.regularTabOrderChanged($0.map(\.id))) }
    )
  }
}

struct FloatingSidebarOverlay: View {
  let store: StoreOf<TerminalSceneFeature>
  let palette: TerminalPalette
  let terminal: TerminalHostState
  let totalWidth: CGFloat
  @Binding var sidebarFraction: CGFloat
  @Binding var isVisible: Bool
  let minFraction: CGFloat
  let maxFraction: CGFloat
  let updateStore: StoreOf<UpdateFeature>

  @State private var dragFraction: CGFloat?

  var body: some View {
    let effectiveFraction = TerminalSplitMetrics.clampedFraction(
      dragFraction ?? sidebarFraction,
      minFraction: minFraction,
      maxFraction: maxFraction
    )
    let floatingWidth = TerminalSplitMetrics.sidebarWidth(
      for: totalWidth,
      fraction: effectiveFraction
    )

    ZStack(alignment: .leading) {
      if isVisible {
        FloatingSidebarView(
          store: store,
          palette: palette,
          terminal: terminal,
          width: floatingWidth,
          updateStore: updateStore
        )
        .frame(width: floatingWidth)
        .transition(.move(edge: .leading))
        .zIndex(1)
      }

      HStack(spacing: 0) {
        hoverStrip(width: isVisible ? floatingWidth : 10)
        Spacer(minLength: 0)
      }

      if isVisible {
        SidebarResizeHandle(
          totalWidth: totalWidth,
          sidebarFraction: $sidebarFraction,
          dragFraction: $dragFraction,
          minFraction: minFraction,
          maxFraction: maxFraction
        )
        .offset(x: TerminalSplitMetrics.resizeHandleOffset(for: floatingWidth))
        .zIndex(2)
      }
    }
    .coordinateSpace(name: TerminalCoordinateSpace.floatingSidebar)
  }

  private func hoverStrip(width: CGFloat) -> some View {
    Color.clear
      .frame(width: width)
      .overlay {
        GlobalMouseTrackingArea(
          mouseEntered: $isVisible,
          edge: .left,
          padding: 40,
          slack: 8
        )
      }
  }
}

private struct SidebarResizeHandle: View {
  let totalWidth: CGFloat
  @Binding var sidebarFraction: CGFloat
  @Binding var dragFraction: CGFloat?
  let minFraction: CGFloat
  let maxFraction: CGFloat
  var onHide: (() -> Void)?

  var body: some View {
    SidebarResizeInteractionView(
      onDragChanged: updateDragFraction(for:),
      onDragEnded: commitDragFraction(for:)
    )
    .frame(width: TerminalSplitMetrics.resizeHandleWidth)
    .frame(maxHeight: .infinity)
  }

  private func updateDragFraction(for locationX: CGFloat) {
    dragFraction = TerminalSplitMetrics.rawFraction(
      for: locationX,
      totalWidth: totalWidth
    )
  }

  private func commitDragFraction(for locationX: CGFloat) {
    let rawFraction = TerminalSplitMetrics.rawFraction(
      for: locationX,
      totalWidth: totalWidth
    )
    if let onHide, rawFraction < minFraction {
      onHide()
    } else {
      sidebarFraction = TerminalSplitMetrics.clampedFraction(
        rawFraction,
        minFraction: minFraction,
        maxFraction: maxFraction
      )
    }
    dragFraction = nil
  }
}

private struct SidebarResizeInteractionView: NSViewRepresentable {
  let onDragChanged: (CGFloat) -> Void
  let onDragEnded: (CGFloat) -> Void

  func makeNSView(context: Context) -> SidebarResizeInteractionNSView {
    let view = SidebarResizeInteractionNSView()
    update(view)
    return view
  }

  func updateNSView(_ nsView: SidebarResizeInteractionNSView, context: Context) {
    update(nsView)
  }

  private func update(_ view: SidebarResizeInteractionNSView) {
    view.onDragChanged = onDragChanged
    view.onDragEnded = onDragEnded
  }
}

private final class SidebarResizeInteractionNSView: NSView {
  var onDragChanged: ((CGFloat) -> Void)?
  var onDragEnded: ((CGFloat) -> Void)?
  private var trackingArea: NSTrackingArea?

  override var mouseDownCanMoveWindow: Bool {
    false
  }

  override func hitTest(_ point: NSPoint) -> NSView? {
    bounds.contains(point) ? self : nil
  }

  override func updateTrackingAreas() {
    if let trackingArea {
      removeTrackingArea(trackingArea)
    }
    let trackingArea = NSTrackingArea(
      rect: bounds,
      options: [.activeAlways, .cursorUpdate, .inVisibleRect],
      owner: self,
      userInfo: nil
    )
    addTrackingArea(trackingArea)
    self.trackingArea = trackingArea
    window?.invalidateCursorRects(for: self)
    super.updateTrackingAreas()
  }

  override func resetCursorRects() {
    discardCursorRects()
    addCursorRect(bounds, cursor: .resizeLeftRight)
  }

  override func cursorUpdate(with event: NSEvent) {
    NSCursor.resizeLeftRight.set()
  }

  override func mouseDown(with event: NSEvent) {
    sendDragChanged(for: event)
  }

  override func mouseDragged(with event: NSEvent) {
    sendDragChanged(for: event)
  }

  override func mouseUp(with event: NSEvent) {
    sendDragEnded(for: event)
  }

  private func sendDragChanged(for event: NSEvent) {
    guard let locationX = locationX(for: event) else { return }
    onDragChanged?(locationX)
  }

  private func sendDragEnded(for event: NSEvent) {
    guard let locationX = locationX(for: event) else { return }
    onDragEnded?(locationX)
  }

  private func locationX(for event: NSEvent) -> CGFloat? {
    guard let contentView = window?.contentView else { return nil }
    return contentView.convert(event.locationInWindow, from: nil).x
  }
}

private struct FloatingSidebarView: View {
  let store: StoreOf<TerminalSceneFeature>
  let palette: TerminalPalette
  let terminal: TerminalHostState
  let width: CGFloat
  let updateStore: StoreOf<UpdateFeature>

  var body: some View {
    TerminalSidebarView(
      store: store,
      palette: palette,
      terminal: terminal,
      updateStore: updateStore
    )
    .frame(width: width)
    .background(palette.windowBackgroundTint)
    .background {
      BlurEffectView(material: .popover, blendingMode: .withinWindow)
    }
    .terminalPaneChrome(palette: palette)
    .shadow(color: palette.shadow, radius: 16, x: 0, y: 6)
  }
}

private struct SidebarHeaderView: View {
  let store: StoreOf<TerminalSceneFeature>
  let palette: TerminalPalette
  let updateStore: StoreOf<UpdateFeature>

  var body: some View {
    HStack(spacing: 0) {
      WindowTrafficLights()

      Spacer(minLength: 0)

      HStack(spacing: 4) {
        ToolbarIconButton(
          symbol: "sidebar.left",
          palette: palette,
          accessibilityLabel: "Hide sidebar",
          action: {
            withAnimation(.spring(response: 0.2, dampingFraction: 1.0)) {
              _ = store.send(.toggleSidebarButtonTapped)
            }
          }
        )
      }
    }
    .overlay(alignment: .leading) {
      UpdatePillView(store: updateStore)
        .padding(.leading, WindowTrafficLightMetrics.pillLeadingPadding)
    }
    .frame(height: 30)
  }
}

private let sidebarRowHorizontalPadding: CGFloat = 8

private struct NewTabButton: View {
  let palette: TerminalPalette
  let action: () -> Void

  @State private var isHovering = false

  var body: some View {
    Button(action: action) {
      HStack(spacing: 10) {
        Image(systemName: "plus")
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(palette.secondaryText)
          .frame(width: 16, height: 16)
          .accessibilityHidden(true)

        Text("New Tab")
          .font(.system(size: 13, weight: .medium))
          .foregroundStyle(palette.primaryText)

        Spacer(minLength: 0)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.vertical, 10)
      .padding(.horizontal, sidebarRowHorizontalPadding)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .onHover { isHovering = $0 }
    .listRowInsets(EdgeInsets(top: 2, leading: 0, bottom: 2, trailing: 0))
    .listRowSeparator(.hidden)
    .listRowBackground(rowBackground.padding(.horizontal, sidebarRowHorizontalPadding))
  }

  @ViewBuilder
  private var rowBackground: some View {
    if isHovering {
      RoundedRectangle(cornerRadius: 10, style: .continuous)
        .fill(palette.rowFill)
    } else {
      Color.clear
    }
  }
}

private struct SidebarTabRow: View {
  let store: StoreOf<TerminalSceneFeature>
  let terminal: TerminalHostState
  let tab: TerminalTabItem
  let palette: TerminalPalette

  @State private var isHovering = false

  private var isSelected: Bool {
    terminal.selectedTabID == tab.id
  }

  var body: some View {
    HStack(spacing: 10) {
      RoundedRectangle(cornerRadius: 5, style: .continuous)
        .fill(palette.fill(for: tab.tone))
        .frame(width: 16, height: 16)
        .overlay {
          Image(systemName: tab.symbol)
            .font(.system(size: 9, weight: .bold))
            .foregroundStyle(isSelected ? palette.selectedIcon : palette.primaryText.opacity(0.9))
            .accessibilityHidden(true)
        }

      Text(tab.title)
        .font(.system(size: 13, weight: isSelected ? .semibold : .regular))
        .foregroundStyle(isSelected ? palette.selectedText : palette.primaryText)
        .lineLimit(1)

      Spacer(minLength: 0)

      if isHovering {
        Button(
          action: {
            withAnimation(.spring(response: 0.28, dampingFraction: 0.82)) {
              _ = store.send(.closeTabRequested(tab.id))
            }
          },
          label: {
            Image(systemName: "xmark")
              .font(.system(size: 10, weight: .bold))
              .foregroundStyle(
                isSelected ? palette.selectedText.opacity(0.9) : palette.secondaryText
              )
              .frame(width: 16, height: 16)
              .accessibilityHidden(true)
          }
        )
        .buttonStyle(.plain)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.vertical, 10)
    .padding(.horizontal, sidebarRowHorizontalPadding)
    .tag(tab.id)
    .listRowInsets(EdgeInsets(top: 2, leading: 0, bottom: 2, trailing: 0))
    .listRowSeparator(.hidden)
    .listRowBackground(rowBackground.padding(.horizontal, sidebarRowHorizontalPadding))
    .onHover { isHovering = $0 }
    .contextMenu {
      Button("New Tab") {
        withAnimation(.spring(response: 0.28, dampingFraction: 0.82)) {
          _ = store.send(
            .newTabButtonTapped(inheritingFromSurfaceID: terminal.selectedSurfaceView?.id)
          )
        }
      }

      Button(tab.isPinned ? "Unpin Tab" : "Pin Tab") {
        withAnimation(.spring(response: 0.28, dampingFraction: 0.82)) {
          _ = store.send(.togglePinned(tab.id))
        }
      }

      Button("Close Tab", role: .destructive) {
        withAnimation(.spring(response: 0.28, dampingFraction: 0.82)) {
          _ = store.send(.closeTabRequested(tab.id))
        }
      }
    }
  }

  @ViewBuilder
  private var rowBackground: some View {
    if isSelected {
      RoundedRectangle(cornerRadius: 10, style: .continuous)
        .fill(palette.selectedFill)
        .overlay {
          RoundedRectangle(cornerRadius: 10, style: .continuous)
            .stroke(palette.selectionStroke, lineWidth: 1)
        }
    } else if isHovering {
      RoundedRectangle(cornerRadius: 10, style: .continuous)
        .fill(palette.rowFill)
    } else {
      Color.clear
    }
  }
}

private struct SidebarFooterView: View {
  let store: StoreOf<TerminalSceneFeature>
  let palette: TerminalPalette
  let terminal: TerminalHostState

  var body: some View {
    HStack {
      if terminal.workspaces.count > 1 {
        Spacer(minLength: 0)

        HStack(spacing: 4) {
          ForEach(terminal.workspaces) { workspace in
            WorkspaceChipButton(
              store: store,
              palette: palette,
              terminal: terminal,
              workspace: workspace
            )
          }
        }

        Spacer(minLength: 16)
      } else {
        Spacer()
      }

      FooterCircleButton(
        symbol: "plus",
        palette: palette,
        accessibilityLabel: "Add workspace",
        action: {
          _ = store.send(.workspaceCreateButtonTapped)
        }
      )
    }
    .frame(height: 30)
  }
}

private struct WorkspaceChipButton: View {
  let store: StoreOf<TerminalSceneFeature>
  let palette: TerminalPalette
  let terminal: TerminalHostState
  let workspace: TerminalWorkspaceItem

  private var isSelected: Bool {
    terminal.selectedWorkspaceID == workspace.id
  }

  var body: some View {
    Button(
      action: {
        _ = store.send(.selectWorkspaceButtonTapped(workspace.id))
      },
      label: {
        Text(workspace.name)
          .font(.system(size: 11, weight: .semibold, design: .rounded))
          .foregroundStyle(isSelected ? palette.selectedText : palette.secondaryText)
          .lineLimit(1)
          .padding(.horizontal, 10)
          .frame(minWidth: 28, minHeight: 28)
          .background(
            isSelected ? palette.selectedFill : palette.clearFill,
            in: .rect(cornerRadius: 8)
          )
      }
    )
    .buttonStyle(.plain)
    .contextMenu {
      Button("Rename Workspace") {
        _ = store.send(.workspaceRenameRequested(workspace))
      }

      Button("Delete Workspace", role: .destructive) {
        _ = store.send(.workspaceDeleteRequested(workspace))
      }
      .disabled(terminal.workspaces.count <= 1)
    }
    .accessibilityLabel("Workspace \(workspace.name)")
  }
}

private struct FooterCircleButton: View {
  let symbol: String
  let palette: TerminalPalette
  let accessibilityLabel: String
  let action: () -> Void

  var body: some View {
    Button(
      action: action,
      label: {
        Image(systemName: symbol)
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(palette.secondaryText)
          .frame(width: 28, height: 28)
          .background(palette.rowFill, in: Circle())
          .accessibilityHidden(true)
      }
    )
    .buttonStyle(.plain)
    .accessibilityLabel(accessibilityLabel)
  }
}

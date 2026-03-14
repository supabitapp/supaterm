import AppKit
import ComposableArchitecture
import SwiftUI

struct TerminalView: View {
  let store: StoreOf<AppFeature>
  @Bindable var terminal: TerminalHostState

  @State private var isSidebarCollapsed = false
  @State private var isFloatingSidebarVisible = false
  @State private var sidebarFraction: CGFloat = 0.22
  @State private var isShowingQuitConfirmation = false
  @State private var window: NSWindow?

  private let minSidebarFraction: CGFloat = 0.16
  private let maxSidebarFraction: CGFloat = 0.32

  private var updateStore: StoreOf<UpdateFeature> {
    store.scope(state: \.update, action: \.update)
  }

  private var updatePresentationContext: UpdatePresentationContext {
    UpdatePresentationContext(
      isFloatingSidebarVisible: isFloatingSidebarVisible,
      isSidebarCollapsed: isSidebarCollapsed
    )
  }

  var body: some View {
    GeometryReader { geometry in
      ZStack(alignment: .leading) {
        TerminalMainSplitView(
          terminal: terminal,
          totalWidth: geometry.size.width,
          isSidebarCollapsed: isSidebarCollapsed,
          sidebarFraction: $sidebarFraction,
          minFraction: minSidebarFraction,
          maxFraction: maxSidebarFraction,
          onToggleSidebar: toggleSidebar,
          onHideSidebar: collapseSidebar,
          updateStore: updateStore
        )

        if isSidebarCollapsed {
          FloatingSidebarOverlay(
            terminal: terminal,
            totalWidth: geometry.size.width,
            sidebarFraction: $sidebarFraction,
            isVisible: $isFloatingSidebarVisible,
            minFraction: minSidebarFraction,
            maxFraction: maxSidebarFraction,
            updateStore: updateStore
          )
        }
      }
    }
    .frame(minWidth: 1_080, minHeight: 720)
    .background(Color(nsColor: .windowBackgroundColor))
    .background {
      BlurEffectView(material: .underWindowBackground, blendingMode: .behindWindow)
        .ignoresSafeArea()
    }
    .background(WindowReader(window: $window))
    .background(
      WindowFocusObserverView { activity in
        terminal.updateWindowActivity(activity)
      }
    )
    .ignoresSafeArea()
    .task(id: updatePresentationContext) {
      updateStore.send(.presentationContextChanged(updatePresentationContext))
    }
    .task {
      terminal.ensureInitialTab(focusing: false)
      terminal.updateWindowActivity(resolvedWindowActivity)
    }
    .onChange(of: terminal.selectedTabID) { _, _ in
      terminal.updateWindowActivity(resolvedWindowActivity)
    }
    .onReceive(NotificationCenter.default.publisher(for: .toggleSidebar)) { _ in
      toggleSidebar()
    }
    .onReceive(NotificationCenter.default.publisher(for: .quitRequested)) { notification in
      guard let targetWindow = notification.object as? NSWindow else { return }
      guard targetWindow === (window ?? NSApp.keyWindow) else { return }
      if updateStore.phase.bypassesQuitConfirmation {
        NSApp.reply(toApplicationShouldTerminate: true)
        return
      }
      isShowingQuitConfirmation = true
    }
    .alert("Quit Supaterm?", isPresented: $isShowingQuitConfirmation) {
      Button("Cancel", role: .cancel) {
        NSApp.reply(toApplicationShouldTerminate: false)
      }
      Button("Quit", role: .destructive) {
        NSApp.reply(toApplicationShouldTerminate: true)
      }
    } message: {
      Text("Are you sure you want to quit?")
    }
    .alert(
      terminal.pendingCloseRequest?.title ?? "Close?",
      isPresented: Binding(
        get: { terminal.pendingCloseRequest != nil },
        set: { if !$0 { terminal.cancelPendingClose() } }
      )
    ) {
      Button("Cancel", role: .cancel) {
        terminal.cancelPendingClose()
      }
      Button("Close", role: .destructive) {
        terminal.confirmPendingClose()
      }
    } message: {
      Text(terminal.pendingCloseRequest?.message ?? "")
    }
    .animation(.spring(response: 0.2, dampingFraction: 1.0), value: isSidebarCollapsed)
    .animation(.easeOut(duration: 0.12), value: isFloatingSidebarVisible)
    .animation(.spring(response: 0.28, dampingFraction: 0.82), value: terminal.tabs.map(\.id))
  }

  private var resolvedWindowActivity: WindowActivityState {
    if let keyWindow = NSApp.keyWindow {
      return WindowActivityState(
        isKeyWindow: keyWindow.isKeyWindow,
        isVisible: keyWindow.occlusionState.contains(.visible)
      )
    }
    return .inactive
  }

  private func toggleSidebar() {
    isFloatingSidebarVisible = false
    withAnimation(.spring(response: 0.2, dampingFraction: 1.0)) {
      isSidebarCollapsed.toggle()
    }
  }

  private func collapseSidebar() {
    isFloatingSidebarVisible = false
    withAnimation(.spring(response: 0.2, dampingFraction: 1.0)) {
      isSidebarCollapsed = true
    }
  }
}

enum TerminalSplitMetrics {
  static let resizeHandleWidth: CGFloat = 14

  static func rawFraction(for locationX: CGFloat, totalWidth: CGFloat) -> CGFloat {
    guard totalWidth > 0 else { return 0 }
    return Swift.max(0, Swift.min(locationX / totalWidth, 1))
  }

  static func clampedFraction(
    _ fraction: CGFloat,
    minFraction: CGFloat,
    maxFraction: CGFloat
  ) -> CGFloat {
    Swift.min(Swift.max(fraction, minFraction), maxFraction)
  }

  static func handleFraction(
    dragFraction: CGFloat?,
    committedFraction: CGFloat,
    maxFraction: CGFloat
  ) -> CGFloat {
    guard let dragFraction else { return committedFraction }
    return Swift.max(0, Swift.min(dragFraction, maxFraction))
  }

  static func isCollapsePreviewActive(dragFraction: CGFloat?, minFraction: CGFloat) -> Bool {
    guard let dragFraction else { return false }
    return dragFraction < minFraction
  }

  static func sidebarWidth(for totalWidth: CGFloat, fraction: CGFloat) -> CGFloat {
    let boundedWidth = Swift.max(totalWidth, 0)
    return Swift.max(0, Swift.min(boundedWidth * fraction, boundedWidth))
  }

  static func resizeHandleOffset(for sidebarWidth: CGFloat) -> CGFloat {
    Swift.max(0, sidebarWidth - (resizeHandleWidth / 2))
  }
}

private enum TerminalCoordinateSpace {
  static let split = "SupatermSplit"
  static let floatingSidebar = "SupatermFloatingSidebar"
}

private struct TerminalMainSplitView: View {
  let terminal: TerminalHostState
  let totalWidth: CGFloat
  let isSidebarCollapsed: Bool
  @Binding var sidebarFraction: CGFloat
  let minFraction: CGFloat
  let maxFraction: CGFloat
  let onToggleSidebar: () -> Void
  let onHideSidebar: () -> Void
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
        TerminalSidebarView(terminal: terminal, updateStore: updateStore)
          .frame(width: currentSidebarWidth)
          .frame(maxHeight: .infinity)
          .offset(x: visualSidebarCollapsed ? -(currentSidebarWidth + 12) : 0)
          .frame(width: visibleSidebarWidth, alignment: .leading)
          .clipped()
          .allowsHitTesting(!visualSidebarCollapsed)

        TerminalDetailView(
          terminal: terminal,
          isSidebarCollapsed: visualSidebarCollapsed,
          onToggleSidebar: onToggleSidebar
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      }

      if !isSidebarCollapsed {
        SidebarResizeHandle(
          coordinateSpaceName: TerminalCoordinateSpace.split,
          totalWidth: totalWidth,
          sidebarFraction: $sidebarFraction,
          dragFraction: $dragFraction,
          minFraction: minFraction,
          maxFraction: maxFraction,
          onHide: onHideSidebar
        )
        .offset(x: TerminalSplitMetrics.resizeHandleOffset(for: handleWidth))
      }
    }
    .coordinateSpace(name: TerminalCoordinateSpace.split)
  }
}

private struct FloatingSidebarOverlay: View {
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
          coordinateSpaceName: TerminalCoordinateSpace.floatingSidebar,
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
  let coordinateSpaceName: String
  let totalWidth: CGFloat
  @Binding var sidebarFraction: CGFloat
  @Binding var dragFraction: CGFloat?
  let minFraction: CGFloat
  let maxFraction: CGFloat
  var onHide: (() -> Void)?

  var body: some View {
    Rectangle()
      .fill(Color.clear)
      .frame(width: TerminalSplitMetrics.resizeHandleWidth)
      .contentShape(Rectangle())
      .onHover { hovering in
        if hovering {
          NSCursor.resizeLeftRight.push()
        } else {
          NSCursor.pop()
        }
      }
      .gesture(
        DragGesture(minimumDistance: 0, coordinateSpace: .named(coordinateSpaceName))
          .onChanged { value in
            dragFraction = TerminalSplitMetrics.rawFraction(
              for: value.location.x,
              totalWidth: totalWidth
            )
          }
          .onEnded { value in
            let rawFraction = TerminalSplitMetrics.rawFraction(
              for: value.location.x,
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
      )
  }
}

private struct FloatingSidebarView: View {
  let terminal: TerminalHostState
  let width: CGFloat
  let updateStore: StoreOf<UpdateFeature>

  var body: some View {
    TerminalSidebarView(terminal: terminal, updateStore: updateStore)
      .frame(width: width)
      .background(.regularMaterial)
      .clipShape(.rect(cornerRadius: 16))
      .overlay {
        RoundedRectangle(cornerRadius: 16, style: .continuous)
          .stroke(Color.primary.opacity(0.12), lineWidth: 1)
      }
      .shadow(color: .black.opacity(0.12), radius: 16, x: 0, y: 6)
      .padding(6)
  }
}

private struct TerminalSidebarView: View {
  let terminal: TerminalHostState
  let updateStore: StoreOf<UpdateFeature>

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      SidebarHeaderView(terminal: terminal, updateStore: updateStore)

      ScrollView {
        LazyVStack(spacing: 6) {
          ForEach(terminal.tabs) { tab in
            SidebarTabRow(terminal: terminal, tab: tab)
          }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
      }

      NewTabButton {
        _ = terminal.createTab()
      }
      .padding(.horizontal, 8)
      .padding(.bottom, 8)
    }
    .padding(.horizontal, 10)
    .padding(.top, 8)
    .padding(.bottom, 10)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

private struct SidebarHeaderView: View {
  let terminal: TerminalHostState
  let updateStore: StoreOf<UpdateFeature>

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 0) {
        WindowTrafficLights()
        Spacer(minLength: 0)
        HStack(spacing: 4) {
          ToolbarIconButton(
            symbol: "plus",
            accessibilityLabel: "New tab",
            action: { _ = terminal.createTab() }
          )
          ToolbarIconButton(
            symbol: "rectangle.split.2x1",
            accessibilityLabel: "Split below",
            action: { _ = terminal.performBindingActionOnFocusedSurface("new_split:down") }
          )
          .disabled(terminal.selectedTabID == nil)
          ToolbarIconButton(
            symbol: "rectangle.split.1x2",
            accessibilityLabel: "Split right",
            action: { _ = terminal.performBindingActionOnFocusedSurface("new_split:right") }
          )
          .disabled(terminal.selectedTabID == nil)
        }
      }

      HStack(spacing: 8) {
        Text("Terminals")
          .font(.system(size: 13, weight: .semibold))
        Spacer(minLength: 0)
        UpdatePillView(store: updateStore)
      }
      .padding(.horizontal, 8)
    }
    .frame(height: 58)
  }
}

private struct NewTabButton: View {
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 10) {
        Image(systemName: "plus")
          .font(.system(size: 12, weight: .semibold))
          .frame(width: 16, height: 16)
          .accessibilityHidden(true)

        Text("New Terminal")
          .font(.system(size: 13, weight: .medium))

        Spacer(minLength: 0)
      }
      .padding(.vertical, 10)
      .padding(.horizontal, 10)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Color.primary.opacity(0.06), in: .rect(cornerRadius: 10))
    }
    .buttonStyle(.plain)
  }
}

private struct SidebarTabRow: View {
  let terminal: TerminalHostState
  let tab: TerminalTabItem

  @State private var isHovering = false

  private var isSelected: Bool {
    terminal.selectedTabID == tab.id
  }

  var body: some View {
    Button {
      terminal.selectTab(tab.id)
    } label: {
      HStack(spacing: 10) {
        Image(systemName: tab.icon ?? "terminal")
          .font(.system(size: 12, weight: .semibold))
          .frame(width: 16, height: 16)
          .foregroundStyle(isSelected ? Color.white : .secondary)
          .accessibilityHidden(true)

        VStack(alignment: .leading, spacing: 2) {
          Text(tab.title)
            .font(.system(size: 13, weight: isSelected ? .semibold : .medium))
            .lineLimit(1)

          if let state = terminal.focusedSurfaceState(for: tab.id) {
            TerminalTabSubtitle(state: state)
          }
        }

        Spacer(minLength: 0)

        let indicators = terminal.indicators(for: tab.id)
        if let state = terminal.focusedSurfaceState(for: tab.id) {
          TerminalTabBadges(state: state, indicators: indicators)
        } else if indicators.isRunning {
          TerminalRunningDot()
        }

        if isHovering {
          Button {
            terminal.requestCloseTab(tab.id)
          } label: {
            Image(systemName: "xmark")
              .font(.system(size: 10, weight: .bold))
              .frame(width: 16, height: 16)
          }
          .buttonStyle(.plain)
          .accessibilityLabel("Close tab")
        }
      }
      .padding(.vertical, 10)
      .padding(.horizontal, 10)
      .foregroundStyle(isSelected ? Color.white : Color.primary)
      .background(rowBackground, in: .rect(cornerRadius: 10))
      .overlay(alignment: .leading) {
        if isSelected {
          RoundedRectangle(cornerRadius: 2, style: .continuous)
            .fill(Color.white.opacity(0.95))
            .frame(width: 3, height: 20)
            .padding(.leading, 4)
        }
      }
    }
    .buttonStyle(.plain)
    .onHover { isHovering = $0 }
    .contextMenu {
      Button("New Tab") {
        _ = terminal.createTab()
      }
      Button("Close Tab", role: .destructive) {
        terminal.requestCloseTab(tab.id)
      }
    }
  }

  private var rowBackground: some ShapeStyle {
    if isSelected {
      return AnyShapeStyle(.tint)
    }
    if isHovering {
      return AnyShapeStyle(Color.primary.opacity(0.08))
    }
    return AnyShapeStyle(Color.clear)
  }
}

private struct TerminalRunningDot: View {
  var body: some View {
    Circle()
      .fill(Color.accentColor)
      .frame(width: 8, height: 8)
      .accessibilityHidden(true)
  }
}

private struct TerminalTabSubtitle: View {
  @Bindable var state: GhosttySurfaceState

  init(state: GhosttySurfaceState) {
    self._state = Bindable(state)
  }

  var body: some View {
    if let pwd = trimmed(state.pwd), !pwd.isEmpty {
      Text(pwd)
        .font(.system(size: 11, weight: .medium))
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }
  }

  private func trimmed(_ value: String?) -> String? {
    value?.trimmingCharacters(in: .whitespacesAndNewlines)
  }
}

private struct TerminalTabBadges: View {
  @Bindable var state: GhosttySurfaceState
  let indicators: TerminalHostState.TabIndicators

  init(state: GhosttySurfaceState, indicators: TerminalHostState.TabIndicators) {
    self._state = Bindable(state)
    self.indicators = indicators
  }

  var body: some View {
    HStack(spacing: 4) {
      if indicators.isRunning {
        TerminalRunningDot()
      }
      if indicators.hasBell {
        StatusBadge(label: "Bell")
      }
      if indicators.isReadOnly {
        StatusBadge(label: "RO")
      }
      if indicators.hasSecureInput {
        StatusBadge(label: "Key")
      }
    }
  }
}

private struct StatusBadge: View {
  let label: String

  var body: some View {
    Text(label)
      .font(.system(size: 9, weight: .bold, design: .rounded))
      .padding(.horizontal, 5)
      .padding(.vertical, 2)
      .background(Color.primary.opacity(0.08), in: Capsule())
  }
}

private struct TerminalDetailView: View {
  let terminal: TerminalHostState
  let isSidebarCollapsed: Bool
  let onToggleSidebar: () -> Void

  var body: some View {
    VStack(spacing: 0) {
      DetailToolbarView(
        terminal: terminal,
        isSidebarCollapsed: isSidebarCollapsed,
        onToggleSidebar: onToggleSidebar
      )

      ZStack {
        if let selectedTabID = terminal.selectedTabID,
          terminal.tabs.contains(where: { $0.id == selectedTabID })
        {
          TerminalTabContentStack(tabs: terminal.tabs, selectedTabId: selectedTabID) { tabID in
            TerminalSplitTreeAXContainer(tree: terminal.splitTree(for: tabID)) { operation in
              terminal.performSplitOperation(operation, in: tabID)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
          }
        } else {
          EmptyTerminalPaneView()
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .padding(8)
    }
    .background(.ultraThinMaterial, in: .rect(cornerRadius: 20))
    .overlay {
      RoundedRectangle(cornerRadius: 20, style: .continuous)
        .stroke(Color.primary.opacity(0.12), lineWidth: 1)
    }
    .shadow(color: .black.opacity(0.12), radius: 16, x: 0, y: 6)
    .padding(.top, 6)
    .padding(.leading, isSidebarCollapsed ? 6 : 0)
    .padding(.trailing, 6)
    .padding(.bottom, 6)
  }
}

private struct DetailToolbarView: View {
  let terminal: TerminalHostState
  let isSidebarCollapsed: Bool
  let onToggleSidebar: () -> Void

  private var selectedTab: TerminalTabItem? {
    guard let selectedTabID = terminal.selectedTabID else { return nil }
    return terminal.tabs.first(where: { $0.id == selectedTabID })
  }

  private var selectedState: GhosttySurfaceState? {
    guard let selectedTabID = terminal.selectedTabID else { return nil }
    return terminal.focusedSurfaceState(for: selectedTabID)
  }

  var body: some View {
    HStack(spacing: 8) {
      ToolbarIconButton(
        symbol: "sidebar.left",
        accessibilityLabel: isSidebarCollapsed ? "Show sidebar" : "Hide sidebar",
        action: onToggleSidebar
      )

      if let selectedTab {
        HStack(spacing: 8) {
          Image(systemName: selectedTab.icon ?? "terminal")
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(.secondary)
            .accessibilityHidden(true)

          VStack(alignment: .leading, spacing: 2) {
            Text(selectedTab.title)
              .font(.system(size: 13, weight: .semibold))

            if let state = selectedState {
              TerminalToolbarSubtitle(state: state)
            }
          }

          Spacer(minLength: 0)

          if let state = selectedState {
            TerminalToolbarBadges(
              state: state,
              indicators: terminal.indicators(for: selectedTab.id)
            )
          }
        }
        .padding(.horizontal, 10)
        .frame(height: 34)
        .background(Color.primary.opacity(0.06), in: .rect(cornerRadius: 10))
      } else {
        Spacer(minLength: 0)
      }

      ToolbarIconButton(
        symbol: "rectangle.split.2x1",
        accessibilityLabel: "Split below",
        action: { _ = terminal.performBindingActionOnFocusedSurface("new_split:down") }
      )
      .disabled(terminal.selectedTabID == nil)

      ToolbarIconButton(
        symbol: "rectangle.split.1x2",
        accessibilityLabel: "Split right",
        action: { _ = terminal.performBindingActionOnFocusedSurface("new_split:right") }
      )
      .disabled(terminal.selectedTabID == nil)

      ToolbarIconButton(
        symbol: "magnifyingglass",
        accessibilityLabel: "Search",
        action: {
          _ = terminal.startSearch()
        }
      )
      .disabled(terminal.selectedTabID == nil)
    }
    .padding(8)
  }
}

private struct TerminalToolbarSubtitle: View {
  @Bindable var state: GhosttySurfaceState

  init(state: GhosttySurfaceState) {
    self._state = Bindable(state)
  }

  var body: some View {
    if let pwd = trimmed(state.pwd), !pwd.isEmpty {
      Text(pwd)
        .font(.system(size: 11, weight: .medium))
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }
  }

  private func trimmed(_ value: String?) -> String? {
    value?.trimmingCharacters(in: .whitespacesAndNewlines)
  }
}

private struct TerminalToolbarBadges: View {
  @Bindable var state: GhosttySurfaceState
  let indicators: TerminalHostState.TabIndicators

  init(state: GhosttySurfaceState, indicators: TerminalHostState.TabIndicators) {
    self._state = Bindable(state)
    self.indicators = indicators
  }

  var body: some View {
    HStack(spacing: 6) {
      if indicators.isRunning {
        StatusBadge(label: "Running")
      }
      if indicators.isReadOnly {
        StatusBadge(label: "Read Only")
      }
      if indicators.hasSecureInput {
        StatusBadge(label: "Secure Input")
      }
      if indicators.hasBell {
        StatusBadge(label: "Bell")
      }
    }
  }
}

private struct EmptyTerminalPaneView: View {
  var body: some View {
    ContentUnavailableView(
      "No Terminal",
      systemImage: "terminal",
      description: Text("Create a new terminal tab to begin.")
    )
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

private struct ToolbarIconButton: View {
  let symbol: String
  let accessibilityLabel: String
  let action: () -> Void

  @State private var isHovering = false

  var body: some View {
    Button(action: action) {
      Image(systemName: symbol)
        .font(.system(size: 14, weight: .medium))
        .foregroundStyle(.secondary)
        .frame(width: 30, height: 30)
        .background(isHovering ? Color.primary.opacity(0.08) : .clear, in: .rect(cornerRadius: 8))
        .accessibilityHidden(true)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(accessibilityLabel)
    .onHover { isHovering = $0 }
  }
}

private struct WindowTrafficLights: View {
  @State private var isHovering = false

  var body: some View {
    HStack(spacing: 8) {
      ForEach(TrafficLight.allCases, id: \.self) { light in
        Button {
          light.perform()
        } label: {
          Circle()
            .fill(light.color)
            .frame(width: 12, height: 12)
            .overlay {
              if isHovering {
                Image(systemName: light.symbol)
                  .font(.system(size: 7, weight: .black))
                  .foregroundStyle(Color.black.opacity(0.6))
                  .accessibilityHidden(true)
              }
            }
        }
        .buttonStyle(.plain)
      }
    }
    .padding(.leading, 8)
    .onHover { isHovering = $0 }
  }
}

private enum TrafficLight: CaseIterable {
  case close
  case minimize
  case zoom

  var color: Color {
    switch self {
    case .close:
      Color(red: 1, green: 0.37, blue: 0.32)
    case .minimize:
      Color(red: 1, green: 0.74, blue: 0.18)
    case .zoom:
      Color(red: 0.17, green: 0.8, blue: 0.31)
    }
  }

  var symbol: String {
    switch self {
    case .close:
      "xmark"
    case .minimize:
      "minus"
    case .zoom:
      "plus"
    }
  }

  func perform() {
    guard let window = NSApp.keyWindow else { return }
    switch self {
    case .close:
      window.performClose(nil)
    case .minimize:
      window.performMiniaturize(nil)
    case .zoom:
      window.performZoom(nil)
    }
  }
}

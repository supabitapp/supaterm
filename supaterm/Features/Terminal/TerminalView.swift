import AppKit
import ComposableArchitecture
import SwiftUI

struct TerminalView: View {
  let store: StoreOf<TerminalSceneFeature>
  @Bindable var terminal: TerminalHostState
  let updateStore: StoreOf<UpdateFeature>
  @Environment(\.colorScheme) private var colorScheme

  @State private var window: NSWindow?

  private let minSidebarFraction: CGFloat = 0.16
  private let maxSidebarFraction: CGFloat = 0.30

  private var palette: TerminalPalette {
    TerminalPalette(colorScheme: colorScheme)
  }

  private var updatePresentationContext: UpdatePresentationContext {
    UpdatePresentationContext(
      isFloatingSidebarVisible: store.isFloatingSidebarVisible,
      isSidebarCollapsed: store.isSidebarCollapsed
    )
  }

  private var pendingCloseBinding: Binding<Bool> {
    Binding(
      get: { store.pendingCloseRequest != nil },
      set: {
        if !$0 {
          _ = store.send(.closeConfirmationCancelButtonTapped)
        }
      }
    )
  }

  private var sidebarFractionBinding: Binding<CGFloat> {
    Binding(
      get: { store.sidebarFraction },
      set: { _ = store.send(.sidebarFractionChanged($0)) }
    )
  }

  private var floatingSidebarVisibilityBinding: Binding<Bool> {
    Binding(
      get: { store.isFloatingSidebarVisible },
      set: { _ = store.send(.floatingSidebarVisibilityChanged($0)) }
    )
  }

  var body: some View {
    GeometryReader(content: terminalLayout)
      .frame(minWidth: 1_080, minHeight: 720)
      .background(palette.windowBackgroundTint)
      .background {
        BlurEffectView(material: .underWindowBackground, blendingMode: .behindWindow)
          .ignoresSafeArea()
      }
      .overlay {
        WindowChromeConfigurator()
          .frame(width: 0, height: 0)
      }
      .background(WindowReader(window: $window))
      .onChange(of: window) { _, window in
        _ = store.send(.windowChanged(window.map(ObjectIdentifier.init)))
      }
      .background(
        WindowFocusObserverView { activity in
          _ = store.send(.windowActivityChanged(activity))
        }
      )
      .ignoresSafeArea()
      .task(id: updatePresentationContext) {
        _ = updateStore.send(.presentationContextChanged(updatePresentationContext))
      }
      .task {
        _ = store.send(.windowActivityChanged(resolvedWindowActivity))
      }
      .overlay {
        if store.isQuitConfirmationPresented {
          QuitConfirmationOverlay(
            palette: palette,
            onConfirm: {
              _ = store.send(.quitConfirmationConfirmButtonTapped)
            },
            onCancel: {
              _ = store.send(.quitConfirmationCancelButtonTapped)
            }
          )
        }
      }
      .alert(
        store.pendingCloseRequest?.title ?? "Close?",
        isPresented: pendingCloseBinding
      ) {
        Button("Cancel", role: .cancel) {
          _ = store.send(.closeConfirmationCancelButtonTapped)
        }
        Button("Close", role: .destructive) {
          _ = store.send(.closeConfirmationConfirmButtonTapped)
        }
      } message: {
        Text(store.pendingCloseRequest?.message ?? "")
      }
      .animation(.spring(response: 0.2, dampingFraction: 1.0), value: store.isSidebarCollapsed)
      .animation(.easeOut(duration: 0.1), value: store.isFloatingSidebarVisible)
      .animation(.spring(response: 0.3, dampingFraction: 0.82), value: store.isQuitConfirmationPresented)
      .animation(.spring(response: 0.28, dampingFraction: 0.82), value: terminal.visibleTabs.map(\.id))
  }

  private var resolvedWindowActivity: WindowActivityState {
    if let window {
      return WindowActivityState(
        isKeyWindow: window.isKeyWindow,
        isVisible: window.occlusionState.contains(.visible)
      )
    }
    return .inactive
  }

  @ViewBuilder
  private func terminalLayout(geometry: GeometryProxy) -> some View {
    ZStack(alignment: .leading) {
      TerminalSplitView(
        store: store,
        palette: palette,
        terminal: terminal,
        totalWidth: geometry.size.width,
        isSidebarCollapsed: store.isSidebarCollapsed,
        sidebarFraction: sidebarFractionBinding,
        minFraction: minSidebarFraction,
        maxFraction: maxSidebarFraction,
        onHide: collapseSidebar,
        updateStore: updateStore
      )
      .frame(maxWidth: .infinity, maxHeight: .infinity)

      if store.isSidebarCollapsed {
        FloatingSidebarOverlay(
          store: store,
          palette: palette,
          terminal: terminal,
          totalWidth: geometry.size.width,
          sidebarFraction: sidebarFractionBinding,
          isVisible: floatingSidebarVisibilityBinding,
          minFraction: minSidebarFraction,
          maxFraction: maxSidebarFraction,
          updateStore: updateStore
        )
      }
    }
  }

  private func collapseSidebar() {
    withAnimation(.spring(response: 0.2, dampingFraction: 1.0)) {
      _ = store.send(.collapseSidebarButtonTapped)
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
  static let split = "TerminalSplit"
  static let floatingSidebar = "TerminalFloatingSidebar"
}

private struct TerminalSplitView: View {
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
          coordinateSpaceName: TerminalCoordinateSpace.split,
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

private struct QuitConfirmationOverlay: View {
  let palette: TerminalPalette
  let onConfirm: () -> Void
  let onCancel: () -> Void

  private static let transition: AnyTransition = .asymmetric(
    insertion: .offset(y: -16).combined(with: .scale(scale: 0.96)).combined(with: .opacity),
    removal: .offset(y: -16).combined(with: .scale(scale: 0.96)).combined(with: .opacity)
  )

  var body: some View {
    ZStack {
      Button(action: onCancel) {
        Color.black.opacity(0.4)
          .ignoresSafeArea()
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Cancel quit confirmation")

      VStack(alignment: .leading, spacing: 0) {
        VStack(alignment: .leading, spacing: 0) {
          QuitConfirmationIcon()
            .padding(.bottom, 16)

          Text("Quit Supaterm?")
            .font(.system(size: 22, weight: .semibold))
            .foregroundStyle(palette.primaryText)

          Text("Are you sure you want to quit?")
            .font(.system(size: 13))
            .foregroundStyle(palette.secondaryText)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 4)

          HStack {
            DialogActionButton(
              palette: palette,
              title: "Cancel",
              style: .secondary,
              shortcut: .text("esc"),
              action: onCancel
            )
            .keyboardShortcut(.cancelAction)

            Spacer()

            DialogActionButton(
              palette: palette,
              title: "Quit",
              style: .destructive,
              shortcut: .symbol("return"),
              action: onConfirm
            )
            .keyboardShortcut(.defaultAction)
          }
          .padding(.top, 28)
        }
        .frame(width: 360)
        .padding(12)
        .background(palette.dialogInnerBackground, in: .rect(cornerRadius: 11))
        .overlay {
          RoundedRectangle(cornerRadius: 11, style: .continuous)
            .stroke(palette.dialogBorder, lineWidth: 0.5)
        }
      }
      .padding(3)
      .background(palette.dialogOuterBackground, in: .rect(cornerRadius: 14))
      .shadow(color: .black.opacity(0.25), radius: 20, y: 8)
      .transition(Self.transition)
    }
  }
}

private struct QuitConfirmationIcon: View {
  var body: some View {
    Image(nsImage: NSApp.applicationIconImage)
      .resizable()
      .interpolation(.high)
      .antialiased(true)
      .scaledToFit()
      .frame(width: 46, height: 46)
      .clipShape(.rect(cornerRadius: 12))
      .accessibilityHidden(true)
  }
}

private struct DialogActionButton: View {
  enum Style {
    case secondary
    case destructive
  }

  enum Shortcut {
    case symbol(String)
    case text(String)
  }

  let palette: TerminalPalette
  let title: String
  let style: Style
  let shortcut: Shortcut
  let action: () -> Void

  @State private var isHovering = false

  var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        Text(title)
          .font(.system(size: 13, weight: .medium))

        Spacer()
          .frame(width: 3)

        Group {
          switch shortcut {
          case .symbol(let name):
            Image(systemName: name)
              .accessibilityHidden(true)
          case .text(let value):
            Text(value.lowercased()).opacity(0.5)
          }
        }
        .font(.system(size: 10, weight: .semibold))
        .frame(minWidth: 18, minHeight: 18)
        .padding(.horizontal, shortcutPadding)
        .background(foreground.opacity(shortcutOpacity), in: .rect(cornerRadius: 4))
      }
      .foregroundStyle(foreground)
      .padding(.horizontal, 14)
      .padding(.vertical, 8)
      .background(background, in: .rect(cornerRadius: 10))
    }
    .buttonStyle(.plain)
    .onHover { isHovering = $0 }
  }

  private var background: Color {
    switch style {
    case .secondary:
      isHovering ? palette.dialogSecondaryHoverFill : palette.dialogSecondaryFill
    case .destructive:
      isHovering ? palette.dialogDestructiveHoverFill : palette.dialogDestructiveFill
    }
  }

  private var foreground: Color {
    switch style {
    case .secondary:
      palette.dialogPrimaryText
    case .destructive:
      .white
    }
  }

  private var shortcutOpacity: Double {
    switch style {
    case .secondary:
      0.07
    case .destructive:
      0.15
    }
  }

  private var shortcutPadding: CGFloat {
    switch shortcut {
    case .symbol:
      0
    case .text(let value):
      value.count == 1 ? 0 : 4
    }
  }
}

private struct TerminalSidebarView: View {
  let store: StoreOf<TerminalSceneFeature>
  let palette: TerminalPalette
  let terminal: TerminalHostState
  let updateStore: StoreOf<UpdateFeature>

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      SidebarHeaderView(store: store, palette: palette, updateStore: updateStore)
      SidebarContainerView(store: store, palette: palette, terminal: terminal)
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

private struct FloatingSidebarOverlay: View {
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
    .clipShape(.rect(cornerRadius: 16))
    .overlay {
      RoundedRectangle(cornerRadius: 16, style: .continuous)
        .stroke(palette.detailStroke, lineWidth: 1)
    }
    .shadow(color: palette.shadow, radius: 16, x: 0, y: 6)
    .padding(6)
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

private enum WindowTrafficLightMetrics {
  static var buttonSize: CGFloat {
    if #available(macOS 26.0, *) {
      14
    } else {
      12
    }
  }

  static let buttonSpacing: CGFloat = 9
  static let leadingPadding: CGFloat = 8
  static let symbolSize: CGFloat = 8

  static var pillLeadingPadding: CGFloat {
    leadingPadding + (buttonSize * 3) + (buttonSpacing * 3)
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
              .foregroundStyle(isSelected ? palette.selectedText.opacity(0.9) : palette.secondaryText)
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

private struct TerminalDetailView: View {
  let store: StoreOf<TerminalSceneFeature>
  let palette: TerminalPalette
  let terminal: TerminalHostState
  let selectedTabID: TerminalTabID

  var body: some View {
    TerminalDetailSurface(
      store: store,
      terminal: terminal,
      selectedTabID: selectedTabID
    )
    .compositingGroup()
    .clipShape(.rect(cornerRadius: 18))
    .overlay {
      RoundedRectangle(cornerRadius: 18, style: .continuous)
        .stroke(palette.detailStroke, lineWidth: 1)
    }
    .padding(6)
  }
}

private struct TerminalDetailSurface: View {
  let store: StoreOf<TerminalSceneFeature>
  let terminal: TerminalHostState
  let selectedTabID: TerminalTabID

  var body: some View {
    TerminalTabContentStack(tabs: terminal.tabs, selectedTabId: selectedTabID) { tabID in
      TerminalSurfacePaneView(
        store: store,
        terminal: terminal,
        tabID: tabID
      )
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

private struct TerminalSurfacePaneView: View {
  let store: StoreOf<TerminalSceneFeature>
  let terminal: TerminalHostState
  let tabID: TerminalTabID

  var body: some View {
    TerminalSplitTreeAXContainer(tree: terminal.splitTree(for: tabID)) { operation in
      _ = store.send(.splitOperationRequested(tabID: tabID, operation: operation))
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

private struct ToolbarIconButton: View {
  let symbol: String
  let palette: TerminalPalette
  let accessibilityLabel: String?
  let action: () -> Void

  @State private var isHovering = false

  init(
    symbol: String,
    palette: TerminalPalette,
    accessibilityLabel: String? = nil,
    action: @escaping () -> Void = {}
  ) {
    self.symbol = symbol
    self.palette = palette
    self.accessibilityLabel = accessibilityLabel
    self.action = action
  }

  var body: some View {
    Button(action: action) {
      Image(systemName: symbol)
        .font(.system(size: 14, weight: .medium))
        .foregroundStyle(isHovering ? palette.secondaryText.opacity(0.8) : palette.secondaryText)
        .frame(width: 30, height: 30)
        .background(isHovering ? palette.secondaryText.opacity(0.2) : .clear, in: .rect(cornerRadius: 6))
        .accessibilityHidden(true)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(accessibilityLabel ?? "Action")
    .onHover { isHovering = $0 }
  }
}

private struct WindowTrafficLights: View {
  @State private var isHovering = false

  var body: some View {
    HStack(spacing: WindowTrafficLightMetrics.buttonSpacing) {
      ForEach(TrafficLight.allCases, id: \.self) { light in
        Button(
          action: { light.perform() },
          label: {
            Circle()
              .fill(light.color)
              .frame(
                width: WindowTrafficLightMetrics.buttonSize,
                height: WindowTrafficLightMetrics.buttonSize
              )
              .overlay {
                if isHovering {
                  Image(systemName: light.symbol)
                    .font(.system(size: WindowTrafficLightMetrics.symbolSize, weight: .black))
                    .foregroundStyle(.black.opacity(0.55))
                    .accessibilityHidden(true)
                }
              }
          }
        )
        .buttonStyle(.plain)
        .accessibilityLabel(light.accessibilityLabel)
      }
    }
    .padding(.leading, WindowTrafficLightMetrics.leadingPadding)
    .onHover { hovering in
      withAnimation(.easeInOut(duration: 0.1)) {
        isHovering = hovering
      }
    }
  }
}

private enum TrafficLight: CaseIterable {
  case close
  case minimize
  case zoom

  var color: Color {
    switch self {
    case .close:
      Color(red: 1, green: 0.37, blue: 0.34)
    case .minimize:
      Color(red: 1, green: 0.74, blue: 0.18)
    case .zoom:
      Color(red: 0.16, green: 0.8, blue: 0.33)
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

  var accessibilityLabel: String {
    switch self {
    case .close:
      "Close window"
    case .minimize:
      "Minimize window"
    case .zoom:
      "Enter full screen"
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
      window.toggleFullScreen(nil)
    }
  }
}

private struct WindowChromeConfigurator: NSViewRepresentable {
  func makeNSView(context: Context) -> NSView {
    NSView()
  }

  func updateNSView(_ nsView: NSView, context: Context) {
    DispatchQueue.main.async {
      guard let window = nsView.window else { return }

      window.titleVisibility = .hidden
      window.titlebarAppearsTransparent = true
      window.titlebarSeparatorStyle = .none
      window.toolbar = nil
      window.isMovableByWindowBackground = true
      window.standardWindowButton(.closeButton)?.isHidden = true
      window.standardWindowButton(.miniaturizeButton)?.isHidden = true
      window.standardWindowButton(.zoomButton)?.isHidden = true

      if let themeFrame = window.contentView?.superview,
        let titlebarContainer = firstDescendant(
          named: "NSTitlebarContainerView",
          in: themeFrame
        )
      {
        titlebarContainer.isHidden = true
      }
    }
  }

  private func firstDescendant(named className: String, in view: NSView) -> NSView? {
    for subview in view.subviews {
      if String(describing: type(of: subview)) == className {
        return subview
      }
      if let descendant = firstDescendant(named: className, in: subview) {
        return descendant
      }
    }
    return nil
  }
}

private struct TerminalPalette {
  let windowBackgroundTint: Color
  let detailBackground: Color
  let detailStroke: Color
  let dialogOuterBackground: Color
  let dialogInnerBackground: Color
  let dialogBorder: Color
  let dialogSecondaryFill: Color
  let dialogSecondaryHoverFill: Color
  let dialogDestructiveFill: Color
  let dialogDestructiveHoverFill: Color
  let dialogPrimaryText: Color
  let pillFill: Color
  let rowFill: Color
  let clearFill: Color
  let selectedFill: Color
  let selectionStroke: Color
  let primaryText: Color
  let secondaryText: Color
  let selectedText: Color
  let selectedIcon: Color
  let shadow: Color
  let amber: Color
  let mint: Color
  let sky: Color
  let coral: Color
  let violet: Color
  let slate: Color

  init(colorScheme: ColorScheme) {
    if colorScheme == .dark {
      windowBackgroundTint = Color(red: 0.078, green: 0.078, blue: 0.078, opacity: 0.3)
      detailBackground = Color(red: 0.15, green: 0.14, blue: 0.14)
      detailStroke = Color.white.opacity(0.08)
      dialogOuterBackground = Color(red: 0.1412, green: 0.1412, blue: 0.1412)
      dialogInnerBackground = Color(red: 0.1137, green: 0.1137, blue: 0.1137)
      dialogBorder = Color(nsColor: .separatorColor)
      dialogSecondaryFill = Color.white.opacity(0.136)
      dialogSecondaryHoverFill = Color.white.opacity(0.085)
      dialogDestructiveFill = Color(red: 1, green: 0.4118, blue: 0.4118)
      dialogDestructiveHoverFill = Color(red: 1, green: 0.4118, blue: 0.4118).opacity(0.85)
      dialogPrimaryText = .white
      pillFill = Color.white.opacity(0.08)
      rowFill = Color.white.opacity(0.06)
      clearFill = Color.white.opacity(0.03)
      selectedFill = Color(red: 0.93, green: 0.93, blue: 0.95)
      selectionStroke = Color.black.opacity(0.14)
      primaryText = Color.white.opacity(0.94)
      secondaryText = Color.white.opacity(0.58)
      selectedText = Color.black.opacity(0.82)
      selectedIcon = Color.black.opacity(0.82)
      shadow = .black.opacity(0.28)
    } else {
      windowBackgroundTint = Color(red: 0.953, green: 0.898, blue: 0.839, opacity: 0.3)
      detailBackground = Color(red: 0.985, green: 0.975, blue: 0.96)
      detailStroke = Color.black.opacity(0.06)
      dialogOuterBackground = .white
      dialogInnerBackground = Color.black.opacity(0.1)
      dialogBorder = Color(nsColor: .separatorColor)
      dialogSecondaryFill = Color.black.opacity(0.08)
      dialogSecondaryHoverFill = Color.black.opacity(0.05)
      dialogDestructiveFill = Color(red: 1, green: 0.4118, blue: 0.4118)
      dialogDestructiveHoverFill = Color(red: 1, green: 0.4118, blue: 0.4118).opacity(0.85)
      dialogPrimaryText = .black
      pillFill = Color.black.opacity(0.07)
      rowFill = Color.black.opacity(0.05)
      clearFill = Color.black.opacity(0.02)
      selectedFill = Color(red: 0.12, green: 0.12, blue: 0.12)
      selectionStroke = Color.white.opacity(0.08)
      primaryText = Color.black.opacity(0.86)
      secondaryText = Color.black.opacity(0.48)
      selectedText = .white
      selectedIcon = .white
      shadow = .black.opacity(0.08)
    }

    amber = Color(red: 0.89, green: 0.64, blue: 0.28)
    mint = Color(red: 0.3, green: 0.72, blue: 0.58)
    sky = Color(red: 0.31, green: 0.59, blue: 0.94)
    coral = Color(red: 0.9, green: 0.43, blue: 0.38)
    violet = Color(red: 0.57, green: 0.45, blue: 0.86)
    slate = Color(red: 0.38, green: 0.44, blue: 0.56)
  }

  func fill(for tone: TerminalTone) -> Color {
    color(for: tone).opacity(0.85)
  }

  private func color(for tone: TerminalTone) -> Color {
    switch tone {
    case .amber:
      amber
    case .coral:
      coral
    case .mint:
      mint
    case .sky:
      sky
    case .slate:
      slate
    case .violet:
      violet
    }
  }
}

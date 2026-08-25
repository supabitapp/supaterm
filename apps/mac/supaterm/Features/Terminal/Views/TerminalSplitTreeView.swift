import AppKit
import SupaTheme
import SupatermCLIShared
import SwiftUI

struct TerminalSplitTreeView: View {
  let agentPanelPresentations: [UUID: PaneAgentPanelPresentation]
  let dimmingColor: Color
  let dimmingOpacity: Double
  let focusedSurfaceID: UUID?
  let hiddenAgentPanelSurfaceIDs: Set<UUID>
  let isSidebarCollapsed: Bool
  let notificationColor: Color
  let palette: Palette
  let agentPanelForksDown: Bool
  let agentPanelShortcutHint: String?
  let showsGlowingPaneRing: Bool
  let showsSidebarAttentionIndicator: Bool
  let splitDividerColor: Color
  let tree: SplitTree<GhosttySurfaceView>
  let unreadSurfaceIDs: Set<UUID>
  let action: (Operation) -> Void

  var body: some View {
    if let node = tree.zoomed ?? tree.root {
      let paneChrome = PaneChromeConfiguration(
        isSidebarCollapsed: isSidebarCollapsed,
        showsSidebarAttentionIndicator: showsSidebarAttentionIndicator,
        tree: tree
      )
      SubtreeView(
        agentPanelPresentations: agentPanelPresentations,
        node: node,
        dimmingColor: dimmingColor,
        dimmingOpacity: dimmingOpacity,
        focusedSurfaceID: focusedSurfaceID,
        hiddenAgentPanelSurfaceIDs: hiddenAgentPanelSurfaceIDs,
        notificationColor: notificationColor,
        palette: palette,
        paneChrome: paneChrome,
        agentPanelForksDown: agentPanelForksDown,
        agentPanelShortcutHint: agentPanelShortcutHint,
        showsGlowingPaneRing: showsGlowingPaneRing,
        splitDividerColor: splitDividerColor,
        unreadSurfaceIDs: unreadSurfaceIDs,
        outerEdges: .all,
        isRoot: node == tree.root,
        action: action
      )
      .id(node.structuralIdentity)
    }
  }

  enum Operation: Equatable {
    case mutateTree(TreeMutation)
    case equalizePanes(UUID)
    case splitPane(UUID, TerminalPaneSplitDirection)
    case togglePaneZoom(UUID)
    case toggleSidebar
    case agentPanelCopyText(String)
    case agentPanelForkSessionRequested(
      surfaceID: UUID,
      direction: SupatermPaneDirection,
      session: PaneAgentPanelSession
    )
    case agentPanelVisibilityToggled(UUID)
    case agentPanelURLTapped(URL)
  }

  enum TreeMutation: Equatable {
    case resize(node: SplitTree<GhosttySurfaceView>.Node, ratio: Double)
    case drop(payloadId: UUID, destinationId: UUID, zone: TerminalSplitDropZone)
    case equalize
  }

  enum AgentPanelOverlayState: Equatable {
    case hidden
    case collapsedIcon
    case expandedPanel
  }

  struct SubtreeView: View {
    let agentPanelPresentations: [UUID: PaneAgentPanelPresentation]
    let node: SplitTree<GhosttySurfaceView>.Node
    let dimmingColor: Color
    let dimmingOpacity: Double
    let focusedSurfaceID: UUID?
    let hiddenAgentPanelSurfaceIDs: Set<UUID>
    let notificationColor: Color
    let palette: Palette
    let paneChrome: PaneChromeConfiguration
    let agentPanelForksDown: Bool
    let agentPanelShortcutHint: String?
    let showsGlowingPaneRing: Bool
    let splitDividerColor: Color
    let unreadSurfaceIDs: Set<UUID>
    let outerEdges: OuterEdges
    var isRoot: Bool = false
    let action: (Operation) -> Void

    var body: some View {
      switch node {
      case .leaf(let leafView):
        LeafView(
          agentPanelPresentation: agentPanelPresentations[leafView.id],
          dimmingColor: dimmingColor,
          dimmingOpacity: dimmingOpacity,
          focusedSurfaceID: focusedSurfaceID,
          isAgentPanelCollapsed: hiddenAgentPanelSurfaceIDs.contains(leafView.id),
          notificationColor: notificationColor,
          palette: palette,
          paneChrome: paneChrome,
          agentPanelForksDown: agentPanelForksDown,
          agentPanelShortcutHint: agentPanelShortcutHint,
          showsGlowingPaneRing: showsGlowingPaneRing,
          surfaceView: leafView,
          isSplit: !isRoot,
          isUnread: unreadSurfaceIDs.contains(leafView.id),
          outerEdges: outerEdges,
          action: action
        )
      case .split(let split):
        let splitViewDirection: SplitView<SubtreeView, SubtreeView>.Direction =
          switch split.direction {
          case .horizontal: .horizontal
          case .vertical: .vertical
          }
        SplitView(
          splitViewDirection,
          Binding<CGFloat>(
            get: {
              CGFloat(split.ratio)
            },
            set: {
              action(.mutateTree(.resize(node: node, ratio: Double($0))))
            }),
          dividerColor: splitDividerColor,
          minimumLeftSize: TerminalSplitLayout.minimumSize(for: split.left),
          minimumRightSize: TerminalSplitLayout.minimumSize(for: split.right),
          resizeIncrements: CGSize(width: 1, height: 1),
          left: {
            SubtreeView(
              agentPanelPresentations: agentPanelPresentations,
              node: split.left,
              dimmingColor: dimmingColor,
              dimmingOpacity: dimmingOpacity,
              focusedSurfaceID: focusedSurfaceID,
              hiddenAgentPanelSurfaceIDs: hiddenAgentPanelSurfaceIDs,
              notificationColor: notificationColor,
              palette: palette,
              paneChrome: paneChrome,
              agentPanelForksDown: agentPanelForksDown,
              agentPanelShortcutHint: agentPanelShortcutHint,
              showsGlowingPaneRing: showsGlowingPaneRing,
              splitDividerColor: splitDividerColor,
              unreadSurfaceIDs: unreadSurfaceIDs,
              outerEdges: outerEdges.child(.left, in: split.direction),
              action: action
            )
          },
          right: {
            SubtreeView(
              agentPanelPresentations: agentPanelPresentations,
              node: split.right,
              dimmingColor: dimmingColor,
              dimmingOpacity: dimmingOpacity,
              focusedSurfaceID: focusedSurfaceID,
              hiddenAgentPanelSurfaceIDs: hiddenAgentPanelSurfaceIDs,
              notificationColor: notificationColor,
              palette: palette,
              paneChrome: paneChrome,
              agentPanelForksDown: agentPanelForksDown,
              agentPanelShortcutHint: agentPanelShortcutHint,
              showsGlowingPaneRing: showsGlowingPaneRing,
              splitDividerColor: splitDividerColor,
              unreadSurfaceIDs: unreadSurfaceIDs,
              outerEdges: outerEdges.child(.right, in: split.direction),
              action: action
            )
          },
          onEqualize: {
            action(.mutateTree(.equalize))
          }
        )
      }
    }
  }

  struct LeafView: View {
    let agentPanelPresentation: PaneAgentPanelPresentation?
    let dimmingColor: Color
    let dimmingOpacity: Double
    let focusedSurfaceID: UUID?
    let isAgentPanelCollapsed: Bool
    let notificationColor: Color
    let palette: Palette
    let paneChrome: PaneChromeConfiguration
    let agentPanelForksDown: Bool
    let agentPanelShortcutHint: String?
    let showsGlowingPaneRing: Bool
    let surfaceView: GhosttySurfaceView
    let isSplit: Bool
    let isUnread: Bool
    let outerEdges: OuterEdges
    let action: (Operation) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dropState: DropState = .idle
    @State private var isPaneHovering = false
    @State private var notificationPulseAnimationGeneration = 0
    @State private var notificationPulseOpacity = 0.0

    private static let agentPanelEdgePadding: CGFloat = 12
    private static let agentPanelCursorClearance: CGFloat = 12

    private var paneShape: RoundedRectangle {
      RoundedRectangle(
        cornerRadius: isSplit ? TerminalChromeMetrics.paneCornerRadius : 0,
        style: .continuous
      )
    }

    private var paneInsets: EdgeInsets {
      guard isSplit else {
        return EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0)
      }
      return outerEdges.paneInsets(
        outer: TerminalChromeMetrics.paneInset,
        inner: TerminalChromeMetrics.paneGap / 2
      )
    }

    private var title: String {
      surfaceView.resolvedDisplayTitle(
        defaultValue: TerminalHostState.paneFallbackTitle(
          for: surfaceView.id,
          in: paneChrome.tree
        )
      )
    }

    private var backgroundColor: Color {
      Color(nsColor: surfaceView.bridge.state.effectiveBackgroundColorWithOpacity)
    }

    private var panePalette: Palette {
      Self.palette(
        for: surfaceView.bridge.state.effectiveBackgroundColor,
        inheriting: palette
      )
    }

    var body: some View {
      VStack(spacing: 0) {
        TerminalPaneTopBar(
          canEqualize: paneChrome.canEqualize,
          isPaneZoomed: paneChrome.zoomedPaneID == surfaceView.id,
          isSidebarCollapsed: paneChrome.isSidebarCollapsed,
          showsSidebarAttentionIndicator: paneChrome.showsSidebarAttentionIndicator,
          showsSidebarButton: paneChrome.sidebarPaneID == surfaceView.id,
          palette: panePalette,
          backgroundColor: backgroundColor,
          paneID: surfaceView.id,
          equalizePanes: {
            action(.equalizePanes(surfaceView.id))
          },
          toggleSidebar: {
            action(.toggleSidebar)
          },
          title: title,
          splitDown: {
            action(.splitPane(surfaceView.id, .vertical))
          },
          splitRight: {
            action(.splitPane(surfaceView.id, .horizontal))
          },
          togglePaneZoom: {
            action(.togglePaneZoom(surfaceView.id))
          }
        )
        .accessibilityHidden(true)

        GeometryReader { geometry in
          terminalContent(in: geometry)
        }
      }
      .background(backgroundColor)
      .compositingGroup()
      .clipShape(paneShape)
      .shadow(
        color: palette.detailShadow.opacity(isSplit ? 1 : 0),
        radius: 2,
        x: 0,
        y: 1
      )
      .overlay {
        unreadRingOverlay
      }
      .overlay {
        notificationPulseOverlay
      }
      .padding(paneInsets)
      .onChange(of: isUnread) { oldValue, newValue in
        guard oldValue != newValue else { return }
        updateNotificationPulse(
          oldAttention: oldValue,
          newAttention: newValue,
          reduceMotion: reduceMotion
        )
      }
      .onChange(of: showsGlowingPaneRing) { _, isEnabled in
        guard !isEnabled else { return }
        cancelNotificationPulse()
      }
      .onChange(of: reduceMotion) { _, newValue in
        guard newValue else { return }
        cancelNotificationPulse()
      }
      .onDisappear {
        surfaceView.bridge.clearMouseOverLink()
        cancelNotificationPulse()
      }
    }

    private func terminalContent(in geometry: GeometryProxy) -> some View {
      baseTerminal(in: geometry)
        .background {
          dropTargetBackground(size: geometry.size)
        }
        .background {
          unreadBackground
        }
        .overlay {
          dropOverlay
        }
    }

    private func baseTerminal(in geometry: GeometryProxy) -> some View {
      GhosttyTerminalView(surfaceView: surfaceView, size: geometry.size)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityHidden(true)
        .overlay(alignment: .top) {
          GhosttySurfaceProgressOverlay(state: surfaceView.bridge.state)
        }
        .overlay {
          hoverLinkOverlay
        }
        .overlay(alignment: .topTrailing) {
          searchOverlay
        }
        .overlay(alignment: .topTrailing) {
          agentPanelOverlay(size: geometry.size)
        }
        .overlay {
          dimmingOverlay
        }
        .overlay {
          failureOverlay
        }
        .overlay(alignment: .top) {
          dragHandleOverlay
        }
        .onHover { hovering in
          isPaneHovering = hovering
        }
    }

    @ViewBuilder
    private var hoverLinkOverlay: some View {
      if let link = surfaceView.bridge.state.mouseOverLink {
        GhosttySurfaceHoverLinkOverlay(link: link, palette: palette)
      }
    }

    @ViewBuilder
    private var searchOverlay: some View {
      if surfaceView.bridge.state.searchNeedle != nil {
        GhosttySurfaceSearchOverlay(surfaceView: surfaceView)
      }
    }

    @ViewBuilder
    private func agentPanelOverlay(size: CGSize) -> some View {
      let searchIsVisible = surfaceView.bridge.state.searchNeedle != nil
      let topPadding = Self.agentPanelTopPadding(searchIsVisible: searchIsVisible)
      let overlayState = Self.agentPanelOverlayState(
        presentation: agentPanelPresentation,
        focusedSurfaceID: focusedSurfaceID,
        surfaceID: surfaceView.id,
        size: size,
        isCollapsed: isAgentPanelCollapsed
      )
      if let agentPanelPresentation, overlayState != .hidden {
        let shortcutHint = Self.visibleShortcutHint(
          agentPanelShortcutHint,
          focusedSurfaceID: focusedSurfaceID,
          surfaceID: surfaceView.id
        )
        AgentPanelSurface(
          isCollapsed: overlayState == .collapsedIcon,
          isFocused: focusedSurfaceID == surfaceView.id,
          presentation: agentPanelPresentation,
          palette: palette,
          forksDown: agentPanelForksDown,
          reduceMotion: reduceMotion,
          shortcutHint: shortcutHint,
          surfaceSize: size,
          surfaceView: surfaceView,
          topPadding: topPadding,
          copyText: { text in
            action(.agentPanelCopyText(text))
          },
          forkSession: { direction, session in
            action(
              .agentPanelForkSessionRequested(
                surfaceID: surfaceView.id,
                direction: direction,
                session: session
              )
            )
          },
          toggle: toggleAgentPanel,
          openURL: { url in
            action(.agentPanelURLTapped(url))
          }
        )
        .padding(.top, topPadding)
        .padding([.leading, .trailing, .bottom], Self.agentPanelEdgePadding)
      }
    }

    @ViewBuilder
    private var dimmingOverlay: some View {
      if shouldDimSplit {
        Rectangle()
          .fill(dimmingColor)
          .opacity(dimmingOpacity)
          .allowsHitTesting(false)
      }
    }

    @ViewBuilder
    private var failureOverlay: some View {
      if let failure = surfaceView.bridge.state.failure {
        GhosttySurfaceFailureOverlay(failure: failure, palette: palette)
      }
    }

    @ViewBuilder
    private var dragHandleOverlay: some View {
      if isSplit {
        DragHandle(
          surfaceView: surfaceView,
          isVisible: isPaneHovering
        )
      }
    }

    private func dropTargetBackground(size: CGSize) -> some View {
      Color.clear
        .contentShape(.rect)
        .onDrop(
          of: [TerminalSplitTreeView.dragType],
          delegate: SplitDropDelegate(
            dropState: $dropState,
            viewSize: size,
            destinationId: surfaceView.id,
            action: action
          ))
    }

    private var unreadBackground: some View {
      Rectangle()
        .fill(notificationColor.opacity(backgroundOpacity))
        .opacity(hasVisibleAttention ? 1 : 0)
        .allowsHitTesting(false)
    }

    private var unreadRingOverlay: some View {
      paneShape
        .strokeBorder(notificationColor.opacity(strokeOpacity), lineWidth: lineWidth)
        .shadow(color: notificationColor.opacity(shadowOpacity), radius: shadowRadius)
        .compositingGroup()
        .opacity(hasVisibleAttention ? 1 : 0)
        .allowsHitTesting(false)
    }

    private var notificationPulseOverlay: some View {
      paneShape
        .strokeBorder(
          notificationColor.opacity(notificationPulseOpacity),
          lineWidth: notificationPulseLineWidth
        )
        .shadow(
          color: notificationColor.opacity(notificationPulseOpacity * 0.6),
          radius: notificationPulseShadowRadius
        )
        .compositingGroup()
        .opacity(showsGlowingPaneRing ? 1 : 0)
        .allowsHitTesting(false)
    }

    @ViewBuilder
    private var dropOverlay: some View {
      if case .dropping(let zone) = dropState {
        TerminalSplitDropOverlay(zone: zone, color: palette.accent)
          .allowsHitTesting(false)
      }
    }

    private var backgroundOpacity: Double {
      isUnread ? 0.1 : 0
    }

    private var hasVisibleAttention: Bool {
      Self.hasVisibleAttention(isUnread: isUnread, showsGlowingPaneRing: showsGlowingPaneRing)
    }

    private var shouldDimSplit: Bool {
      Self.shouldDimSplit(
        isSplit: isSplit,
        focusedSurfaceID: focusedSurfaceID,
        surfaceID: surfaceView.id,
        dimmingOpacity: dimmingOpacity
      )
    }

    private var lineWidth: CGFloat {
      3
    }

    private var notificationPulseLineWidth: CGFloat {
      max(lineWidth, 3)
    }

    private var notificationPulseShadowRadius: CGFloat {
      max(shadowRadius, 12)
    }

    private var shadowOpacity: Double {
      0.58
    }

    private var shadowRadius: CGFloat {
      14
    }

    private var strokeOpacity: Double {
      1
    }

    static func hasVisibleAttention(isUnread: Bool, showsGlowingPaneRing: Bool) -> Bool {
      isUnread && showsGlowingPaneRing
    }

    static func palette(for backgroundColor: NSColor, inheriting palette: Palette) -> Palette {
      Palette(
        colorScheme: GhosttySurfaceConfig.colorScheme(for: backgroundColor),
        referencePalette: palette.referencePalette,
        tint: palette.tint
      )
    }

    static func shouldDimSplit(
      isSplit: Bool,
      focusedSurfaceID: UUID?,
      surfaceID: UUID,
      dimmingOpacity: Double
    ) -> Bool {
      isSplit && focusedSurfaceID != surfaceID && dimmingOpacity > 0
    }

    static func agentPanelOverlayState(
      presentation: PaneAgentPanelPresentation?,
      focusedSurfaceID _: UUID?,
      surfaceID _: UUID,
      size: CGSize,
      isCollapsed: Bool
    ) -> AgentPanelOverlayState {
      guard let presentation, !presentation.isEmpty else {
        return .hidden
      }
      if isCollapsed {
        return .collapsedIcon
      }
      let hasRoom = size.width >= 360 && size.height >= 220
      return hasRoom ? .expandedPanel : .hidden
    }

    static func agentPanelTopPadding(searchIsVisible: Bool) -> CGFloat {
      searchIsVisible ? GhosttySurfaceSearchOverlay.topReservedHeight : agentPanelEdgePadding
    }

    static func agentPanelOverlayWidth(isCollapsed: Bool) -> CGFloat {
      isCollapsed ? AgentPanelMetrics.collapsedLength : AgentPanelMetrics.expandedWidth
    }

    static func visibleShortcutHint(
      _ shortcutHint: String?,
      focusedSurfaceID: UUID?,
      surfaceID: UUID
    ) -> String? {
      focusedSurfaceID == surfaceID ? shortcutHint : nil
    }

    static func shouldTemporarilyCollapseAgentPanel(
      cursorRect: CGRect?,
      surfaceSize: CGSize,
      panelHeight: CGFloat?,
      topPadding: CGFloat
    ) -> Bool {
      guard
        let cursorRect,
        let panelFrame = agentPanelFrame(
          surfaceSize: surfaceSize,
          panelHeight: panelHeight,
          topPadding: topPadding
        )
      else { return false }
      return
        panelFrame
        .insetBy(dx: -agentPanelCursorClearance, dy: -agentPanelCursorClearance)
        .intersects(cursorRect)
    }

    static func maxAgentPanelHeight(
      surfaceSize: CGSize,
      topPadding: CGFloat
    ) -> CGFloat {
      surfaceSize.height - topPadding - agentPanelEdgePadding
    }

    static func agentPanelFrame(
      surfaceSize: CGSize,
      panelHeight: CGFloat?,
      topPadding: CGFloat
    ) -> CGRect? {
      guard let panelHeight, panelHeight > 0 else { return nil }
      return CGRect(
        x: surfaceSize.width - agentPanelEdgePadding - AgentPanelMetrics.expandedWidth,
        y: surfaceSize.height - topPadding - panelHeight,
        width: AgentPanelMetrics.expandedWidth,
        height: panelHeight
      )
    }

    static func shouldTriggerNotificationPulse(
      from oldValue: Bool,
      to newValue: Bool,
      reduceMotion: Bool
    ) -> Bool {
      !reduceMotion && oldValue && !newValue
    }

    private func updateNotificationPulse(
      oldAttention: Bool,
      newAttention: Bool,
      reduceMotion: Bool
    ) {
      cancelNotificationPulse()
      guard showsGlowingPaneRing else { return }
      guard
        Self.shouldTriggerNotificationPulse(
          from: oldAttention,
          to: newAttention,
          reduceMotion: reduceMotion
        )
      else { return }
      triggerNotificationPulse()
    }

    private func cancelNotificationPulse() {
      notificationPulseAnimationGeneration &+= 1
      notificationPulseOpacity = 0
    }

    private func triggerNotificationPulse() {
      notificationPulseOpacity = TerminalNotificationPulsePattern.initialOpacity
      notificationPulseAnimationGeneration &+= 1
      let generation = notificationPulseAnimationGeneration

      for segment in TerminalNotificationPulsePattern.segments {
        DispatchQueue.main.asyncAfter(deadline: .now() + segment.delay) {
          guard notificationPulseAnimationGeneration == generation else { return }
          TerminalMotion.animate(.easeInOut(duration: segment.duration), reduceMotion: reduceMotion) {
            notificationPulseOpacity = segment.targetOpacity
          }
        }
      }
    }

    private func toggleAgentPanel() {
      TerminalMotion.animate(.spring(response: 0.24, dampingFraction: 0.92), reduceMotion: reduceMotion) {
        action(.agentPanelVisibilityToggled(surfaceView.id))
      }
    }
  }

  private struct AgentPanelSurface: View {
    let isCollapsed: Bool
    let isFocused: Bool
    let presentation: PaneAgentPanelPresentation
    let palette: Palette
    let forksDown: Bool
    let reduceMotion: Bool
    let shortcutHint: String?
    let surfaceSize: CGSize
    let surfaceView: GhosttySurfaceView
    let topPadding: CGFloat
    let copyText: (String) -> Void
    let forkSession: (SupatermPaneDirection, PaneAgentPanelSession) -> Void
    let toggle: () -> Void
    let openURL: (URL) -> Void

    @State private var contentHeight: CGFloat?
    @State private var cursorMonitoringGeneration: Int?
    @State private var terminalCursorRect: CGRect?

    private static let cursorMonitoringInterval = Duration.milliseconds(50)
    private static let cursorMonitoringWindow = Duration.seconds(1)

    var body: some View {
      ZStack(alignment: .topTrailing) {
        ScrollView {
          AgentPanelView(
            presentation: presentation,
            palette: palette,
            forksDown: forksDown,
            showsShortcutHints: shortcutHint != nil,
            copyText: copyText,
            forkSession: forkSession,
            openURL: openURL
          )
          .onGeometryChange(for: CGFloat.self) { proxy in
            proxy.size.height
          } action: { height in
            contentHeight = height
          }
        }
        .scrollBounceBehavior(.basedOnSize)
        .opacity(isEffectivelyCollapsed ? 0 : 1)
        .scaleEffect(isEffectivelyCollapsed ? 0.96 : 1, anchor: .topTrailing)
        .allowsHitTesting(!isEffectivelyCollapsed)
        .accessibilityHidden(isEffectivelyCollapsed)

        toggleButton
      }
      .frame(
        width: surfaceWidth,
        height: surfaceHeight,
        alignment: .topTrailing
      )
      .background(
        palette.agentPanelBackground,
        in: .rect(cornerRadius: cornerRadius)
      )
      .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
      .overlay {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
          .strokeBorder(palette.detailStroke, lineWidth: 1)
      }
      .shadow(color: palette.shadow, radius: 18, y: 10)
      .terminalAnimation(
        .spring(response: 0.24, dampingFraction: 0.92),
        value: isEffectivelyCollapsed,
        reduceMotion: reduceMotion
      )
      .frame(width: AgentPanelMetrics.expandedWidth, alignment: .topTrailing)
      .accessibilityElement(children: .contain)
      .onChange(of: surfaceView.bridge.state.userInputGeneration) { _, inputGeneration in
        guard cursorMonitoringIsAllowed else { return }
        cursorMonitoringGeneration = inputGeneration
      }
      .onChange(of: cursorMonitoringIsAllowed) { _, isAllowed in
        guard !isAllowed else { return }
        cursorMonitoringGeneration = nil
      }
      .task(id: cursorMonitoringGeneration) {
        await monitorCursor(cursorMonitoringGeneration)
      }
    }

    private var cursorMonitoringIsAllowed: Bool {
      isFocused && !isCollapsed
    }

    private var temporarilyCollapsesPanel: Bool {
      guard cursorMonitoringGeneration != nil else { return false }
      return cursorOverlapsAgentPanel(terminalCursorRect)
    }

    private var isEffectivelyCollapsed: Bool {
      isCollapsed || temporarilyCollapsesPanel
    }

    private func cursorOverlapsAgentPanel(_ cursorRect: CGRect?) -> Bool {
      return TerminalSplitTreeView.LeafView.shouldTemporarilyCollapseAgentPanel(
        cursorRect: cursorRect,
        surfaceSize: surfaceSize,
        panelHeight: expandedHeight,
        topPadding: topPadding
      )
    }

    private func monitorCursor(_ inputGeneration: Int?) async {
      guard let inputGeneration else {
        terminalCursorRect = nil
        return
      }
      let clock = ContinuousClock()
      let deadline = clock.now.advanced(by: Self.cursorMonitoringWindow)
      var hasLoggedSample = false
      while !Task.isCancelled {
        let cursorRect = surfaceView.terminalCursorRectInScrollWrapper()
        if terminalCursorRect != cursorRect {
          terminalCursorRect = cursorRect
        }
        if !hasLoggedSample {
          hasLoggedSample = true
          logCursorAvoidance(
            "agentPanel.cursorAvoidance.sample",
            inputGeneration: inputGeneration,
            cursorRect: cursorRect,
            fields: ["temporarilyCollapsed=\(cursorOverlapsAgentPanel(cursorRect))"]
          )
        }
        if clock.now >= deadline, !temporarilyCollapsesPanel {
          terminalCursorRect = nil
          if cursorMonitoringGeneration == inputGeneration {
            cursorMonitoringGeneration = nil
          }
          return
        }
        do {
          try await clock.sleep(for: Self.cursorMonitoringInterval)
        } catch {
          return
        }
      }
    }

    private func logCursorAvoidance(
      _ event: String,
      inputGeneration: Int?,
      cursorRect: CGRect?,
      fields: [String] = []
    ) {
      guard !surfaceView.passwordInput else { return }
      let panelFrame = TerminalSplitTreeView.LeafView.agentPanelFrame(
        surfaceSize: surfaceSize,
        panelHeight: expandedHeight,
        topPadding: topPadding
      )
      SupatermLog.debug(
        SupatermLog.terminal,
        event,
        fields: [
          "surfaceID=\(SupatermLog.uuid(surfaceView.id))",
          "generation=\(inputGeneration.map { String($0) } ?? "nil")",
          "focused=\(isFocused)",
          "collapsed=\(isCollapsed)",
          "panel=\(Self.format(panelFrame))",
          "cursor=\(Self.format(cursorRect))",
        ]
          + fields
      )
    }

    private static func format(_ rect: CGRect?) -> String {
      guard let rect else { return "nil" }
      return NSStringFromRect(rect).replacingOccurrences(of: " ", with: "")
    }

    private var toggleButton: some View {
      AgentPanelVisibilityButton(
        isVisible: !isCollapsed,
        palette: palette,
        shortcutHint: shortcutHint,
        action: toggle
      )
    }

    private var surfaceWidth: CGFloat {
      TerminalSplitTreeView.LeafView.agentPanelOverlayWidth(isCollapsed: isEffectivelyCollapsed)
    }

    private var expandedHeight: CGFloat? {
      guard let contentHeight else { return nil }
      return min(
        max(contentHeight, AgentPanelMetrics.collapsedLength),
        TerminalSplitTreeView.LeafView.maxAgentPanelHeight(
          surfaceSize: surfaceSize,
          topPadding: topPadding
        )
      )
    }

    private var surfaceHeight: CGFloat? {
      isEffectivelyCollapsed ? AgentPanelMetrics.collapsedLength : expandedHeight
    }

    private var cornerRadius: CGFloat {
      isEffectivelyCollapsed
        ? AgentPanelMetrics.collapsedCornerRadius : AgentPanelMetrics.expandedCornerRadius
    }
  }

  private struct AgentPanelVisibilityButton: View {
    let isVisible: Bool
    let palette: Palette
    let shortcutHint: String?
    let action: () -> Void

    @State private var isHovering = false

    private var helpText: String {
      isVisible ? "Hide Agent Panel" : "Show Agent Panel"
    }

    private var accessibilityLabel: String {
      isVisible ? "Hide agent panel" : "Show agent panel"
    }

    var body: some View {
      Button(action: action) {
        content
          .foregroundStyle(foregroundStyle)
          .frame(width: AgentPanelMetrics.collapsedLength, height: AgentPanelMetrics.collapsedLength)
          .accessibilityHidden(true)
      }
      .buttonStyle(.plain)
      .help(helpText)
      .accessibilityLabel(accessibilityLabel)
      .onHover { isHovering = $0 }
    }

    private var foregroundStyle: Color {
      isHovering ? palette.secondaryText.opacity(0.8) : palette.secondaryText
    }

    @ViewBuilder
    private var content: some View {
      if let shortcutHint {
        Text(shortcutHint)
          .font(.system(size: 11, weight: .semibold, design: .rounded))
          .monospacedDigit()
      } else {
        Image(systemName: "info.circle")
          .font(.system(size: 14, weight: .medium))
          .accessibilityHidden(true)
      }
    }
  }

  struct DragHandle: View {
    let surfaceView: GhosttySurfaceView
    let isVisible: Bool
    private let handleHeight: CGFloat = 10
    @State private var isHandleHovering = false

    var body: some View {
      Rectangle()
        .fill(Color.clear)
        .frame(maxWidth: .infinity)
        .frame(height: handleHeight)
        .overlay {
          if isVisible {
            Image(systemName: "ellipsis")
              .font(.system(.callout, weight: .semibold))
              .foregroundStyle(.primary.opacity(0.5))
              .accessibilityHidden(true)
          }
        }
        .contentShape(.rect)
        .onHover { hovering in
          guard hovering != isHandleHovering else { return }
          isHandleHovering = hovering
          if hovering {
            NSCursor.openHand.push()
          } else {
            NSCursor.pop()
          }
        }
        .onDisappear {
          if isHandleHovering {
            isHandleHovering = false
            NSCursor.pop()
          }
        }
        .onDrag {
          TerminalSplitTreeView.dragProvider(for: surfaceView)
        }
    }
  }
}

import AppKit
import SupaTheme
import SupatermCLIShared
import SwiftUI
import UniformTypeIdentifiers

struct TerminalNotificationPulseSegment: Equatable {
  let delay: TimeInterval
  let duration: TimeInterval
  let targetOpacity: Double
}

enum TerminalNotificationPulsePattern {
  static let initialOpacity = 1.0
  static let lowOpacity = 0.32
  static let totalDuration: TimeInterval = 1.0
  static let targetOpacities: [Double] = [
    lowOpacity,
    initialOpacity,
    lowOpacity,
    initialOpacity,
    lowOpacity,
    initialOpacity,
    0,
  ]

  static var stepDuration: TimeInterval {
    totalDuration / Double(targetOpacities.count)
  }

  static var segments: [TerminalNotificationPulseSegment] {
    targetOpacities.enumerated().map { index, targetOpacity in
      TerminalNotificationPulseSegment(
        delay: Double(index) * stepDuration,
        duration: stepDuration,
        targetOpacity: targetOpacity
      )
    }
  }
}

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

  enum OuterEdgeBranch {
    case left
    case right
  }

  struct OuterEdges: OptionSet, Equatable {
    let rawValue: Int

    static let top = Self(rawValue: 1 << 0)
    static let bottom = Self(rawValue: 1 << 1)
    static let leading = Self(rawValue: 1 << 2)
    static let trailing = Self(rawValue: 1 << 3)
    static let all: Self = [.top, .bottom, .leading, .trailing]

    func child(_ branch: OuterEdgeBranch, in direction: SplitTree<GhosttySurfaceView>.Direction) -> Self {
      switch (direction, branch) {
      case (.horizontal, .left):
        removing(.trailing)
      case (.horizontal, .right):
        removing(.leading)
      case (.vertical, .left):
        removing(.bottom)
      case (.vertical, .right):
        removing(.top)
      }
    }

    func paneInsets(outer: CGFloat, inner: CGFloat) -> EdgeInsets {
      EdgeInsets(
        top: contains(.top) ? outer : inner,
        leading: contains(.leading) ? outer : inner,
        bottom: contains(.bottom) ? outer : inner,
        trailing: contains(.trailing) ? outer : inner
      )
    }

    private func removing(_ edges: Self) -> Self {
      TerminalSplitTreeView.OuterEdges(rawValue: rawValue & ~edges.rawValue)
    }
  }

  struct PaneChromeConfiguration: Equatable {
    let canEqualize: Bool
    let defaultTitles: [UUID: String]
    let isSidebarCollapsed: Bool
    let showsSidebarAttentionIndicator: Bool
    let sidebarPaneID: UUID
    let zoomedPaneID: UUID?
  }

  private static let dragType = UTType(exportedAs: "sh.supacode.ghosttySurfaceId")
  private static func dragProvider(for surfaceView: GhosttySurfaceView) -> NSItemProvider {
    let provider = NSItemProvider()
    let data = surfaceView.id.uuidString.data(using: .utf8) ?? Data()
    provider.registerDataRepresentation(
      forTypeIdentifier: dragType.identifier,
      visibility: .all
    ) { completion in
      completion(data, nil)
      return nil
    }
    return provider
  }

  var body: some View {
    if let node = tree.zoomed ?? tree.root {
      let paneChrome = PaneChromeConfiguration(
        canEqualize: tree.isSplit,
        defaultTitles: Dictionary(
          uniqueKeysWithValues: tree.leaves().enumerated().map { index, surfaceView in
            (surfaceView.id, "Pane \(index + 1)")
          }
        ),
        isSidebarCollapsed: isSidebarCollapsed,
        showsSidebarAttentionIndicator: showsSidebarAttentionIndicator,
        sidebarPaneID: node.leftmostLeaf().id,
        zoomedPaneID: tree.zoomed?.leftmostLeaf().id
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
    case resize(node: SplitTree<GhosttySurfaceView>.Node, ratio: Double)
    case drop(payloadId: UUID, destinationId: UUID, zone: TerminalSplitDropZone)
    case equalize
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
              action(.resize(node: node, ratio: Double($0)))
            }),
          dividerColor: splitDividerColor,
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
            action(.equalize)
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
        defaultValue: paneChrome.defaultTitles[surfaceView.id] ?? "Pane"
      )
    }

    private var backgroundColor: Color {
      Color(nsColor: surfaceView.bridge.state.effectiveBackgroundColorWithOpacity)
    }

    var body: some View {
      VStack(spacing: 0) {
        TerminalPaneTopBar(
          canEqualize: paneChrome.canEqualize,
          isPaneZoomed: paneChrome.zoomedPaneID == surfaceView.id,
          isSidebarCollapsed: paneChrome.isSidebarCollapsed,
          showsSidebarAttentionIndicator: paneChrome.showsSidebarAttentionIndicator,
          showsSidebarButton: paneChrome.sidebarPaneID == surfaceView.id,
          palette: palette,
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

        GeometryReader { geometry in
          terminalContent(in: geometry)
        }
      }
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

  enum DropState: Equatable {
    case idle
    case dropping(TerminalSplitDropZone)
  }

  struct SplitDropDelegate: DropDelegate {
    @Binding var dropState: DropState
    let viewSize: CGSize
    let destinationId: UUID
    let action: (Operation) -> Void

    func validateDrop(info: DropInfo) -> Bool {
      info.hasItemsConforming(to: [TerminalSplitTreeView.dragType])
    }

    func dropEntered(info: DropInfo) {
      dropState = .dropping(.calculate(at: info.location, in: viewSize))
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
      guard case .dropping = dropState else { return DropProposal(operation: .forbidden) }
      dropState = .dropping(.calculate(at: info.location, in: viewSize))
      return DropProposal(operation: .move)
    }

    func dropExited(info: DropInfo) {
      dropState = .idle
    }

    func performDrop(info: DropInfo) -> Bool {
      let zone = TerminalSplitDropZone.calculate(at: info.location, in: viewSize)
      dropState = .idle

      let providers = info.itemProviders(for: [TerminalSplitTreeView.dragType])
      guard let provider = providers.first else { return false }
      provider.loadDataRepresentation(
        forTypeIdentifier: TerminalSplitTreeView.dragType.identifier
      ) { data, _ in
        guard let data,
          let raw = String(data: data, encoding: .utf8),
          let payloadId = UUID(uuidString: raw)
        else { return }
        Task { @MainActor in
          action(.drop(payloadId: payloadId, destinationId: destinationId, zone: zone))
        }
      }
      return true
    }
  }

}

extension TerminalSplitTreeView.Operation: @unchecked Sendable {}

enum TerminalSplitAXPathComponent: Hashable {
  case left
  case right
}

struct TerminalSplitAXPath: Hashable {
  let components: [TerminalSplitAXPathComponent]

  static let root = Self(components: [])

  func appending(_ component: TerminalSplitAXPathComponent) -> Self {
    TerminalSplitAXPath(components: components + [component])
  }
}

enum TerminalSplitAXDirection: Equatable {
  case horizontal
  case vertical
}

struct TerminalSplitDividerAXDescriptor: Equatable {
  let path: TerminalSplitAXPath
  let direction: TerminalSplitAXDirection
  let ratio: Double
  let splitBounds: CGRect
  let frameInParentSpace: CGRect

  nonisolated var accessibilityLabel: String {
    switch direction {
    case .horizontal:
      "Horizontal split divider"
    case .vertical:
      "Vertical split divider"
    }
  }

  nonisolated var accessibilityHelp: String {
    switch direction {
    case .horizontal:
      "Drag to resize the left and right panes"
    case .vertical:
      "Drag to resize the top and bottom panes"
    }
  }

  nonisolated var accessibilityValue: String {
    "\(Int(ratio * 100))%"
  }

  nonisolated func adjustedRatio(
    step: CGFloat = TerminalSplitMetrics.dividerAdjustmentStep,
    incrementing: Bool
  ) -> Double {
    let splitDimension =
      switch direction {
      case .horizontal: splitBounds.width
      case .vertical: splitBounds.height
      }
    guard splitDimension > 0 else { return ratio }
    let delta = Double(step / splitDimension) * (incrementing ? 1 : -1)
    let minimumPaneSize =
      switch direction {
      case .horizontal: TerminalSplitMetrics.minimumPaneWidth
      case .vertical: TerminalSplitMetrics.minimumPaneHeight
      }
    let minimumRatio = min(0.5, Double(minimumPaneSize / splitDimension))
    let maximumRatio = 1 - minimumRatio
    return max(minimumRatio, min(maximumRatio, ratio + delta))
  }
}

enum TerminalSplitAccessibility {
  static func dividerDescriptors<ViewType: NSView & Identifiable>(
    for node: SplitTree<ViewType>.Node?,
    in bounds: CGRect
  ) -> [TerminalSplitDividerAXDescriptor] {
    guard let node else { return [] }
    return dividerDescriptors(
      for: node,
      path: .root,
      in: bounds
    )
  }

  private static func dividerDescriptors<ViewType: NSView & Identifiable>(
    for node: SplitTree<ViewType>.Node,
    path: TerminalSplitAXPath,
    in bounds: CGRect
  ) -> [TerminalSplitDividerAXDescriptor] {
    switch node {
    case .leaf:
      return []

    case .split(let split):
      let thickness = TerminalSplitMetrics.dividerHitboxSize
      let midpoint = thickness / 2
      let leftBounds: CGRect
      let rightBounds: CGRect
      let frameInParentSpace: CGRect

      switch split.direction {
      case .horizontal:
        let splitX = bounds.minX + bounds.width * split.ratio
        leftBounds = CGRect(
          x: bounds.minX,
          y: bounds.minY,
          width: bounds.width * split.ratio,
          height: bounds.height
        )
        rightBounds = CGRect(
          x: splitX,
          y: bounds.minY,
          width: bounds.width * (1 - split.ratio),
          height: bounds.height
        )
        frameInParentSpace = CGRect(
          x: splitX - midpoint,
          y: bounds.minY,
          width: thickness,
          height: bounds.height
        )

      case .vertical:
        let splitY = bounds.minY + bounds.height * split.ratio
        leftBounds = CGRect(
          x: bounds.minX,
          y: bounds.minY,
          width: bounds.width,
          height: bounds.height * split.ratio
        )
        rightBounds = CGRect(
          x: bounds.minX,
          y: splitY,
          width: bounds.width,
          height: bounds.height * (1 - split.ratio)
        )
        frameInParentSpace = CGRect(
          x: bounds.minX,
          y: splitY - midpoint,
          width: bounds.width,
          height: thickness
        )
      }

      let direction: TerminalSplitAXDirection =
        switch split.direction {
        case .horizontal:
          .horizontal
        case .vertical:
          .vertical
        }

      let descriptor = TerminalSplitDividerAXDescriptor(
        path: path,
        direction: direction,
        ratio: split.ratio,
        splitBounds: bounds,
        frameInParentSpace: frameInParentSpace
      )

      let leftPath = path.appending(.left)
      let rightPath = path.appending(.right)

      return [descriptor]
        + dividerDescriptors(for: split.left, path: leftPath, in: leftBounds)
        + dividerDescriptors(for: split.right, path: rightPath, in: rightBounds)
    }
  }
}

// MARK: - Accessibility Container

/// Wraps the SwiftUI split tree in an AppKit view so we can expose an ordered
/// list of terminal panes to assistive technologies.
struct TerminalSplitTreeAXContainer: NSViewRepresentable {
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
  let action: (TerminalSplitTreeView.Operation) -> Void

  func makeNSView(context: Context) -> TerminalSplitAXContainerView {
    TerminalSplitAXContainerView(backgroundColor: backgroundColor)
  }

  func updateNSView(_ nsView: TerminalSplitAXContainerView, context: Context) {
    let visibleNode = tree.zoomed ?? tree.root
    let visiblePanes = visibleNode?.leaves() ?? []
    nsView.update(
      backgroundColor: backgroundColor,
      rootView: TerminalSplitTreeView(
        agentPanelPresentations: agentPanelPresentations,
        dimmingColor: dimmingColor,
        dimmingOpacity: dimmingOpacity,
        focusedSurfaceID: focusedSurfaceID,
        hiddenAgentPanelSurfaceIDs: hiddenAgentPanelSurfaceIDs,
        isSidebarCollapsed: isSidebarCollapsed,
        notificationColor: notificationColor,
        palette: palette,
        agentPanelForksDown: agentPanelForksDown,
        agentPanelShortcutHint: agentPanelShortcutHint,
        showsGlowingPaneRing: showsGlowingPaneRing,
        showsSidebarAttentionIndicator: showsSidebarAttentionIndicator,
        splitDividerColor: splitDividerColor,
        tree: tree,
        unreadSurfaceIDs: unreadSurfaceIDs,
        action: action
      ),
      visibleNode: visibleNode,
      action: action,
      panes: visiblePanes
    )
  }

  private var backgroundColor: NSColor {
    tree.isSplit ? .clear : NSColor(palette.detailBackground)
  }
}

private final class TerminalSplitHostingView: NSHostingView<TerminalSplitTreeView> {
  nonisolated override var safeAreaInsets: NSEdgeInsets { NSEdgeInsetsZero }

  override var mouseDownCanMoveWindow: Bool { false }
}

final class TerminalSplitAXContainerView: NSView {
  private let backgroundView = NSView()
  private(set) var backgroundColor: NSColor
  private var hostingView: TerminalSplitHostingView?
  private var visibleNode: SplitTree<GhosttySurfaceView>.Node?
  private var panes: [GhosttySurfaceView] = []
  private var dividerElements: [TerminalSplitAXDividerElement] = []
  private var dividerElementsByPath: [TerminalSplitAXPath: TerminalSplitAXDividerElement] = [:]
  private var panesLabel: String = "Terminal split: 0 panes"
  private var lastPaneIDs: [UUID] = []
  private var lastDividerPaths: [TerminalSplitAXPath] = []
  private var action: ((TerminalSplitTreeView.Operation) -> Void)?

  nonisolated override var safeAreaInsets: NSEdgeInsets { NSEdgeInsetsZero }

  init(backgroundColor: NSColor) {
    self.backgroundColor = backgroundColor
    super.init(frame: .zero)
    backgroundView.wantsLayer = true
    backgroundView.layer?.backgroundColor = backgroundColor.cgColor
    backgroundView.translatesAutoresizingMaskIntoConstraints = false
    addSubview(backgroundView)
    NSLayoutConstraint.activate([
      backgroundView.leadingAnchor.constraint(equalTo: leadingAnchor),
      backgroundView.trailingAnchor.constraint(equalTo: trailingAnchor),
      backgroundView.topAnchor.constraint(equalTo: topAnchor),
      backgroundView.bottomAnchor.constraint(equalTo: bottomAnchor),
    ])
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  func update(
    backgroundColor: NSColor,
    rootView: TerminalSplitTreeView,
    visibleNode: SplitTree<GhosttySurfaceView>.Node?,
    action: @escaping (TerminalSplitTreeView.Operation) -> Void,
    panes: [GhosttySurfaceView]
  ) {
    if self.backgroundColor != backgroundColor {
      self.backgroundColor = backgroundColor
      backgroundView.layer?.backgroundColor = backgroundColor.cgColor
    }
    if let hostingView {
      hostingView.rootView = rootView
    } else {
      let hostingView = TerminalSplitHostingView(rootView: rootView)
      hostingView.wantsLayer = true
      hostingView.layer?.zPosition = 1
      hostingView.translatesAutoresizingMaskIntoConstraints = false
      addSubview(hostingView)
      NSLayoutConstraint.activate([
        hostingView.leadingAnchor.constraint(equalTo: leadingAnchor),
        hostingView.trailingAnchor.constraint(equalTo: trailingAnchor),
        hostingView.topAnchor.constraint(equalTo: topAnchor),
        hostingView.bottomAnchor.constraint(equalTo: bottomAnchor),
      ])
      self.hostingView = hostingView
    }

    self.visibleNode = visibleNode
    self.action = action
    let newPaneIDs = panes.map(\.id)
    self.panes = panes
    panesLabel = "Terminal split: \(panes.count) pane" + (panes.count == 1 ? "" : "s")

    for (index, pane) in panes.enumerated() {
      pane.setAccessibilityIdentifier("terminal.pane.\(pane.id.uuidString)")
      pane.setAccessibilityPaneIndex(index: index + 1, total: panes.count)
      pane.setAccessibilityParent(self)
    }

    refreshAccessibilityDividers(postLayoutChanged: newPaneIDs != lastPaneIDs)
    lastPaneIDs = newPaneIDs
  }

  override func layout() {
    super.layout()
    refreshAccessibilityDividers(postLayoutChanged: false)
  }

  func adjustDivider(
    at path: TerminalSplitAXPath,
    incrementing: Bool
  ) -> Bool {
    guard
      let visibleNode,
      let descriptor = dividerElementsByPath[path]?.descriptor,
      let node = visibleNode.node(at: splitTreePath(for: path)),
      let action,
      case .split = node
    else {
      return false
    }

    let nextRatio = descriptor.adjustedRatio(incrementing: incrementing)
    guard nextRatio != descriptor.ratio else { return true }
    action(.resize(node: node, ratio: nextRatio))
    return true
  }

  private func refreshAccessibilityDividers(postLayoutChanged: Bool) {
    let descriptors = TerminalSplitAccessibility.dividerDescriptors(
      for: visibleNode,
      in: bounds
    )
    let previousElementsByPath = dividerElementsByPath
    let previousDividerPaths = lastDividerPaths
    let dividerPaths = descriptors.map(\.path)
    var nextElements: [TerminalSplitAXDividerElement] = []
    var nextElementsByPath: [TerminalSplitAXPath: TerminalSplitAXDividerElement] = [:]
    var valueChangedElements: [TerminalSplitAXDividerElement] = []

    for descriptor in descriptors {
      let element =
        previousElementsByPath[descriptor.path]
        ?? TerminalSplitAXDividerElement(container: self, descriptor: descriptor)
      if let previousDescriptor = previousElementsByPath[descriptor.path]?.descriptor,
        previousDescriptor.ratio != descriptor.ratio
      {
        valueChangedElements.append(element)
      }
      element.descriptor = descriptor
      nextElements.append(element)
      nextElementsByPath[descriptor.path] = element
    }

    dividerElements = nextElements
    dividerElementsByPath = nextElementsByPath
    lastDividerPaths = dividerPaths

    if postLayoutChanged || dividerPaths != previousDividerPaths {
      NSAccessibility.post(element: self, notification: .layoutChanged)
      return
    }

    for element in valueChangedElements {
      NSAccessibility.post(element: element, notification: .valueChanged)
    }
  }

  override func isAccessibilityElement() -> Bool {
    true
  }

  override func accessibilityRole() -> NSAccessibility.Role? {
    NSAccessibility.Role(rawValue: "AXSplitGroup")
  }

  override func accessibilityLabel() -> String? {
    panesLabel
  }

  override func accessibilityChildren() -> [Any]? {
    var children: [Any] = panes
    if let hostingView {
      children.append(hostingView)
    }
    children.append(contentsOf: dividerElements)
    return children
  }

  private func splitTreePath(for path: TerminalSplitAXPath) -> SplitTree<GhosttySurfaceView>.Path {
    SplitTree<GhosttySurfaceView>.Path(
      path: path.components.map { component in
        switch component {
        case .left:
          .left
        case .right:
          .right
        }
      }
    )
  }
}

nonisolated final class TerminalSplitAXDividerElement: NSAccessibilityElement {
  weak var container: TerminalSplitAXContainerView?
  var descriptor: TerminalSplitDividerAXDescriptor

  init(
    container: TerminalSplitAXContainerView,
    descriptor: TerminalSplitDividerAXDescriptor
  ) {
    self.container = container
    self.descriptor = descriptor
    super.init()
  }

  override func accessibilityParent() -> Any? {
    container
  }

  override func accessibilityFrameInParentSpace() -> NSRect {
    descriptor.frameInParentSpace
  }

  override func accessibilityRole() -> NSAccessibility.Role? {
    .splitter
  }

  override func accessibilityLabel() -> String? {
    descriptor.accessibilityLabel
  }

  override func accessibilityHelp() -> String? {
    descriptor.accessibilityHelp
  }

  override func accessibilityValue() -> Any? {
    descriptor.accessibilityValue
  }

  override func accessibilityPerformIncrement() -> Bool {
    guard let container else { return false }
    let path = descriptor.path
    return MainActor.assumeIsolated {
      container.adjustDivider(at: path, incrementing: true)
    }
  }

  override func accessibilityPerformDecrement() -> Bool {
    guard let container else { return false }
    let path = descriptor.path
    return MainActor.assumeIsolated {
      container.adjustDivider(at: path, incrementing: false)
    }
  }
}

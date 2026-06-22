import AppKit
import SupatermCLIShared
import SupatermGhosttyFeature
import SupatermTerminalAgentPanelFeature
import SupatermTerminalFeature
import SupatermTerminalModels
import SupatermTerminalPresentationFeature
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
  let notificationColor: Color
  let palette: TerminalPalette
  let agentPanelForksDown: Bool
  let agentPanelShortcutHint: String?
  let showsGlowingPaneRing: Bool
  let splitDividerColor: Color
  let tree: SplitTree<GhosttySurfaceView>
  let unreadSurfaceIDs: Set<UUID>
  let action: (Operation) -> Void

  struct ResizeOverlayGridSize: Equatable {
    let columns: Int
    let rows: Int
  }

  struct ResizeOverlayTrigger: Equatable {
    let viewSize: CGSize
    let gridSize: ResizeOverlayGridSize
    let fontSizePoints: Double?

    static func == (lhs: Self, rhs: Self) -> Bool {
      lhs.viewSize == rhs.viewSize
        && lhs.gridSize == rhs.gridSize
        && lhs.fontSizePoints == rhs.fontSizePoints
    }
  }

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

    func cornerRadii(cornerRadius: CGFloat) -> RectangleCornerRadii {
      RectangleCornerRadii(
        topLeading: 0,
        bottomLeading: contains(.bottom) && contains(.leading) ? cornerRadius : 0,
        bottomTrailing: contains(.bottom) && contains(.trailing) ? cornerRadius : 0,
        topTrailing: 0
      )
    }

    private func removing(_ edges: Self) -> Self {
      TerminalSplitTreeView.OuterEdges(rawValue: rawValue & ~edges.rawValue)
    }
  }

  static let dragType = UTType(exportedAs: "sh.supacode.ghosttySurfaceId")
  static func dragProvider(for surfaceView: GhosttySurfaceView) -> NSItemProvider {
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

  static func resizeOverlayGridSize(
    backingSize: CGSize,
    cellSize: CGSize
  ) -> ResizeOverlayGridSize? {
    guard cellSize.width > 0, cellSize.height > 0 else { return nil }
    let backingWidth = max(1, Int(backingSize.width.rounded(.down)))
    let backingHeight = max(1, Int(backingSize.height.rounded(.down)))
    let cellWidth = max(1, Int(cellSize.width.rounded(.down)))
    let cellHeight = max(1, Int(cellSize.height.rounded(.down)))
    let columns = backingWidth / cellWidth
    let rows = backingHeight / cellHeight
    guard columns >= 5, rows >= 2 else { return nil }
    return ResizeOverlayGridSize(columns: columns, rows: rows)
  }

  static func resizeOverlayIsHidden(
    ready: Bool,
    lastTrigger: ResizeOverlayTrigger?,
    currentTrigger: ResizeOverlayTrigger
  ) -> Bool {
    guard ready else { return true }
    guard let lastTrigger else { return true }
    return lastTrigger == currentTrigger
  }

  static func resizeOverlayText(
    lastTrigger: ResizeOverlayTrigger?,
    currentTrigger: ResizeOverlayTrigger
  ) -> String {
    if currentTrigger.fontSizePoints != lastTrigger?.fontSizePoints,
      let fontSizePoints = currentTrigger.fontSizePoints
    {
      return formattedFontSize(fontSizePoints)
    }
    return "\(currentTrigger.gridSize.columns) × \(currentTrigger.gridSize.rows)"
  }

  static func formattedFontSize(_ fontSizePoints: Double) -> String {
    let rounded = fontSizePoints.rounded()
    if abs(fontSizePoints - rounded) < 0.05 {
      return "\(Int(rounded)) pt"
    }
    return String(format: "%.1f pt", fontSizePoints)
  }

  var body: some View {
    if let node = tree.zoomed ?? tree.root {
      SubtreeView(
        agentPanelPresentations: agentPanelPresentations,
        node: node,
        dimmingColor: dimmingColor,
        dimmingOpacity: dimmingOpacity,
        focusedSurfaceID: focusedSurfaceID,
        hiddenAgentPanelSurfaceIDs: hiddenAgentPanelSurfaceIDs,
        notificationColor: notificationColor,
        palette: palette,
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
    case drop(payloadId: UUID, destinationId: UUID, zone: DropZone)
    case equalize
    case agentPanelCopyBranchName(String)
    case agentPanelCopySessionID(String)
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
    let palette: TerminalPalette
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
    let palette: TerminalPalette
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

    private var unreadGlowShape: UnevenRoundedRectangle {
      UnevenRoundedRectangle(
        cornerRadii: outerEdges.cornerRadii(cornerRadius: TerminalChromeMetrics.paneCornerRadius),
        style: .continuous
      )
    }

    var body: some View {
      GeometryReader { geometry in
        terminalContent(in: geometry)
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
            cancelNotificationPulse()
          }
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
          unreadRingOverlay
        }
        .overlay {
          notificationPulseOverlay
        }
        .overlay {
          dropOverlay(size: geometry.size)
        }
    }

    private func baseTerminal(in geometry: GeometryProxy) -> some View {
      GhosttyTerminalView(surfaceView: surfaceView)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .overlay(alignment: .top) {
          GhosttySurfaceProgressOverlay(state: surfaceView.bridge.state)
        }
        .overlay(alignment: .topTrailing) {
          searchOverlay
        }
        .overlay(alignment: .topTrailing) {
          agentPanelOverlay(size: geometry.size)
        }
        .overlay {
          resizeOverlay(size: geometry.size)
        }
        .overlay {
          dimmingOverlay
        }
        .overlay(alignment: .top) {
          dragHandleOverlay
        }
        .onHover { hovering in
          isPaneHovering = hovering
        }
    }

    private func resizeOverlay(size: CGSize) -> some View {
      ResizeOverlay(
        geoSize: size,
        surfaceView: surfaceView
      )
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
      let overlayState = Self.agentPanelOverlayState(
        presentation: agentPanelPresentation,
        focusedSurfaceID: focusedSurfaceID,
        surfaceID: surfaceView.id,
        size: size,
        isCollapsed: isAgentPanelCollapsed
      )
      if let agentPanelPresentation, overlayState != .hidden {
        AgentPanelSurface(
          isCollapsed: overlayState == .collapsedIcon,
          presentation: agentPanelPresentation,
          palette: palette,
          forksDown: agentPanelForksDown,
          reduceMotion: reduceMotion,
          shortcutHint: agentPanelShortcutHint,
          copyBranchName: { branchName in
            action(.agentPanelCopyBranchName(branchName))
          },
          copySessionID: { sessionID in
            action(.agentPanelCopySessionID(sessionID))
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
        .padding(.top, Self.agentPanelTopPadding(searchIsVisible: searchIsVisible))
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
      unreadGlowShape
        .fill(notificationColor.opacity(backgroundOpacity))
        .opacity(hasVisibleAttention ? 1 : 0)
        .allowsHitTesting(false)
    }

    private var unreadRingOverlay: some View {
      unreadGlowShape
        .strokeBorder(notificationColor.opacity(strokeOpacity), lineWidth: lineWidth)
        .shadow(color: notificationColor.opacity(shadowOpacity), radius: shadowRadius)
        .compositingGroup()
        .opacity(hasVisibleAttention ? 1 : 0)
        .allowsHitTesting(false)
    }

    private var notificationPulseOverlay: some View {
      unreadGlowShape
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
    private func dropOverlay(size: CGSize) -> some View {
      if case .dropping(let zone) = dropState {
        DropOverlayView(zone: zone, size: size)
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

}

extension TerminalSplitTreeView.Operation: @unchecked Sendable {}

extension TerminalSplitTreeView.Operation {
  var windowOperation: TerminalWindowSplitOperation? {
    switch self {
    case .resize(let node, let ratio):
      return .resize(leafIDs: node.leaves().map(\.id), ratio: ratio)
    case .drop(let payloadID, let destinationID, let zone):
      return .drop(payloadID: payloadID, destinationID: destinationID, zone: zone.windowDropZone)
    case .equalize:
      return .equalize
    case .agentPanelCopyBranchName,
      .agentPanelCopySessionID,
      .agentPanelForkSessionRequested,
      .agentPanelVisibilityToggled,
      .agentPanelURLTapped:
      return nil
    }
  }
}

extension TerminalSplitTreeView.DropZone {
  var windowDropZone: TerminalSplitDropZone {
    switch self {
    case .up:
      return .up
    case .bottom:
      return .bottom
    case .left:
      return .left
    case .right:
      return .right
    }
  }
}

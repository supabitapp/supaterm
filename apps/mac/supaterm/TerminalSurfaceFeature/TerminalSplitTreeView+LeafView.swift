import Foundation
import SupatermGhosttyFeature
import SupatermTerminalAgentPanelFeature
import SupatermTerminalFeature
import SupatermTerminalPresentationFeature
import SwiftUI

extension TerminalSplitTreeView {
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

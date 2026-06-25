import AppKit
import SupatermCLIShared
import SupatermGhosttyFeature
import SupatermTerminalAgentPanelFeature
import SupatermTerminalFeature
import SupatermTerminalPresentationFeature
import SwiftUI
import UniformTypeIdentifiers

extension TerminalSplitTreeView {
  private struct AgentPanelHeightPreferenceKey: PreferenceKey {
    static var defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
      value = nextValue()
    }
  }

  struct AgentPanelSurface: View {
    let isCollapsed: Bool
    let presentation: PaneAgentPanelPresentation
    let palette: TerminalPalette
    let forksDown: Bool
    let reduceMotion: Bool
    let shortcutHint: String?
    let copyBranchName: (String) -> Void
    let copySessionID: (String) -> Void
    let forkSession: (SupatermPaneDirection, PaneAgentPanelSession) -> Void
    let toggle: () -> Void
    let openURL: (URL) -> Void

    @State private var expandedHeight: CGFloat?

    var body: some View {
      ZStack(alignment: .topTrailing) {
        AgentPanelView(
          presentation: presentation,
          palette: palette,
          forksDown: forksDown,
          showsShortcutHints: shortcutHint != nil,
          copyBranchName: copyBranchName,
          copySessionID: copySessionID,
          forkSession: forkSession,
          openURL: openURL
        )
        .fixedSize(horizontal: false, vertical: true)
        .opacity(isCollapsed ? 0 : 1)
        .scaleEffect(isCollapsed ? 0.96 : 1, anchor: .topTrailing)
        .allowsHitTesting(!isCollapsed)
        .accessibilityHidden(isCollapsed)
        .background {
          GeometryReader { proxy in
            Color.clear.preference(key: AgentPanelHeightPreferenceKey.self, value: proxy.size.height)
          }
        }

        toggleButton
      }
      .frame(
        width: surfaceWidth,
        height: surfaceHeight,
        alignment: .topTrailing
      )
      .background(
        palette.detailBackground.opacity(0.96),
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
        value: isCollapsed,
        reduceMotion: reduceMotion
      )
      .accessibilityElement(children: .contain)
      .onPreferenceChange(AgentPanelHeightPreferenceKey.self) { height in
        guard height > 0 else { return }
        expandedHeight = max(height, AgentPanelMetrics.collapsedLength)
      }
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
      TerminalSplitTreeView.LeafView.agentPanelOverlayWidth(isCollapsed: isCollapsed)
    }

    private var surfaceHeight: CGFloat? {
      isCollapsed ? AgentPanelMetrics.collapsedLength : expandedHeight
    }

    private var cornerRadius: CGFloat {
      isCollapsed ? AgentPanelMetrics.collapsedCornerRadius : AgentPanelMetrics.expandedCornerRadius
    }
  }

  private struct AgentPanelVisibilityButton: View {
    let isVisible: Bool
    let palette: TerminalPalette
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

  struct ResizeOverlay: View {
    let geoSize: CGSize
    let surfaceView: GhosttySurfaceView

    @State private var lastTrigger: TerminalSplitTreeView.ResizeOverlayTrigger?
    @State private var ready = false

    private let padding: CGFloat = 5
    private let durationMilliseconds: UInt64 = 750

    private var gridSize: TerminalSplitTreeView.ResizeOverlayGridSize? {
      TerminalSplitTreeView.resizeOverlayGridSize(
        backingSize: surfaceView.convertToBacking(geoSize),
        cellSize: surfaceView.currentCellSize()
      )
    }

    private var trigger: TerminalSplitTreeView.ResizeOverlayTrigger? {
      guard let gridSize else { return nil }
      return TerminalSplitTreeView.ResizeOverlayTrigger(
        viewSize: geoSize,
        gridSize: gridSize,
        fontSizePoints: surfaceView.currentFontSizePoints()
      )
    }

    var body: some View {
      if let trigger {
        let hidden = TerminalSplitTreeView.resizeOverlayIsHidden(
          ready: ready,
          lastTrigger: lastTrigger,
          currentTrigger: trigger
        )
        let text = TerminalSplitTreeView.resizeOverlayText(
          lastTrigger: lastTrigger,
          currentTrigger: trigger
        )
        Text(verbatim: text)
          .padding(EdgeInsets(top: padding, leading: padding, bottom: padding, trailing: padding))
          .background(
            RoundedRectangle(cornerRadius: 4)
              .fill(.background)
              .shadow(radius: 3)
          )
          .lineLimit(1)
          .truncationMode(.tail)
          .allowsHitTesting(false)
          .opacity(hidden ? 0 : 1)
          .task {
            try? await Task.sleep(for: .milliseconds(500))
            ready = true
          }
          .task(id: trigger) {
            if ready {
              try? await Task.sleep(for: .milliseconds(durationMilliseconds))
            }
            lastTrigger = trigger
          }
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
    case dropping(DropZone)
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
      let zone = DropZone.calculate(at: info.location, in: viewSize)
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

  enum DropZone: String, Equatable {
    case up
    case bottom
    case left
    case right

    static func calculate(at point: CGPoint, in size: CGSize) -> DropZone {
      let relX = point.x / size.width
      let relY = point.y / size.height

      let distToLeft = relX
      let distToRight = 1 - relX
      let distToTop = relY
      let distToBottom = 1 - relY

      let minDist = min(distToLeft, distToRight, distToTop, distToBottom)

      if minDist == distToLeft { return .left }
      if minDist == distToRight { return .right }
      if minDist == distToTop { return .up }
      return .bottom
    }
  }

  struct DropOverlayView: View {
    let zone: DropZone
    let size: CGSize

    var body: some View {
      let overlayColor = Color.accentColor.opacity(0.3)

      switch zone {
      case .up:
        VStack(spacing: 0) {
          Rectangle()
            .fill(overlayColor)
            .frame(height: size.height / 2)
          Spacer()
        }
      case .bottom:
        VStack(spacing: 0) {
          Spacer()
          Rectangle()
            .fill(overlayColor)
            .frame(height: size.height / 2)
        }
      case .left:
        HStack(spacing: 0) {
          Rectangle()
            .fill(overlayColor)
            .frame(width: size.width / 2)
          Spacer()
        }
      case .right:
        HStack(spacing: 0) {
          Spacer()
          Rectangle()
            .fill(overlayColor)
            .frame(width: size.width / 2)
        }
      }
    }
  }
}

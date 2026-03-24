import AppKit
import SwiftUI
import UniformTypeIdentifiers

struct TerminalSplitTreeView: View {
  let focusedSurfaceIDs: Set<UUID>
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

    func cornerRadii(cornerRadius: CGFloat) -> RectangleCornerRadii {
      .init(
        topLeading: 0,
        bottomLeading: contains(.bottom) && contains(.leading) ? cornerRadius : 0,
        bottomTrailing: contains(.bottom) && contains(.trailing) ? cornerRadius : 0,
        topTrailing: 0
      )
    }

    private func removing(_ edges: Self) -> Self {
      .init(rawValue: rawValue & ~edges.rawValue)
    }
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
      SubtreeView(
        focusedSurfaceIDs: focusedSurfaceIDs,
        node: node,
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
  }

  struct SubtreeView: View {
    let focusedSurfaceIDs: Set<UUID>
    let node: SplitTree<GhosttySurfaceView>.Node
    let unreadSurfaceIDs: Set<UUID>
    let outerEdges: OuterEdges
    var isRoot: Bool = false
    let action: (Operation) -> Void

    var body: some View {
      switch node {
      case .leaf(let leafView):
        LeafView(
          hasFocusedNotification: focusedSurfaceIDs.contains(leafView.id),
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
          .init(
            get: {
              CGFloat(split.ratio)
            },
            set: {
              action(.resize(node: node, ratio: Double($0)))
            }),
          dividerColor: .secondary,
          resizeIncrements: .init(width: 1, height: 1),
          left: {
            SubtreeView(
              focusedSurfaceIDs: focusedSurfaceIDs,
              node: split.left,
              unreadSurfaceIDs: unreadSurfaceIDs,
              outerEdges: outerEdges.child(.left, in: split.direction),
              action: action
            )
          },
          right: {
            SubtreeView(
              focusedSurfaceIDs: focusedSurfaceIDs,
              node: split.right,
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
    let hasFocusedNotification: Bool
    let surfaceView: GhosttySurfaceView
    let isSplit: Bool
    let isUnread: Bool
    let outerEdges: OuterEdges
    let action: (Operation) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dropState: DropState = .idle
    @State private var isPaneHovering = false

    private var notificationGlowAnimation: Animation? {
      reduceMotion ? nil : .easeInOut(duration: 0.2)
    }

    private var unreadGlowShape: UnevenRoundedRectangle {
      UnevenRoundedRectangle(
        cornerRadii: outerEdges.cornerRadii(cornerRadius: TerminalChromeMetrics.paneCornerRadius),
        style: .continuous
      )
    }

    var body: some View {
      GeometryReader { geometry in
        GhosttyTerminalView(surfaceView: surfaceView)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .overlay(alignment: .top) {
            GhosttySurfaceProgressOverlay(state: surfaceView.bridge.state)
          }
          .overlay(alignment: .topTrailing) {
            if surfaceView.bridge.state.searchNeedle != nil {
              GhosttySurfaceSearchOverlay(surfaceView: surfaceView)
            }
          }
          .overlay(alignment: .top) {
            if isSplit {
              DragHandle(
                surfaceView: surfaceView,
                isVisible: isPaneHovering
              )
            }
          }
          .onHover { hovering in
            isPaneHovering = hovering
          }
          .background {
            Color.clear
              .contentShape(.rect)
              .onDrop(
                of: [TerminalSplitTreeView.dragType],
                delegate: SplitDropDelegate(
                  dropState: $dropState,
                  viewSize: geometry.size,
                  destinationId: surfaceView.id,
                  action: action
                ))
          }
          .background {
            unreadGlowShape
              .fill(Color.accentColor.opacity(backgroundOpacity))
              .opacity(hasVisibleAttention ? 1 : 0)
              .animation(notificationGlowAnimation, value: attentionAnimationValue)
              .allowsHitTesting(false)
          }
          .overlay {
            unreadGlowShape
              .strokeBorder(Color.accentColor.opacity(strokeOpacity), lineWidth: lineWidth)
              .shadow(color: Color.accentColor.opacity(shadowOpacity), radius: shadowRadius)
              .compositingGroup()
              .opacity(hasVisibleAttention ? 1 : 0)
              .animation(notificationGlowAnimation, value: attentionAnimationValue)
              .allowsHitTesting(false)
          }
          .overlay {
            if case .dropping(let zone) = dropState {
              DropOverlayView(zone: zone, size: geometry.size)
                .allowsHitTesting(false)
            }
          }
      }
    }

    private var backgroundOpacity: Double {
      if isUnread {
        return 0.08
      }
      if hasFocusedNotification {
        return 0.04
      }
      return 0
    }

    private var attentionAnimationValue: Int {
      if isUnread {
        return 2
      }
      if hasFocusedNotification {
        return 1
      }
      return 0
    }

    private var hasVisibleAttention: Bool {
      isUnread || hasFocusedNotification
    }

    private var lineWidth: CGFloat {
      isUnread ? 2 : 1.5
    }

    private var shadowOpacity: Double {
      isUnread ? 0.5 : 0.18
    }

    private var shadowRadius: CGFloat {
      isUnread ? 12 : 8
    }

    private var strokeOpacity: Double {
      isUnread ? 0.95 : 0.45
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
    case top
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
      if minDist == distToTop { return .top }
      return .bottom
    }
  }

  struct DropOverlayView: View {
    let zone: DropZone
    let size: CGSize

    var body: some View {
      let overlayColor = Color.accentColor.opacity(0.3)

      switch zone {
      case .top:
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

extension TerminalSplitTreeView.Operation: @unchecked Sendable {}

// MARK: - Accessibility Container

/// Wraps the SwiftUI split tree in an AppKit view so we can expose an ordered
/// list of terminal panes to assistive technologies.
struct TerminalSplitTreeAXContainer: NSViewRepresentable {
  let focusedSurfaceIDs: Set<UUID>
  let tree: SplitTree<GhosttySurfaceView>
  let unreadSurfaceIDs: Set<UUID>
  let action: (TerminalSplitTreeView.Operation) -> Void

  func makeNSView(context: Context) -> TerminalSplitAXContainerView {
    TerminalSplitAXContainerView()
  }

  func updateNSView(_ nsView: TerminalSplitAXContainerView, context: Context) {
    let visibleNode = tree.zoomed ?? tree.root
    let visiblePanes = visibleNode?.leaves() ?? []
    nsView.update(
      rootView: AnyView(
        TerminalSplitTreeView(
          focusedSurfaceIDs: focusedSurfaceIDs,
          tree: tree,
          unreadSurfaceIDs: unreadSurfaceIDs,
          action: action
        )
      ),
      panes: visiblePanes
    )
  }
}

@MainActor
private final class TerminalSplitHostingView: NSHostingView<AnyView> {
  override var safeAreaInsets: NSEdgeInsets { NSEdgeInsetsZero }

  override var mouseDownCanMoveWindow: Bool { false }
}

@MainActor
final class TerminalSplitAXContainerView: NSView {
  private var hostingView: TerminalSplitHostingView?
  private var panes: [GhosttySurfaceView] = []
  private var panesLabel: String = "Terminal split: 0 panes"
  private var lastPaneIDs: [UUID] = []

  override var safeAreaInsets: NSEdgeInsets { NSEdgeInsetsZero }

  func update(rootView: AnyView, panes: [GhosttySurfaceView]) {
    if let hostingView {
      hostingView.rootView = rootView
    } else {
      let hostingView = TerminalSplitHostingView(rootView: rootView)
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

    let newPaneIDs = panes.map(\.id)
    self.panes = panes
    panesLabel = "Terminal split: \(panes.count) pane" + (panes.count == 1 ? "" : "s")

    for (index, pane) in panes.enumerated() {
      pane.setAccessibilityPaneIndex(index: index + 1, total: panes.count)
      // Expose panes as direct children of this split group for predictable navigation.
      pane.setAccessibilityParent(self)
    }

    if newPaneIDs != lastPaneIDs {
      lastPaneIDs = newPaneIDs
      // Assistive tech may cache the AX tree; nudge it to re-query when pane membership/order changes.
      NSAccessibility.post(element: self, notification: .layoutChanged)
    }
  }

  override func isAccessibilityElement() -> Bool {
    true
  }

  override func accessibilityRole() -> NSAccessibility.Role? {
    // AppKit doesn't provide a named constant for this role.
    NSAccessibility.Role(rawValue: "AXSplitGroup")
  }

  override func accessibilityLabel() -> String? {
    panesLabel
  }

  override func accessibilityChildren() -> [Any]? {
    panes
  }
}

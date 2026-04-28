import AppKit
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
  let dimmingColor: Color
  let dimmingOpacity: Double
  let focusedSurfaceID: UUID?
  let notificationColor: Color
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
        node: node,
        dimmingColor: dimmingColor,
        dimmingOpacity: dimmingOpacity,
        focusedSurfaceID: focusedSurfaceID,
        notificationColor: notificationColor,
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
  }

  struct SubtreeView: View {
    let node: SplitTree<GhosttySurfaceView>.Node
    let dimmingColor: Color
    let dimmingOpacity: Double
    let focusedSurfaceID: UUID?
    let notificationColor: Color
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
          dimmingColor: dimmingColor,
          dimmingOpacity: dimmingOpacity,
          focusedSurfaceID: focusedSurfaceID,
          notificationColor: notificationColor,
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
              node: split.left,
              dimmingColor: dimmingColor,
              dimmingOpacity: dimmingOpacity,
              focusedSurfaceID: focusedSurfaceID,
              notificationColor: notificationColor,
              showsGlowingPaneRing: showsGlowingPaneRing,
              splitDividerColor: splitDividerColor,
              unreadSurfaceIDs: unreadSurfaceIDs,
              outerEdges: outerEdges.child(.left, in: split.direction),
              action: action
            )
          },
          right: {
            SubtreeView(
              node: split.right,
              dimmingColor: dimmingColor,
              dimmingOpacity: dimmingOpacity,
              focusedSurfaceID: focusedSurfaceID,
              notificationColor: notificationColor,
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
    let dimmingColor: Color
    let dimmingOpacity: Double
    let focusedSurfaceID: UUID?
    let notificationColor: Color
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
    step: CGFloat = TerminalSplitMetrics.minimumPaneSize,
    incrementing: Bool
  ) -> Double {
    let splitDimension =
      switch direction {
      case .horizontal: splitBounds.width
      case .vertical: splitBounds.height
      }
    guard splitDimension > 0 else { return ratio }
    let delta = Double(step / splitDimension) * (incrementing ? 1 : -1)
    let minimumRatio = min(0.5, Double(TerminalSplitMetrics.minimumPaneSize / splitDimension))
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
  let dimmingColor: Color
  let dimmingOpacity: Double
  let focusedSurfaceID: UUID?
  let notificationColor: Color
  let showsGlowingPaneRing: Bool
  let splitDividerColor: Color
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
          dimmingColor: dimmingColor,
          dimmingOpacity: dimmingOpacity,
          focusedSurfaceID: focusedSurfaceID,
          notificationColor: notificationColor,
          showsGlowingPaneRing: showsGlowingPaneRing,
          splitDividerColor: splitDividerColor,
          tree: tree,
          unreadSurfaceIDs: unreadSurfaceIDs,
          action: action
        )
      ),
      visibleNode: visibleNode,
      action: action,
      panes: visiblePanes
    )
  }
}

private final class TerminalSplitHostingView: NSHostingView<AnyView> {
  override var safeAreaInsets: NSEdgeInsets { NSEdgeInsetsZero }

  override var mouseDownCanMoveWindow: Bool { false }
}

final class TerminalSplitAXContainerView: NSView {
  private var hostingView: TerminalSplitHostingView?
  private var visibleNode: SplitTree<GhosttySurfaceView>.Node?
  private var panes: [GhosttySurfaceView] = []
  private var dividerElements: [TerminalSplitAXDividerElement] = []
  private var dividerElementsByPath: [TerminalSplitAXPath: TerminalSplitAXDividerElement] = [:]
  private var panesLabel: String = "Terminal split: 0 panes"
  private var lastPaneIDs: [UUID] = []
  private var lastDividerPaths: [TerminalSplitAXPath] = []
  private var action: ((TerminalSplitTreeView.Operation) -> Void)?

  override var safeAreaInsets: NSEdgeInsets { NSEdgeInsetsZero }

  func update(
    rootView: AnyView,
    visibleNode: SplitTree<GhosttySurfaceView>.Node?,
    action: @escaping (TerminalSplitTreeView.Operation) -> Void,
    panes: [GhosttySurfaceView]
  ) {
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

    self.visibleNode = visibleNode
    self.action = action
    let newPaneIDs = panes.map(\.id)
    self.panes = panes
    panesLabel = "Terminal split: \(panes.count) pane" + (panes.count == 1 ? "" : "s")

    for (index, pane) in panes.enumerated() {
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
    panes + dividerElements
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

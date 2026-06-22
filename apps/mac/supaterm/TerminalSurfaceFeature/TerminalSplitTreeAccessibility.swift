import AppKit
import SupatermGhosttyFeature
import SupatermTerminalAgentPanelFeature
import SupatermTerminalPresentationFeature
import SwiftUI

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

struct TerminalSplitTreeAXContainer: NSViewRepresentable {
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
          agentPanelPresentations: agentPanelPresentations,
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

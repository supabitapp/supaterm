import AppKit
import SupaTheme
import SwiftUI

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
  let minimumLeadingSize: CGFloat
  let minimumTrailingSize: CGFloat

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
    let location = CGFloat(ratio) * splitDimension + (incrementing ? step : -step)
    return Double(
      TerminalSplitLayout.clampedLocation(
        location,
        dimension: splitDimension,
        minimumLeadingSize: minimumLeadingSize,
        minimumTrailingSize: minimumTrailingSize
      ) / splitDimension
    )
  }
}

enum TerminalSplitAccessibility {
  static func orderedPaneChildren<ViewType>(
    panes: [ViewType],
    toolbar: (ViewType) -> Any?
  ) -> [Any] {
    panes.flatMap { pane in
      if let toolbar = toolbar(pane) {
        return [toolbar, pane]
      }
      return [pane]
    }
  }

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
        frameInParentSpace: frameInParentSpace,
        minimumLeadingSize: minimumSize(for: split.left, direction: direction),
        minimumTrailingSize: minimumSize(for: split.right, direction: direction)
      )

      let leftPath = path.appending(.left)
      let rightPath = path.appending(.right)

      return [descriptor]
        + dividerDescriptors(for: split.left, path: leftPath, in: leftBounds)
        + dividerDescriptors(for: split.right, path: rightPath, in: rightBounds)
    }
  }

  private static func minimumSize<ViewType: NSView & Identifiable>(
    for node: SplitTree<ViewType>.Node,
    direction: TerminalSplitAXDirection
  ) -> CGFloat {
    let size = TerminalSplitLayout.minimumSize(for: node)
    switch direction {
    case .horizontal:
      return size.width
    case .vertical:
      return size.height
    }
  }
}

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

nonisolated enum TerminalPaneAXToolbarItem: Hashable, Sendable {
  case title
  case sidebar
  case splitRight
  case splitDown
  case equalize
  case zoom
}

nonisolated struct TerminalPaneAXToolbarConfiguration: Equatable, Sendable {
  let paneID: UUID
  let title: String
  let canEqualize: Bool
  let isPaneZoomed: Bool
  let isSidebarCollapsed: Bool
  let showsSidebarAttentionIndicator: Bool
  let showsSidebarButton: Bool
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
  private var toolbarElements: [TerminalPaneAXToolbarElement] = []
  private var toolbarElementsByPaneID: [UUID: TerminalPaneAXToolbarElement] = [:]
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
    let previousToolbarElements = toolbarElementsByPaneID
    let previousToolbarConfigurations = toolbarElementsByPaneID.mapValues(\.configuration)
    self.panes = panes
    panesLabel = "Terminal split: \(panes.count) pane" + (panes.count == 1 ? "" : "s")

    for (index, pane) in panes.enumerated() {
      pane.setAccessibilityIdentifier("terminal.pane.\(pane.id.uuidString)")
      pane.setAccessibilityPaneIndex(index: index + 1, total: panes.count)
      pane.setAccessibilityParent(self)
    }

    toolbarElements = panes.map { pane in
      let configuration = TerminalPaneAXToolbarConfiguration(
        paneID: pane.id,
        title: pane.resolvedDisplayTitle(
          defaultValue: TerminalHostState.paneFallbackTitle(
            for: pane.id,
            in: rootView.tree
          )
        ),
        canEqualize: rootView.tree.isSplit,
        isPaneZoomed: rootView.tree.zoomed?.leftmostLeaf().id == pane.id,
        isSidebarCollapsed: rootView.isSidebarCollapsed,
        showsSidebarAttentionIndicator: rootView.showsSidebarAttentionIndicator,
        showsSidebarButton: (rootView.tree.zoomed ?? rootView.tree.root)?.leftmostLeaf().id == pane.id
      )
      let element =
        previousToolbarElements[pane.id]
        ?? TerminalPaneAXToolbarElement(container: self, configuration: configuration)
      element.configuration = configuration
      return element
    }
    toolbarElementsByPaneID = Dictionary(
      uniqueKeysWithValues: toolbarElements.map { ($0.configuration.paneID, $0) }
    )
    let toolbarConfigurations = toolbarElementsByPaneID.mapValues(\.configuration)

    refreshAccessibilityDividers(
      postLayoutChanged: newPaneIDs != lastPaneIDs
        || toolbarConfigurations != previousToolbarConfigurations
    )
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
    action(.mutateTree(.resize(node: node, ratio: nextRatio)))
    return true
  }

  func performToolbarAction(
    _ item: TerminalPaneAXToolbarItem,
    paneID: UUID
  ) -> Bool {
    guard let action, let configuration = toolbarElementsByPaneID[paneID]?.configuration else {
      return false
    }
    switch item {
    case .title:
      return false
    case .sidebar:
      guard configuration.showsSidebarButton else { return false }
      action(.toggleSidebar)
    case .splitRight:
      action(.splitPane(paneID, .horizontal))
    case .splitDown:
      action(.splitPane(paneID, .vertical))
    case .equalize:
      guard configuration.canEqualize else { return false }
      action(.equalizePanes(paneID))
    case .zoom:
      guard configuration.canEqualize else { return false }
      action(.togglePaneZoom(paneID))
    }
    return true
  }

  func toolbarFrame(for paneID: UUID) -> CGRect {
    guard let pane = panes.first(where: { $0.id == paneID }) else { return .zero }
    let paneFrame = pane.convert(pane.bounds, to: self)
    return CGRect(
      x: paneFrame.minX,
      y: paneFrame.maxY,
      width: paneFrame.width,
      height: TerminalChromeMetrics.detailToolbarHeight
    )
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
    var children = TerminalSplitAccessibility.orderedPaneChildren(panes: panes) { pane in
      toolbarElementsByPaneID[pane.id]
    }
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

nonisolated final class TerminalPaneAXToolbarElement: NSAccessibilityElement {
  weak var container: TerminalSplitAXContainerView?
  var configuration: TerminalPaneAXToolbarConfiguration
  private let items: [TerminalPaneAXToolbarItem]
  private var childrenByItem: [TerminalPaneAXToolbarItem: TerminalPaneAXToolbarChildElement] = [:]

  init(
    container: TerminalSplitAXContainerView,
    configuration: TerminalPaneAXToolbarConfiguration
  ) {
    self.container = container
    self.configuration = configuration
    self.items = [.title, .sidebar, .splitRight, .splitDown, .equalize, .zoom]
    super.init()
    var childrenByItem: [TerminalPaneAXToolbarItem: TerminalPaneAXToolbarChildElement] = [:]
    for item in items {
      childrenByItem[item] = TerminalPaneAXToolbarChildElement(toolbar: self, item: item)
    }
    self.childrenByItem = childrenByItem
  }

  override func accessibilityParent() -> Any? {
    container
  }

  override func accessibilityRole() -> NSAccessibility.Role? {
    .toolbar
  }

  override func accessibilityLabel() -> String? {
    "Pane toolbar"
  }

  override func accessibilityIdentifier() -> String? {
    "terminal.pane-toolbar.\(configuration.paneID.uuidString)"
  }

  override func accessibilityFrameInParentSpace() -> NSRect {
    guard let container else { return .zero }
    let paneID = configuration.paneID
    return MainActor.assumeIsolated {
      container.toolbarFrame(for: paneID)
    }
  }

  override func accessibilityChildren() -> [Any]? {
    visibleItems.compactMap { childrenByItem[$0] }
  }

  func frame(for item: TerminalPaneAXToolbarItem) -> CGRect {
    let toolbarFrame = accessibilityFrameInParentSpace()
    let bounds = CGRect(origin: .zero, size: toolbarFrame.size)
    switch item {
    case .title:
      let leading = configuration.showsSidebarButton ? 46.0 : 8.0
      let trailing = buttonRowFrame.minX - 8
      return CGRect(x: leading, y: 0, width: max(0, trailing - leading), height: bounds.height)
    case .sidebar:
      return CGRect(x: 8, y: 3, width: 30, height: 30)
    case .splitRight, .splitDown, .equalize, .zoom:
      guard let index = buttonItems.firstIndex(of: item) else { return .zero }
      return CGRect(
        x: buttonRowFrame.minX + CGFloat(index) * 34,
        y: 3,
        width: 30,
        height: 30
      )
    }
  }

  private var visibleItems: [TerminalPaneAXToolbarItem] {
    items.filter { item in
      switch item {
      case .sidebar:
        configuration.showsSidebarButton
      case .zoom:
        configuration.canEqualize
      default:
        true
      }
    }
  }

  private var buttonItems: [TerminalPaneAXToolbarItem] {
    configuration.canEqualize
      ? [.splitRight, .splitDown, .equalize, .zoom]
      : [.splitRight, .splitDown, .equalize]
  }

  private var buttonRowFrame: CGRect {
    let width = CGFloat(buttonItems.count * 30 + max(0, buttonItems.count - 1) * 4)
    return CGRect(
      x: max(0, accessibilityFrameInParentSpace().width - 4 - width),
      y: 3,
      width: width,
      height: 30
    )
  }
}

nonisolated final class TerminalPaneAXToolbarChildElement: NSAccessibilityElement {
  weak var toolbar: TerminalPaneAXToolbarElement?
  let item: TerminalPaneAXToolbarItem

  init(toolbar: TerminalPaneAXToolbarElement, item: TerminalPaneAXToolbarItem) {
    self.toolbar = toolbar
    self.item = item
    super.init()
  }

  override func accessibilityParent() -> Any? {
    toolbar
  }

  override func accessibilityRole() -> NSAccessibility.Role? {
    item == .title ? .staticText : .button
  }

  override func accessibilityLabel() -> String? {
    guard let toolbar else { return nil }
    return switch item {
    case .title:
      toolbar.configuration.title
    case .sidebar:
      toolbar.configuration.showsSidebarAttentionIndicator
        ? "Show sidebar, unread notifications"
        : (toolbar.configuration.isSidebarCollapsed ? "Show sidebar" : "Hide sidebar")
    case .splitRight:
      "Split right"
    case .splitDown:
      "Split down"
    case .equalize:
      "Equalize panes"
    case .zoom:
      toolbar.configuration.isPaneZoomed ? "Reset split zoom" : "Zoom split"
    }
  }

  override func accessibilityValue() -> Any? {
    item == .title ? accessibilityLabel() : nil
  }

  override func accessibilityIdentifier() -> String? {
    guard let toolbar, item != .title else { return nil }
    let suffix =
      switch item {
      case .title:
        ""
      case .sidebar:
        "sidebar"
      case .splitRight:
        "split-right"
      case .splitDown:
        "split-down"
      case .equalize:
        "equalize"
      case .zoom:
        "zoom"
      }
    guard let namespace = toolbar.accessibilityIdentifier() else { return nil }
    return "\(namespace).\(suffix)"
  }

  override func isAccessibilityEnabled() -> Bool {
    guard let toolbar else { return false }
    return item != .equalize || toolbar.configuration.canEqualize
  }

  override func accessibilityFrameInParentSpace() -> NSRect {
    toolbar?.frame(for: item) ?? .zero
  }

  override func accessibilityPerformPress() -> Bool {
    guard let toolbar, let container = toolbar.container else { return false }
    let item = item
    let paneID = toolbar.configuration.paneID
    return MainActor.assumeIsolated {
      container.performToolbarAction(item, paneID: paneID)
    }
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

import AppKit
import QuartzCore
import SupaTheme
import SwiftUI

struct TerminalHorizontalDropMotion: Equatable {
  let positions: [CGPoint]
  let keyTimes: [NSNumber]

  init(source: CGPoint, target: CGPoint, velocity: CGVector) {
    let speed = hypot(velocity.dx, velocity.dy)
    let arc = min(5, 2 + 0.002 * speed)
    let midpoint = CGPoint(
      x: (source.x + target.x) / 2,
      y: (source.y + target.y) / 2 + arc
    )
    let direction: CGFloat = target.x >= source.x ? 1 : -1
    positions = [
      source,
      midpoint,
      target,
      CGPoint(x: target.x + direction, y: target.y),
      target,
    ]
    keyTimes = [0, 0.4, 0.7, 0.85, 1]
  }
}

@MainActor
final class TerminalHorizontalTabStripController: NSViewController, NSDraggingSource {
  struct Actions {
    let closeTab: (TerminalTabID) -> Void
    let newTab: () -> Void
    let selectTab: (TerminalTabID) -> Void
    let toggleGroup: (TerminalTabGroupID) -> Void
  }

  private struct DragState {
    let payload: TerminalTabDragPayload
    let sourceCenter: CGPoint
    var didTransfer = false
    var lastScreenPoint: CGPoint
    var lastTimestamp: TimeInterval
    var velocity = CGVector.zero
  }

  private struct PendingDrag {
    let entryID: TerminalSidebarEntryID
    let origin: CGPoint
  }

  private let windowControllerID: UUID
  private let tabDragRegistry: TerminalTabDragRegistry
  private let stripView = TerminalHorizontalTabStripView()
  private let newTabButton = NSButton()
  private let overflowButton = NSButton()
  private let insertionIndicator = NSView()
  private var actions: Actions?
  private var groupViews: [TerminalTabGroupID: TerminalHorizontalTabGroupView] = [:]
  private var itemViews: [TerminalSidebarEntryID: TerminalHorizontalTabItemView] = [:]
  private var layout: TerminalHorizontalTabLayout?
  private var lastLayoutWidth: CGFloat?
  private var snapshot: TerminalTabSurfaceSnapshot?
  private var palette: Palette?
  private var pendingDrag: PendingDrag?
  private var reduceMotion = false
  private var dragState: DragState?
  private var dropPlan: TerminalSidebarDropPlan?
  private var topologyRevision: UInt64?
  private var selectedTabID: TerminalTabID?

  init(windowControllerID: UUID, tabDragRegistry: TerminalTabDragRegistry) {
    self.windowControllerID = windowControllerID
    self.tabDragRegistry = tabDragRegistry
    super.init(nibName: nil, bundle: nil)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  override func loadView() {
    stripView.controller = self
    stripView.setContentHuggingPriority(.defaultLow, for: .horizontal)
    stripView.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    stripView.registerForDraggedTypes([.terminalTabDrag])
    configureButton(newTabButton, symbol: "plus", action: #selector(createTab))
    configureButton(overflowButton, symbol: "ellipsis", action: #selector(showOverflow))
    overflowButton.setAccessibilityLabel("More Tabs")
    newTabButton.setAccessibilityLabel("New Tab")
    insertionIndicator.wantsLayer = true
    insertionIndicator.layer?.cornerRadius = 1
    insertionIndicator.isHidden = true
    insertionIndicator.setAccessibilityElement(false)
    stripView.addSubview(newTabButton)
    stripView.addSubview(overflowButton)
    stripView.addSubview(insertionIndicator)
    view = stripView
  }

  override func viewDidLayout() {
    super.viewDidLayout()
    applyLayout(animated: false)
  }

  func apply(
    snapshot: TerminalTabSurfaceSnapshot,
    palette: Palette,
    reduceMotion: Bool,
    actions: Actions
  ) {
    let topologyChanged =
      topologyRevision != nil
      && topologyRevision != snapshot.collection.topologyRevision
    let selectionChanged = selectedTabID != snapshot.collection.selectedTabID
    self.actions = actions
    self.snapshot = snapshot
    self.palette = palette
    self.reduceMotion = reduceMotion
    topologyRevision = snapshot.collection.topologyRevision
    selectedTabID = snapshot.collection.selectedTabID
    applyLayout(animated: topologyChanged)
    if selectionChanged, let selectedTabID = snapshot.collection.selectedTabID {
      animateSelectedEntrance(selectedTabID)
    }
  }

  func layoutDidChange() {
    guard lastLayoutWidth != stripView.bounds.width else { return }
    lastLayoutWidth = stripView.bounds.width
    applyLayout(animated: false)
  }

  private func applyLayout(animated: Bool) {
    guard let snapshot, let palette, isViewLoaded else { return }
    let nextLayout = TerminalHorizontalTabLayout(
      snapshot: snapshot,
      availableWidth: stripView.bounds.width,
      measureTitle: Self.measureTitle
    )
    let presentations = Self.presentations(snapshot: snapshot, palette: palette)
    let visibleGroupIDs = Set(nextLayout.groups.map(\.id))
    for groupID in groupViews.keys.filter({ !visibleGroupIDs.contains($0) }) {
      groupViews[groupID]?.removeFromSuperview()
      groupViews.removeValue(forKey: groupID)
    }
    for group in nextLayout.groups {
      guard let color = presentations[.group(group.id)]?.color else { continue }
      let groupView = groupViews[group.id] ?? makeGroupView(for: group.id)
      groupView.apply(color: color, isCollapsed: group.isCollapsed)
      setFrame(group.frame, of: groupView, animated: animated)
    }
    let visibleIDs = Set(nextLayout.items.map(\.entryID))
    for entryID in itemViews.keys.filter({ !visibleIDs.contains($0) }) {
      itemViews[entryID]?.removeFromSuperview()
      itemViews.removeValue(forKey: entryID)
    }
    for item in nextLayout.items {
      guard let presentation = presentations[item.entryID] else { continue }
      let itemView = itemViews[item.entryID] ?? makeItemView(for: item.entryID)
      itemView.apply(
        presentation,
        palette: palette,
        isSelected: presentation.tabID == snapshot.collection.selectedTabID
      )
      setFrame(item.frame, of: itemView, animated: animated)
    }
    layout = nextLayout
    newTabButton.frame = nextLayout.newTabFrame
    overflowButton.isHidden = nextLayout.overflowFrame == nil
    if let overflowFrame = nextLayout.overflowFrame {
      overflowButton.frame = overflowFrame
    }
    insertionIndicator.layer?.backgroundColor = NSColor(palette.accent).cgColor
    updateDropIndicator()
  }

  private func makeGroupView(for groupID: TerminalTabGroupID) -> TerminalHorizontalTabGroupView {
    let groupView = TerminalHorizontalTabGroupView()
    groupViews[groupID] = groupView
    stripView.addSubview(groupView, positioned: .below, relativeTo: nil)
    return groupView
  }

  private func makeItemView(for entryID: TerminalSidebarEntryID) -> TerminalHorizontalTabItemView {
    let itemView = TerminalHorizontalTabItemView()
    itemView.onPress = { [weak self] event in self?.pressed(entryID, event: event) }
    itemView.onDrag = { [weak self, weak itemView] event in
      guard let itemView else { return false }
      return self?.dragged(entryID, itemView: itemView, event: event) == true
    }
    itemView.onRelease = { [weak self] event in self?.released(entryID, event: event) }
    itemView.onClose = { [weak self] in self?.close(entryID) }
    itemView.onAccessibilityPress = { [weak self] in
      switch entryID {
      case .tab(let tabID):
        self?.actions?.selectTab(tabID)
      case .group(let groupID):
        self?.actions?.toggleGroup(groupID)
      case .pinDivider, .newTab:
        break
      }
    }
    itemViews[entryID] = itemView
    stripView.addSubview(itemView, positioned: .below, relativeTo: insertionIndicator)
    return itemView
  }

  private func pressed(_ entryID: TerminalSidebarEntryID, event: NSEvent) {
    guard event.clickCount == 1 else { return }
    pendingDrag = PendingDrag(
      entryID: entryID,
      origin: stripView.convert(event.locationInWindow, from: nil)
    )
    if case .tab(let tabID) = entryID {
      actions?.selectTab(tabID)
    }
  }

  private func dragged(
    _ entryID: TerminalSidebarEntryID,
    itemView: TerminalHorizontalTabItemView,
    event: NSEvent
  ) -> Bool {
    guard dragState == nil, let pendingDrag, pendingDrag.entryID == entryID else { return false }
    let location = stripView.convert(event.locationInWindow, from: nil)
    guard
      TerminalSidebarDragActivation.decision(origin: pendingDrag.origin, location: location)
        == .begin
    else { return false }
    self.pendingDrag = nil
    return beginDragging(entryID, itemView: itemView, event: event)
  }

  private func beginDragging(
    _ entryID: TerminalSidebarEntryID,
    itemView: TerminalHorizontalTabItemView,
    event: NSEvent
  ) -> Bool {
    guard let snapshot else { return false }
    let outline = TerminalSidebarOutline(snapshot: snapshot)
    guard
      let sidebarPayload = outline.dragPayload(for: entryID),
      let sharedPayload = TerminalTabDragPayload(
        operationID: sidebarPayload.operationID,
        sourceWindowID: windowControllerID,
        sourceSpaceID: snapshot.spaceID,
        sourceTopologyRevision: snapshot.collection.topologyRevision,
        itemIDs: sidebarPayload.source.itemIDs
      )
    else { return false }
    let sourceFrame = sourceFrame(for: entryID) ?? itemView.frame
    let sourceCenter = CGPoint(x: sourceFrame.midX, y: sourceFrame.midY)
    let screenPoint =
      stripView.window.map {
        $0.convertToScreen(CGRect(origin: event.locationInWindow, size: .zero)).origin
      } ?? .zero
    guard
      tabDragRegistry.begin(
        sharedPayload,
        previewContentSize: stripView.window?.frame.size,
        didTransfer: { [weak self] operationID, _ in
          guard self?.dragState?.payload.moveOperationID == operationID else { return }
          self?.dragState?.didTransfer = true
        }
      )
    else { return false }
    dragState = DragState(
      payload: sharedPayload,
      sourceCenter: sourceCenter,
      lastScreenPoint: screenPoint,
      lastTimestamp: event.timestamp
    )
    _ = tabDragRegistry.move(to: screenPoint, sourceSurfaceFrame: sourceSurfaceScreenFrame)
    let pasteboardItem = NSPasteboardItem()
    guard TerminalTabDragPasteboard.write(sharedPayload, to: pasteboardItem) else {
      finishDrag(outcome: .cancelled)
      return false
    }
    let draggingItem = NSDraggingItem(pasteboardWriter: pasteboardItem)
    draggingItem.setDraggingFrame(
      CGRect(origin: sourceFrame.origin, size: CGSize(width: 1, height: 1)),
      contents: nil
    )
    let session = stripView.beginDraggingSession(
      with: [draggingItem],
      event: event,
      source: self
    )
    session.draggingFormation = .none
    session.animatesToStartingPositionsOnCancelOrFail = false
    return true
  }

  private func released(_ entryID: TerminalSidebarEntryID, event: NSEvent) {
    guard dragState == nil else { return }
    guard pendingDrag?.entryID == entryID else { return }
    pendingDrag = nil
    switch entryID {
    case .tab:
      break
    case .group(let groupID):
      let location = stripView.convert(event.locationInWindow, from: nil)
      if itemViews[entryID]?.frame.contains(location) == true {
        actions?.toggleGroup(groupID)
      }
    case .pinDivider, .newTab:
      break
    }
  }

  private func sourceFrame(for entryID: TerminalSidebarEntryID) -> CGRect? {
    guard case .group(let groupID) = entryID else { return itemViews[entryID]?.frame }
    return layout?.groups.first { $0.id == groupID }?.frame
  }

  fileprivate func pointerTarget(at point: CGPoint) -> NSView? {
    guard
      let item = layout?.items.first(where: { $0.frame.contains(point) }),
      let itemView = itemViews[item.entryID]
    else { return nil }
    return itemView.pointerTarget(at: itemView.convert(point, from: stripView))
  }

  private func close(_ entryID: TerminalSidebarEntryID) {
    guard case .tab(let tabID) = entryID else { return }
    actions?.closeTab(tabID)
  }

  private func configureButton(_ button: NSButton, symbol: String, action: Selector) {
    button.bezelStyle = .inline
    button.isBordered = false
    button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
    button.imagePosition = .imageOnly
    button.target = self
    button.action = action
  }

  @objc private func createTab() {
    actions?.newTab()
  }

  @objc private func showOverflow() {
    guard let snapshot else { return }
    guard let layout else { return }
    let hidden = Set(layout.hiddenEntryIDs)
    let menu = NSMenu()
    for root in snapshot.collection.rootItems {
      switch root {
      case .tab(let item) where hidden.contains(.tab(item.tab.id)):
        menu.addItem(menuItem(title: item.tab.title, tabID: item.tab.id))
      case .group(let group):
        if hidden.contains(.group(group.id)) {
          let item = NSMenuItem(
            title: group.title,
            action: #selector(toggleOverflowGroup(_:)),
            keyEquivalent: ""
          )
          item.target = self
          item.representedObject = group.id.rawValue
          menu.addItem(item)
        }
        for tab in group.tabs where hidden.contains(.tab(tab.id)) {
          menu.addItem(menuItem(title: tab.title, tabID: tab.id))
        }
      default:
        break
      }
    }
    menu.popUp(
      positioning: nil,
      at: CGPoint(x: overflowButton.frame.minX, y: overflowButton.frame.minY),
      in: stripView
    )
  }

  private func menuItem(title: String, tabID: TerminalTabID) -> NSMenuItem {
    let item = NSMenuItem(title: title, action: #selector(selectOverflowTab(_:)), keyEquivalent: "")
    item.target = self
    item.representedObject = tabID.rawValue
    item.state = tabID == snapshot?.collection.selectedTabID ? .on : .off
    return item
  }

  @objc private func selectOverflowTab(_ sender: NSMenuItem) {
    guard let id = sender.representedObject as? UUID else { return }
    actions?.selectTab(TerminalTabID(rawValue: id))
  }

  @objc private func toggleOverflowGroup(_ sender: NSMenuItem) {
    guard let id = sender.representedObject as? UUID else { return }
    actions?.toggleGroup(TerminalTabGroupID(rawValue: id))
  }

  func draggingUpdated(_ info: any NSDraggingInfo) -> NSDragOperation {
    guard
      let snapshot,
      let payload = tabDragRegistry.resolve(info.draggingPasteboard),
      let stamp = TerminalSidebarOutline(snapshot: snapshot).topologyStamp,
      let layout,
      let sidebarPayload = payload.sidebarPayload(topologyStamp: stamp)
    else {
      clearDropTarget()
      return []
    }
    let point = stripView.convert(info.draggingLocation, from: nil)
    let resolution = TerminalSidebarDropResolution(
      payload: sidebarPayload,
      path: layout.semanticPath(at: point),
      outline: TerminalSidebarOutline(snapshot: snapshot)
    )
    dropPlan = resolution.plan
    updateDropIndicator()
    guard resolution.plan != nil else { return [] }
    info.numberOfValidItemsForDrop = 1
    return .move
  }

  func draggingExited() {
    clearDropTarget()
  }

  func prepareForDragOperation(_ info: any NSDraggingInfo) -> Bool {
    dropPlan != nil && tabDragRegistry.resolve(info.draggingPasteboard) != nil
  }

  func performDragOperation(_ info: any NSDraggingInfo) -> Bool {
    guard
      let snapshot,
      let payload = tabDragRegistry.resolve(info.draggingPasteboard),
      let stamp = TerminalSidebarOutline(snapshot: snapshot).topologyStamp,
      let plan = dropPlan,
      let sidebarPayload = payload.sidebarPayload(topologyStamp: stamp),
      let command = plan.command(for: sidebarPayload)
    else {
      clearDropTarget()
      return false
    }
    let result = tabDragRegistry.performTransfer(
      payload,
      to: TerminalTabDragRegistry.Destination(
        windowControllerID: windowControllerID,
        spaceID: snapshot.spaceID,
        expectedTopologyRevision: command.topologyStamp.revision,
        placement: command.destination
      )
    )
    if result != nil {
      animateDropSettlement(path: plan.path)
    }
    clearDropTarget()
    return result != nil
  }

  private func updateDropIndicator() {
    guard
      let path = dropPlan?.path,
      let frame = layout?.indicatorFrame(for: path)
    else {
      insertionIndicator.isHidden = true
      return
    }
    insertionIndicator.frame = frame
    insertionIndicator.isHidden = false
  }

  private func clearDropTarget() {
    dropPlan = nil
    insertionIndicator.isHidden = true
  }

  func draggingSession(
    _ session: NSDraggingSession,
    sourceOperationMaskFor context: NSDraggingContext
  ) -> NSDragOperation {
    [.copy, .move]
  }

  func draggingSession(_ session: NSDraggingSession, movedTo screenPoint: NSPoint) {
    guard var dragState else { return }
    let timestamp = ProcessInfo.processInfo.systemUptime
    let elapsed = max(1 / 240, timestamp - dragState.lastTimestamp)
    dragState.velocity = CGVector(
      dx: (screenPoint.x - dragState.lastScreenPoint.x) / elapsed,
      dy: (screenPoint.y - dragState.lastScreenPoint.y) / elapsed
    )
    dragState.lastScreenPoint = screenPoint
    dragState.lastTimestamp = timestamp
    self.dragState = dragState
    _ = tabDragRegistry.move(to: screenPoint, sourceSurfaceFrame: sourceSurfaceScreenFrame)
  }

  func draggingSession(
    _ session: NSDraggingSession,
    endedAt screenPoint: NSPoint,
    operation: NSDragOperation
  ) {
    guard let dragState else { return }
    finishDrag(outcome: dragState.didTransfer ? .moved : .cancelled)
  }

  private var sourceSurfaceScreenFrame: CGRect {
    guard let window = stripView.window else { return .null }
    return window.convertToScreen(stripView.convert(stripView.bounds, to: nil))
  }

  private func finishDrag(outcome: TerminalTabDragRegistry.Outcome) {
    guard let dragState else { return }
    tabDragRegistry.finish(operationID: dragState.payload.moveOperationID, outcome: outcome)
    self.dragState = nil
    clearDropTarget()
  }

  private func setFrame(_ frame: CGRect, of itemView: NSView, animated: Bool) {
    guard animated, !reduceMotion, itemView.window != nil, let layer = itemView.layer else {
      layerWithoutActions { itemView.frame = frame }
      return
    }
    let oldPosition = layer.presentation()?.position ?? layer.position
    let oldBounds = layer.presentation()?.bounds ?? layer.bounds
    layerWithoutActions { itemView.frame = frame }
    if oldPosition != layer.position {
      let animation = CASpringAnimation(keyPath: "position")
      animation.fromValue = NSValue(point: oldPosition)
      animation.toValue = NSValue(point: layer.position)
      animation.mass = 1
      animation.stiffness = pow(2 * Double.pi / 0.25, 2)
      animation.damping = 2 * 0.88 * sqrt(animation.stiffness)
      animation.duration = min(0.5, animation.settlingDuration)
      layer.add(animation, forKey: "horizontalTabPosition")
    }
    if oldBounds != layer.bounds {
      let animation = CABasicAnimation(keyPath: "bounds")
      animation.fromValue = NSValue(rect: oldBounds)
      animation.toValue = NSValue(rect: layer.bounds)
      animation.duration = 0.12
      animation.timingFunction = CAMediaTimingFunction(name: .easeOut)
      layer.add(animation, forKey: "horizontalTabBounds")
    }
  }

  private func animateSelectedEntrance(_ tabID: TerminalTabID) {
    guard !reduceMotion, let layer = itemViews[.tab(tabID)]?.layer else { return }
    let animation = CASpringAnimation(keyPath: "transform.scale")
    animation.fromValue = 0.98
    animation.toValue = 1
    animation.mass = 1
    animation.stiffness = pow(2 * Double.pi / 0.05, 2)
    animation.damping = 2 * sqrt(animation.stiffness)
    animation.duration = min(0.15, animation.settlingDuration)
    layer.add(animation, forKey: "horizontalTabSelectedEntrance")
  }

  private func animateDropSettlement(path: TerminalSidebarSemanticPath) {
    guard
      !reduceMotion,
      let dragState,
      let indicator = layout?.indicatorFrame(for: path),
      let sourceView = itemViews.first(where: { entryID, _ in
        dragState.payload.itemIDs.contains {
          switch ($0, entryID) {
          case (.tab(let first), .tab(let second)): first == second
          case (.group(let first), .group(let second)): first == second
          default: false
          }
        }
      })?.value,
      let layer = sourceView.layer
    else { return }
    let target = CGPoint(x: indicator.midX, y: sourceView.frame.midY)
    let motion = TerminalHorizontalDropMotion(
      source: dragState.sourceCenter,
      target: target,
      velocity: dragState.velocity
    )
    let position = CAKeyframeAnimation(keyPath: "position")
    position.values = motion.positions.map { NSValue(point: $0) }
    position.keyTimes = motion.keyTimes
    position.timingFunctions = [
      CAMediaTimingFunction(name: .easeOut),
      CAMediaTimingFunction(name: .easeIn),
      CAMediaTimingFunction(name: .easeOut),
      CAMediaTimingFunction(name: .easeInEaseOut),
    ]
    position.duration = 0.25
    layer.add(position, forKey: "horizontalTabDropPosition")

    let transform = CASpringAnimation(keyPath: "transform.scale")
    transform.fromValue = 1.03
    transform.toValue = 1
    transform.mass = 1
    transform.stiffness = pow(2 * Double.pi / 0.25, 2)
    transform.damping = 2 * 0.65 * sqrt(transform.stiffness)
    transform.duration = min(0.5, transform.settlingDuration)
    layer.add(transform, forKey: "horizontalTabDropTransform")
  }

  private func layerWithoutActions(_ apply: () -> Void) {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    apply()
    CATransaction.commit()
  }

  fileprivate struct ItemPresentation {
    let color: NSColor?
    let isCollapsed: Bool
    let isDirty: Bool
    let tabID: TerminalTabID?
    let title: String
  }

  private static func presentations(
    snapshot: TerminalTabSurfaceSnapshot,
    palette: Palette
  ) -> [TerminalSidebarEntryID: ItemPresentation] {
    var result: [TerminalSidebarEntryID: ItemPresentation] = [:]
    for root in snapshot.collection.rootItems {
      switch root {
      case .tab(let item):
        result[.tab(item.tab.id)] = ItemPresentation(
          color: nil,
          isCollapsed: false,
          isDirty: item.tab.isDirty,
          tabID: item.tab.id,
          title: item.tab.title
        )
      case .group(let group):
        result[.group(group.id)] = ItemPresentation(
          color: group.color.sidebarNSColor(palette: palette),
          isCollapsed: snapshot.collapsedGroupIDs.contains(group.id),
          isDirty: false,
          tabID: nil,
          title: group.title
        )
        for tab in group.tabs {
          result[.tab(tab.id)] = ItemPresentation(
            color: nil,
            isCollapsed: false,
            isDirty: tab.isDirty,
            tabID: tab.id,
            title: tab.title
          )
        }
      }
    }
    return result
  }

  private static func measureTitle(_ title: String) -> CGFloat {
    (title as NSString).size(withAttributes: [.font: NSFont.systemFont(ofSize: 12)]).width
  }
}

@MainActor
private final class TerminalHorizontalTabStripView: NSView {
  weak var controller: TerminalHorizontalTabStripController?

  override var isFlipped: Bool { true }

  override var mouseDownCanMoveWindow: Bool { false }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func hitTest(_ point: NSPoint) -> NSView? {
    controller?.pointerTarget(at: point) ?? super.hitTest(point)
  }

  override func mouseDown(with event: NSEvent) {
    window?.performDrag(with: event)
  }

  override func layout() {
    super.layout()
    controller?.layoutDidChange()
  }

  override func draggingEntered(_ sender: any NSDraggingInfo) -> NSDragOperation {
    controller?.draggingUpdated(sender) ?? []
  }

  override func draggingUpdated(_ sender: any NSDraggingInfo) -> NSDragOperation {
    controller?.draggingUpdated(sender) ?? []
  }

  override func draggingExited(_ sender: (any NSDraggingInfo)?) {
    controller?.draggingExited()
  }

  override func prepareForDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    sender.animatesToDestination = false
    return controller?.prepareForDragOperation(sender) == true
  }

  override func performDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    controller?.performDragOperation(sender) == true
  }
}

@MainActor
private final class TerminalHorizontalTabGroupView: NSView {
  private let fillLayer = CAShapeLayer()
  private let strokeLayer = CAShapeLayer()
  private var isCollapsed = false

  init() {
    super.init(frame: .zero)
    wantsLayer = true
    layer?.addSublayer(fillLayer)
    layer?.addSublayer(strokeLayer)
    fillLayer.fillColor = NSColor.clear.cgColor
    strokeLayer.fillColor = NSColor.clear.cgColor
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func layout() {
    super.layout()
    let scale = window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2
    let lineWidth = 1 / scale
    let radius: CGFloat = isCollapsed ? 8 : 10
    let path = CGPath(
      roundedRect: bounds.insetBy(dx: lineWidth / 2, dy: lineWidth / 2),
      cornerWidth: radius,
      cornerHeight: radius,
      transform: nil
    )
    fillLayer.frame = bounds
    fillLayer.path = path
    strokeLayer.frame = bounds
    strokeLayer.path = path
    strokeLayer.lineWidth = lineWidth
  }

  func apply(color: NSColor, isCollapsed: Bool) {
    self.isCollapsed = isCollapsed
    fillLayer.fillColor = color.withAlphaComponent(isCollapsed ? 0.22 : 0.16).cgColor
    strokeLayer.strokeColor = color.withAlphaComponent(isCollapsed ? 0.52 : 0.38).cgColor
    needsLayout = true
  }
}

@MainActor
final class TerminalHorizontalTabItemView: NSView {
  var onAccessibilityPress: (() -> Void)?
  var onPress: ((NSEvent) -> Void)?
  var onDrag: ((NSEvent) -> Bool)?
  var onRelease: ((NSEvent) -> Void)?
  var onClose: (() -> Void)?

  private let label = NSTextField(labelWithString: "")
  private let closeButton = NSButton()
  private let groupDisclosure = NSImageView()
  private var isTrackingPress = false
  private var trackingArea: NSTrackingArea?
  private var isHovered = false
  private var isSelected = false
  private var isGroup = false
  private var palette: Palette?

  init() {
    super.init(frame: .zero)
    wantsLayer = true
    layer?.cornerRadius = 7
    label.font = .systemFont(ofSize: 12, weight: .medium)
    label.lineBreakMode = .byTruncatingTail
    label.maximumNumberOfLines = 1
    label.setAccessibilityElement(false)
    addSubview(label)
    closeButton.bezelStyle = .inline
    closeButton.isBordered = false
    closeButton.image = NSImage(systemSymbolName: "xmark", accessibilityDescription: nil)
    closeButton.imagePosition = .imageOnly
    closeButton.target = self
    closeButton.action = #selector(close)
    closeButton.setAccessibilityLabel("Close Tab")
    addSubview(closeButton)
    groupDisclosure.imageScaling = .scaleProportionallyDown
    groupDisclosure.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 9, weight: .semibold)
    groupDisclosure.setAccessibilityElement(false)
    addSubview(groupDisclosure)
    setAccessibilityElement(true)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  override var mouseDownCanMoveWindow: Bool { false }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func hitTest(_ point: NSPoint) -> NSView? {
    guard bounds.contains(point) else { return nil }
    return pointerTarget(at: point)
  }

  fileprivate func pointerTarget(at point: NSPoint) -> NSView {
    if !closeButton.isHidden, closeButton.frame.contains(point) {
      return closeButton
    }
    return self
  }

  override func accessibilityPerformPress() -> Bool {
    guard let onAccessibilityPress else { return false }
    onAccessibilityPress()
    return true
  }

  override func updateTrackingAreas() {
    if let trackingArea { removeTrackingArea(trackingArea) }
    let trackingArea = NSTrackingArea(
      rect: .zero,
      options: [.activeInKeyWindow, .inVisibleRect, .mouseEnteredAndExited],
      owner: self
    )
    addTrackingArea(trackingArea)
    self.trackingArea = trackingArea
    super.updateTrackingAreas()
  }

  override func mouseEntered(with event: NSEvent) {
    isHovered = true
    updateAppearance()
  }

  override func mouseExited(with event: NSEvent) {
    isHovered = false
    updateAppearance()
  }

  override func mouseDown(with event: NSEvent) {
    isTrackingPress = true
    onPress?(event)
  }

  override func mouseDragged(with event: NSEvent) {
    guard isTrackingPress else { return }
    if onDrag?(event) == true {
      isTrackingPress = false
    }
  }

  override func mouseUp(with event: NSEvent) {
    guard isTrackingPress else { return }
    isTrackingPress = false
    onRelease?(event)
  }

  override func viewWillMove(toWindow newWindow: NSWindow?) {
    if newWindow == nil {
      isTrackingPress = false
    }
    super.viewWillMove(toWindow: newWindow)
  }

  override func layout() {
    super.layout()
    let disclosureWidth: CGFloat = isGroup ? 12 : 0
    groupDisclosure.frame = CGRect(
      x: 7,
      y: (bounds.height - 16) / 2,
      width: disclosureWidth,
      height: 16
    )
    let closeWidth: CGFloat = isGroup ? 0 : 22
    closeButton.frame = CGRect(
      x: bounds.maxX - closeWidth - 3,
      y: (bounds.height - 22) / 2,
      width: closeWidth,
      height: 22
    )
    label.frame = CGRect(
      x: isGroup ? 23 : 9,
      y: 0,
      width: max(0, bounds.width - (isGroup ? 30 : closeWidth + 14)),
      height: bounds.height
    )
  }

  fileprivate func apply(
    _ presentation: TerminalHorizontalTabStripController.ItemPresentation,
    palette: Palette,
    isSelected: Bool
  ) {
    self.palette = palette
    self.isSelected = isSelected
    isGroup = presentation.tabID == nil
    label.stringValue = presentation.title + (presentation.isDirty ? " •" : "")
    groupDisclosure.image = NSImage(
      systemSymbolName: presentation.isCollapsed ? "chevron.right" : "chevron.down",
      accessibilityDescription: nil
    )
    groupDisclosure.contentTintColor = presentation.color
    closeButton.isHidden = isGroup || (!isHovered && !isSelected)
    setAccessibilityRole(isGroup ? .disclosureTriangle : .radioButton)
    setAccessibilityLabel(isGroup ? "Tab Group \(presentation.title)" : presentation.title)
    setAccessibilityValue(
      isGroup ? (presentation.isCollapsed ? "Collapsed" : "Expanded") : isSelected ? "selected" : nil
    )
    setAccessibilityHelp(
      isGroup
        ? (presentation.isCollapsed ? "Expand Tab Group" : "Collapse Tab Group")
        : "Select Tab"
    )
    needsLayout = true
    updateAppearance()
  }

  private func updateAppearance() {
    guard let palette else { return }
    label.textColor = NSColor(isSelected ? palette.selectedText : palette.primaryText)
    closeButton.contentTintColor = NSColor(
      isSelected ? palette.selectedSecondaryText : palette.secondaryText
    )
    let fill: NSColor =
      if isSelected {
        NSColor(palette.selectedFill)
      } else if isHovered {
        NSColor(palette.unselectedFill)
      } else {
        .clear
      }
    layer?.backgroundColor = fill.cgColor
    closeButton.isHidden = isGroup || (!isHovered && !isSelected)
  }

  @objc private func close() {
    onClose?()
  }
}

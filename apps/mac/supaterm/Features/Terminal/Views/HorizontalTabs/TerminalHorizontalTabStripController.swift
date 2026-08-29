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

  private let windowControllerID: UUID
  private let tabDragRegistry: TerminalTabDragRegistry
  private let stripView = TerminalHorizontalTabStripView()
  private let newTabButton = NSButton()
  private let overflowButton = NSButton()
  private let insertionIndicator = NSView()
  private var actions: Actions?
  private var itemViews: [TerminalSidebarEntryID: TerminalHorizontalTabItemView] = [:]
  private var layout: TerminalHorizontalTabLayout?
  private var lastLayoutWidth: CGFloat?
  private var snapshot: TerminalTabSurfaceSnapshot?
  private var palette: Palette?
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

  private func makeItemView(for entryID: TerminalSidebarEntryID) -> TerminalHorizontalTabItemView {
    let itemView = TerminalHorizontalTabItemView()
    itemView.onPress = { [weak self] event in self?.pressed(entryID, event: event) }
    itemView.onDrag = { [weak self, weak itemView] event in
      guard let itemView else { return }
      self?.dragged(entryID, itemView: itemView, event: event)
    }
    itemView.onRelease = { [weak self] in self?.released(entryID) }
    itemView.onClose = { [weak self] in self?.close(entryID) }
    itemViews[entryID] = itemView
    stripView.addSubview(itemView, positioned: .below, relativeTo: insertionIndicator)
    return itemView
  }

  private func pressed(_ entryID: TerminalSidebarEntryID, event: NSEvent) {
    guard event.clickCount == 1 else { return }
    if case .tab(let tabID) = entryID {
      actions?.selectTab(tabID)
    }
  }

  private func dragged(
    _ entryID: TerminalSidebarEntryID,
    itemView: TerminalHorizontalTabItemView,
    event: NSEvent
  ) {
    guard dragState == nil, let snapshot else { return }
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
    else { return }
    let sourceCenter = CGPoint(x: itemView.frame.midX, y: itemView.frame.midY)
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
    else { return }
    dragState = DragState(
      payload: sharedPayload,
      sourceCenter: sourceCenter,
      lastScreenPoint: screenPoint,
      lastTimestamp: event.timestamp
    )
    let pasteboardItem = NSPasteboardItem()
    guard TerminalTabDragPasteboard.write(sharedPayload, to: pasteboardItem) else {
      finishDrag(outcome: .cancelled)
      return
    }
    let draggingItem = NSDraggingItem(pasteboardWriter: pasteboardItem)
    draggingItem.setDraggingFrame(
      CGRect(origin: itemView.frame.origin, size: CGSize(width: 1, height: 1)),
      contents: nil
    )
    let session = stripView.beginDraggingSession(
      with: [draggingItem],
      event: event,
      source: self
    )
    session.draggingFormation = .none
    session.animatesToStartingPositionsOnCancelOrFail = false
  }

  private func released(_ entryID: TerminalSidebarEntryID) {
    guard dragState == nil else { return }
    switch entryID {
    case .tab:
      break
    case .group(let groupID):
      actions?.toggleGroup(groupID)
    case .pinDivider, .newTab:
      break
    }
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
    .move
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
private final class TerminalHorizontalTabItemView: NSView {
  var onPress: ((NSEvent) -> Void)?
  var onDrag: ((NSEvent) -> Void)?
  var onRelease: (() -> Void)?
  var onClose: (() -> Void)?

  private let label = NSTextField(labelWithString: "")
  private let closeButton = NSButton()
  private let groupDot = NSView()
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
    groupDot.wantsLayer = true
    groupDot.layer?.cornerRadius = 3
    groupDot.setAccessibilityElement(false)
    addSubview(groupDot)
    setAccessibilityElement(true)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  override var mouseDownCanMoveWindow: Bool { false }

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
    onPress?(event)
  }

  override func mouseDragged(with event: NSEvent) {
    onDrag?(event)
  }

  override func mouseUp(with event: NSEvent) {
    onRelease?()
  }

  override func layout() {
    super.layout()
    let dotWidth: CGFloat = isGroup ? 6 : 0
    groupDot.frame = CGRect(x: 8, y: (bounds.height - 6) / 2, width: dotWidth, height: 6)
    let closeWidth: CGFloat = isGroup ? 0 : 22
    closeButton.frame = CGRect(
      x: bounds.maxX - closeWidth - 3,
      y: (bounds.height - 22) / 2,
      width: closeWidth,
      height: 22
    )
    label.frame = CGRect(
      x: isGroup ? 20 : 9,
      y: 0,
      width: max(0, bounds.width - (isGroup ? 27 : closeWidth + 14)),
      height: bounds.height
    )
  }

  func apply(
    _ presentation: TerminalHorizontalTabStripController.ItemPresentation,
    palette: Palette,
    isSelected: Bool
  ) {
    self.palette = palette
    self.isSelected = isSelected
    isGroup = presentation.tabID == nil
    label.stringValue = presentation.title + (presentation.isDirty ? " •" : "")
    groupDot.layer?.backgroundColor = presentation.color?.cgColor
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

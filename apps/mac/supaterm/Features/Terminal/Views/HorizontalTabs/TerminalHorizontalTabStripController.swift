import AppKit
import QuartzCore
import SupaTheme
import SwiftUI

private enum TerminalHorizontalTabTypography {
  static var titleFont: NSFont { .systemFont(ofSize: 12, weight: .medium) }
}

@MainActor
final class TerminalHorizontalTabStripController: NSViewController {
  struct Actions {
    let closeTab: (TerminalTabID) -> Void
    let newTab: () -> Void
    let selectTab: (TerminalTabID) -> Void
    let toggleGroup: (TerminalTabGroupID) -> Void
    let performDrop: (TerminalSidebarDropCommand) -> TerminalSidebarDropReceipt?
  }

  private let windowControllerID: UUID
  private let tabDragRegistry: TerminalTabDragRegistry
  private let nativeDragStart: TerminalTabNativeDragSession.NativeStart
  private let captureRequest: () -> TerminalWindowCaptureRequest?
  private let stripView = TerminalHorizontalTabStripView()
  private let newTabButton = NSButton()
  private let overflowButton = NSButton()
  private let sectionSeparator = NSView()
  private let insertionIndicator = NSView()
  private var actions: Actions?
  private var groupViews: [TerminalTabGroupID: TerminalHorizontalTabGroupView] = [:]
  private var itemViews: [TerminalSidebarEntryID: TerminalHorizontalTabItemView] = [:]
  private var layout: TerminalHorizontalTabLayout?
  private var lastLayoutWidth: CGFloat?
  private var snapshot: TerminalTabSurfaceSnapshot?
  private var pendingSnapshot: TerminalTabSurfaceSnapshot?
  private var palette: Palette?
  private var reduceMotion = false
  private var dropPlan: TerminalSidebarDropPlan?
  private var liveSelectedTabID: TerminalTabID?

  private lazy var dragController = TerminalHorizontalTabDragController(
    configuration: TerminalHorizontalTabDragController.Configuration(
      sourceView: stripView,
      draggingSource: stripView,
      windowControllerID: windowControllerID,
      tabDragRegistry: tabDragRegistry,
      nativeStart: nativeDragStart,
      captureRequest: captureRequest,
      snapshot: { [weak self] in self?.snapshot },
      layout: { [weak self] in self?.layout },
      reduceMotion: { [weak self] in self?.reduceMotion == true },
      liveSelectedTabID: { [weak self] in self?.liveSelectedTabID },
      selectTab: { [weak self] tabID in self?.selectLiveTab(tabID) },
      toggleGroup: { [weak self] groupID in self?.actions?.toggleGroup(groupID) },
      performDrop: { [weak self] command in self?.actions?.performDrop(command) },
      sourceViews: { [weak self] source in self?.sourceViews(for: source) ?? [] },
      setDropPlan: { [weak self] plan in self?.setDropPlan(plan) },
      projectionReleased: { [weak self] in self?.releaseDragProjection() }
    )
  )

  init(
    windowControllerID: UUID,
    tabDragRegistry: TerminalTabDragRegistry,
    captureRequest: @escaping () -> TerminalWindowCaptureRequest?,
    nativeDragStart: TerminalTabNativeDragSession.NativeStart = .live
  ) {
    self.windowControllerID = windowControllerID
    self.tabDragRegistry = tabDragRegistry
    self.captureRequest = captureRequest
    self.nativeDragStart = nativeDragStart
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
    sectionSeparator.wantsLayer = true
    sectionSeparator.layer?.cornerRadius = 0.5
    sectionSeparator.isHidden = true
    sectionSeparator.setAccessibilityElement(false)
    stripView.addSubview(newTabButton)
    stripView.addSubview(overflowButton)
    stripView.addSubview(sectionSeparator)
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
    self.actions = actions
    self.palette = palette
    self.reduceMotion = reduceMotion
    liveSelectedTabID = snapshot.collection.selectedTabID
    if dragController.receive(snapshot) {
      pendingSnapshot = snapshot
      return
    }
    pendingSnapshot = nil
    present(snapshot)
  }

  func cancelInteractions() {
    dragController.cancelInteractions()
  }

  var dragSourcePhase: TerminalHorizontalTabDragSourcePhase {
    dragController.sourcePhase
  }

  var dragCoordinatorPhase: TerminalSidebarDragCoordinator.Phase? {
    dragController.activeCoordinatorPhase
  }

  var dragActivePayload: TerminalTabDragPayload? {
    dragController.activePayload
  }

  var dragSourceHoldScreenFrame: CGRect {
    dragController.sourceHoldScreenFrame
  }

  var dragCleanupCount: Int {
    dragController.cleanupCount
  }

  var hasDragSourcePlaceholder: Bool {
    dragController.hasSourcePlaceholder
  }

  var dragHiddenSourceViewCount: Int {
    dragController.hiddenSourceViewCount
  }

  func dragSourceFrame(for entryID: TerminalSidebarEntryID) -> CGRect? {
    layout?.dragSourceFrame(for: entryID)
  }

  func dragItemFrame(for entryID: TerminalSidebarEntryID) -> CGRect? {
    layout?.items.first { $0.entryID == entryID }?.frame
  }

  func beginPointerInteraction(
    entryID: TerminalSidebarEntryID,
    at location: CGPoint,
    modifiers: NSEvent.ModifierFlags = [],
    clickCount: Int = 1
  ) {
    dragController.press(
      entryID: entryID,
      location: location,
      modifiers: modifiers,
      clickCount: clickCount
    )
  }

  func continuePointerInteraction(
    entryID: TerminalSidebarEntryID,
    to location: CGPoint,
    screenPoint: CGPoint,
    nativeEvent: NSEvent? = nil
  ) -> Bool {
    dragController.drag(
      entryID: entryID,
      location: location,
      screenPoint: screenPoint,
      nativeEvent: nativeEvent
    )
  }

  func endPointerInteraction(
    entryID: TerminalSidebarEntryID,
    at location: CGPoint
  ) {
    dragController.release(entryID: entryID, location: location)
  }

  func layoutDidChange() {
    guard lastLayoutWidth != stripView.bounds.width else { return }
    lastLayoutWidth = stripView.bounds.width
    applyLayout(animated: false)
  }

  private func present(_ snapshot: TerminalTabSurfaceSnapshot) {
    let topologyChanged = self.snapshot.map {
      $0.collection.topologyRevision != snapshot.collection.topologyRevision
    } == true
    let selectionChanged = self.snapshot?.collection.selectedTabID
      != snapshot.collection.selectedTabID
    self.snapshot = snapshot
    applyLayout(animated: topologyChanged)
    if selectionChanged, let selectedTabID = snapshot.collection.selectedTabID {
      animateSelectedEntrance(selectedTabID)
    }
  }

  private func releaseDragProjection() {
    guard let pendingSnapshot else {
      applyLayout(animated: false)
      return
    }
    self.pendingSnapshot = nil
    present(pendingSnapshot)
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
    if let separatorFrame = nextLayout.sectionSeparatorFrame {
      sectionSeparator.frame = CGRect(
        x: separatorFrame.midX - 0.5,
        y: separatorFrame.minY + 7,
        width: 1,
        height: separatorFrame.height - 14
      )
      sectionSeparator.isHidden = false
    } else {
      sectionSeparator.isHidden = true
    }
    sectionSeparator.layer?.backgroundColor = NSColor(palette.sidebarSeparator).cgColor
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
    itemView.onDrag = { [weak self] event in
      self?.dragged(entryID, event: event) == true
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
    beginPointerInteraction(
      entryID: entryID,
      at: stripView.convert(event.locationInWindow, from: nil),
      modifiers: event.modifierFlags,
      clickCount: event.clickCount
    )
  }

  private func dragged(
    _ entryID: TerminalSidebarEntryID,
    event: NSEvent
  ) -> Bool {
    let location = stripView.convert(event.locationInWindow, from: nil)
    let screenPoint =
      event.window.map {
        $0.convertPoint(toScreen: event.locationInWindow)
      } ?? location
    return continuePointerInteraction(
      entryID: entryID,
      to: location,
      screenPoint: screenPoint,
      nativeEvent: event
    )
  }

  private func released(_ entryID: TerminalSidebarEntryID, event: NSEvent) {
    endPointerInteraction(
      entryID: entryID,
      at: stripView.convert(event.locationInWindow, from: nil)
    )
  }

  private func sourceViews(for source: TerminalSidebarDragSource) -> [NSView] {
    guard let snapshot else { return [] }
    let entryIDs = TerminalSidebarOutline(snapshot: snapshot).liftedEntryIDs(for: source)
    var views: [NSView] = entryIDs.compactMap { itemViews[$0] }
    if case .group(let groupID) = source, let groupView = groupViews[groupID] {
      views.insert(groupView, at: 0)
    }
    return views
  }

  private func selectLiveTab(_ tabID: TerminalTabID) {
    liveSelectedTabID = tabID
    actions?.selectTab(tabID)
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
    guard let payload = tabDragRegistry.resolve(info.draggingPasteboard) else {
      dragController.draggingExited()
      return []
    }
    let point = stripView.convert(info.draggingLocation, from: nil)
    let operation = updateDrop(payload, at: point)
    if operation == .move {
      info.numberOfValidItemsForDrop = 1
    }
    return operation
  }

  func updateDrop(
    _ payload: TerminalTabDragPayload,
    at point: CGPoint
  ) -> NSDragOperation {
    dragController.updateDrop(payload, at: point)
  }

  func draggingExited() {
    dragController.draggingExited()
  }

  func destinationDraggingEnded() {
    dragController.destinationDraggingEnded()
  }

  func prepareForDragOperation(_ info: any NSDraggingInfo) -> Bool {
    guard let payload = tabDragRegistry.resolve(info.draggingPasteboard) else { return false }
    return prepareDrop(payload)
  }

  func prepareDrop(_ payload: TerminalTabDragPayload) -> Bool {
    dragController.prepareDrop(payload)
  }

  func performDragOperation(_ info: any NSDraggingInfo) -> Bool {
    guard let payload = tabDragRegistry.resolve(info.draggingPasteboard) else {
      dragController.draggingExited()
      return false
    }
    return performDrop(payload)
  }

  func performDrop(_ payload: TerminalTabDragPayload) -> Bool {
    dragController.performDrop(payload)
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

  private func setDropPlan(_ plan: TerminalSidebarDropPlan?) {
    dropPlan = plan
    updateDropIndicator()
  }

  func sourceOperationMask() -> NSDragOperation {
    [.copy, .move]
  }

  func sourceSessionMoved(to screenPoint: CGPoint) {
    dragController.sourceSessionMoved(to: screenPoint)
  }

  func sourceSessionEnded(operation: NSDragOperation) {
    dragController.sourceSessionEnded(operation: operation)
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
    let label = NSTextField(labelWithString: title)
    label.font = TerminalHorizontalTabTypography.titleFont
    label.lineBreakMode = .byTruncatingTail
    label.maximumNumberOfLines = 1
    return ceil(label.fittingSize.width)
  }
}

@MainActor
private final class TerminalHorizontalTabStripView: NSView, NSDraggingSource {
  weak var controller: TerminalHorizontalTabStripController?

  override var isFlipped: Bool { true }

  override var mouseDownCanMoveWindow: Bool { false }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func hitTest(_ point: NSPoint) -> NSView? {
    let localPoint = localHitTestPoint(point)
    return controller?.pointerTarget(at: localPoint) ?? super.hitTest(point)
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

  override func draggingEnded(_ sender: any NSDraggingInfo) {
    controller?.destinationDraggingEnded()
  }

  override func prepareForDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    sender.animatesToDestination = false
    return controller?.prepareForDragOperation(sender) == true
  }

  override func performDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    controller?.performDragOperation(sender) == true
  }

  func draggingSession(
    _ session: NSDraggingSession,
    sourceOperationMaskFor context: NSDraggingContext
  ) -> NSDragOperation {
    controller?.sourceOperationMask() ?? []
  }

  func draggingSession(_ session: NSDraggingSession, movedTo screenPoint: NSPoint) {
    controller?.sourceSessionMoved(to: screenPoint)
  }

  func draggingSession(
    _ session: NSDraggingSession,
    endedAt screenPoint: NSPoint,
    operation: NSDragOperation
  ) {
    controller?.sourceSessionEnded(operation: operation)
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
    label.font = TerminalHorizontalTabTypography.titleFont
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
    groupDisclosure.symbolConfiguration = NSImage.SymbolConfiguration(
      pointSize: 9, weight: .semibold)
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
    let localPoint = localHitTestPoint(point)
    guard bounds.contains(localPoint) else { return nil }
    return pointerTarget(at: localPoint)
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
    closeButton.frame =
      isGroup
      ? CGRect(x: bounds.maxX, y: bounds.midY, width: 0, height: 0)
      : TerminalHorizontalTabLayoutMetrics.closeButtonFrame(in: bounds)
    let labelLeadingInset =
      isGroup
      ? TerminalHorizontalTabLayoutMetrics.groupLabelLeadingInset
      : TerminalHorizontalTabLayoutMetrics.tabLabelLeadingInset
    let titleHorizontalInset =
      isGroup
      ? TerminalHorizontalTabLayoutMetrics.groupTitleHorizontalInset
      : TerminalHorizontalTabLayoutMetrics.tabTitleHorizontalInset
    let labelHeight = ceil(label.fittingSize.height)
    label.frame = CGRect(
      x: labelLeadingInset,
      y: (bounds.height - labelHeight) / 2,
      width: max(0, bounds.width - titleHorizontalInset),
      height: labelHeight
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
      isGroup
        ? (presentation.isCollapsed ? "Collapsed" : "Expanded") : isSelected ? "selected" : nil
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

extension NSView {
  fileprivate func localHitTestPoint(_ point: NSPoint) -> NSPoint {
    superview.map { convert(point, from: $0) } ?? point
  }
}

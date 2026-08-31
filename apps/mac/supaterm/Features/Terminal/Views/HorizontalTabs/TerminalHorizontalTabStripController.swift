import AppKit
import QuartzCore
import SupaTheme
import SwiftUI

@MainActor
final class TerminalHorizontalTabStripController: NSViewController {
  struct Actions {
    let closeGroup: (TerminalTabGroupID) -> Void
    let closeTab: (TerminalTabID) -> Void
    let newTab: () -> Void
    let newTabInGroup: (TerminalTabGroupID) -> Void
    let selectTab: (TerminalTabID) -> Void
    let toggleGroup: (TerminalTabGroupID) -> Void
    let performDrop: (TerminalSidebarDropCommand) -> TerminalSidebarDropReceipt?
    let contextMenu: (TerminalSidebarEntryID) -> NSMenu?

    init(
      closeGroup: @escaping (TerminalTabGroupID) -> Void = { _ in },
      closeTab: @escaping (TerminalTabID) -> Void,
      newTab: @escaping () -> Void,
      newTabInGroup: @escaping (TerminalTabGroupID) -> Void = { _ in },
      selectTab: @escaping (TerminalTabID) -> Void,
      toggleGroup: @escaping (TerminalTabGroupID) -> Void,
      performDrop: @escaping (TerminalSidebarDropCommand) -> TerminalSidebarDropReceipt?,
      contextMenu: @escaping (TerminalSidebarEntryID) -> NSMenu? = { _ in nil }
    ) {
      self.closeGroup = closeGroup
      self.closeTab = closeTab
      self.newTab = newTab
      self.newTabInGroup = newTabInGroup
      self.selectTab = selectTab
      self.toggleGroup = toggleGroup
      self.performDrop = performDrop
      self.contextMenu = contextMenu
    }
  }

  private struct PendingPresentation {
    let snapshot: TerminalTabSurfaceSnapshot
    let surface: TerminalHorizontalTabSurfacePresentation
  }

  private enum LayoutTransition: Equatable {
    case none
    case ordinary
    case groupExpansion
  }

  private let windowControllerID: UUID
  private let tabDragRegistry: TerminalTabDragRegistry
  private let nativeDragStart: TerminalTabNativeDragSession.NativeStart
  private let captureRequest: () -> TerminalWindowCaptureRequest?
  private let stripView = TerminalHorizontalTabStripView()
  private let newTabButton = TerminalHorizontalTabControlButton()
  private let overflowButton = TerminalHorizontalTabControlButton()
  private let sectionSeparator = HorizontalTabSectionSeparator()
  private let insertionIndicator = NSView()
  private var actions: Actions?
  private var frameAnimationIDs: [ObjectIdentifier: UUID] = [:]
  private var groupCloseButtons: [TerminalTabGroupID: TerminalHorizontalTabGroupCloseButton] = [:]
  private var groupViews: [TerminalTabGroupID: TerminalHorizontalTabGroupView] = [:]
  private var itemViews: [TerminalSidebarEntryID: TerminalHorizontalTabItemView] = [:]
  private var layout: TerminalHorizontalTabLayout?
  private var lastLayoutWidth: CGFloat?
  private var snapshot: TerminalTabSurfaceSnapshot?
  private var tabSelectionState: TerminalTabSelectionState?
  private var surfacePresentation = TerminalHorizontalTabSurfacePresentation(
    tabsByID: [:],
    groupIconURLs: [:]
  )
  private var pendingPresentation: PendingPresentation?
  private var palette: Palette?
  private var reduceMotion = false
  private var shouldPlayTabMoveHaptics = true
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
      shouldPlayTabMoveHaptics: { [weak self] in self?.shouldPlayTabMoveHaptics == true },
      liveSelectedTabID: { [weak self] in self?.liveSelectedTabID },
      tabSelectionState: { [weak self] in self?.tabSelectionState },
      selectTab: { [weak self] tabID in self?.selectLiveTab(tabID) },
      toggleGroup: { [weak self] groupID in self?.actions?.toggleGroup(groupID) },
      performDrop: { [weak self] command in self?.actions?.performDrop(command) },
      sourceViews: { [weak self] source in self?.sourceViews(for: source) ?? [] },
      settlementFrame: { [weak self] entryID in self?.settlementFrame(for: entryID) },
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
    configureButton(
      newTabButton,
      symbol: "plus",
      pointSize: 13,
      weight: .medium,
      action: #selector(createTab)
    )
    configureButton(
      overflowButton,
      symbol: "chevron.down",
      pointSize: 10,
      weight: .semibold,
      action: #selector(showOverflow)
    )
    overflowButton.setAccessibilityLabel("More Tabs")
    newTabButton.setAccessibilityLabel("New Tab")
    overflowButton.toolTip = "More Tabs"
    newTabButton.toolTip = "New Tab"
    newTabButton.setAccessibilityHelp("New Tab")
    insertionIndicator.wantsLayer = true
    insertionIndicator.layer?.cornerRadius = 1
    insertionIndicator.isHidden = true
    insertionIndicator.setAccessibilityElement(false)
    sectionSeparator.isHidden = true
    stripView.addSubview(newTabButton)
    stripView.addSubview(overflowButton)
    stripView.addSubview(sectionSeparator)
    stripView.addSubview(insertionIndicator)
    view = stripView
  }

  override func viewDidLayout() {
    super.viewDidLayout()
    applyLayout(transition: .none)
  }

  func apply(
    snapshot: TerminalTabSurfaceSnapshot,
    tabSelectionState: TerminalTabSelectionState? = nil,
    surfacePresentation: TerminalHorizontalTabSurfacePresentation =
      TerminalHorizontalTabSurfacePresentation(tabsByID: [:], groupIconURLs: [:]),
    palette: Palette,
    reduceMotion: Bool,
    shouldPlayTabMoveHaptics: Bool = true,
    actions: Actions
  ) {
    self.actions = actions
    self.palette = palette
    self.reduceMotion = reduceMotion
    self.shouldPlayTabMoveHaptics = shouldPlayTabMoveHaptics
    if let tabSelectionState {
      self.tabSelectionState = tabSelectionState
    }
    liveSelectedTabID = snapshot.collection.selectedTabID
    let visibleTabIDs = TerminalSidebarOutline(snapshot: snapshot).visibleTabIDs
    self.tabSelectionState?.retainVisible(
      in: visibleTabIDs,
      primaryTabID: snapshot.collection.selectedTabID
    )
    if dragController.receive(snapshot) {
      pendingPresentation = PendingPresentation(
        snapshot: snapshot,
        surface: surfacePresentation
      )
      return
    }
    pendingPresentation = nil
    present(snapshot, surface: surfacePresentation)
  }

  func cancelInteractions() {
    for itemView in itemViews.values {
      itemView.cancelPointerInteraction()
    }
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
    applyLayout(transition: .none)
  }

  func pointerTarget(at point: CGPoint) -> NSView? {
    guard
      let item = layout?.items.first(where: { $0.frame.contains(point) }),
      let itemView = itemViews[item.entryID]
    else { return nil }
    return itemView.pointerTarget(at: itemView.convert(point, from: stripView))
  }

  private func present(
    _ snapshot: TerminalTabSurfaceSnapshot,
    surface: TerminalHorizontalTabSurfacePresentation
  ) {
    let priorSnapshot = self.snapshot
    let topologyChanged =
      self.snapshot.map {
        $0.collection.topologyRevision != snapshot.collection.topologyRevision
      } == true
    let groupExpansionChanged =
      priorSnapshot.map {
        $0.collapsedGroupIDs != snapshot.collapsedGroupIDs
      } == true
    let selectionChanged =
      priorSnapshot.map {
        $0.collection.selectedTabID != snapshot.collection.selectedTabID
      } == true
    self.snapshot = snapshot
    surfacePresentation = surface
    let transition: LayoutTransition =
      if groupExpansionChanged {
        .groupExpansion
      } else if topologyChanged {
        .ordinary
      } else {
        .none
      }
    applyLayout(transition: transition)
    if selectionChanged, let selectedTabID = snapshot.collection.selectedTabID {
      animateSelectedEntrance(selectedTabID)
    }
  }

  private func releaseDragProjection() {
    guard let pendingPresentation else {
      applyLayout(transition: .none)
      return
    }
    self.pendingPresentation = nil
    present(pendingPresentation.snapshot, surface: pendingPresentation.surface)
  }

  private func applyLayout(transition: LayoutTransition) {
    guard let snapshot, let palette, isViewLoaded else { return }
    let presentations = HorizontalTabPresentationBuilder.presentations(
      snapshot: snapshot,
      surface: surfacePresentation,
      selectionState: tabSelectionState
    )
    let nextLayout = makeLayout(snapshot: snapshot, presentations: presentations)
    let visibleGroupIDs = Set(nextLayout.groups.map(\.id))
    for groupID in groupViews.keys.filter({ !visibleGroupIDs.contains($0) }) {
      remove(groupViews.removeValue(forKey: groupID), transition: transition)
    }
    for group in nextLayout.groups {
      guard
        let groupPresentation = groupPresentation(
          for: group,
          layout: nextLayout,
          snapshot: snapshot
        )
      else { continue }
      let isNew = groupViews[group.id] == nil
      let groupView = groupViews[group.id] ?? makeGroupView(for: group.id)
      setFrame(group.frame, of: groupView, transition: isNew ? .none : transition)
      groupView.apply(groupPresentation, palette: palette, reduceMotion: reduceMotion)
      if isNew { animateInsertion(groupView, transition: transition) }
    }
    let visibleIDs = Set(nextLayout.items.map(\.entryID))
    for entryID in itemViews.keys.filter({ !visibleIDs.contains($0) }) {
      remove(itemViews.removeValue(forKey: entryID), transition: transition)
    }
    for item in nextLayout.items {
      guard let presentation = presentations[item.entryID] else { continue }
      let isNew = itemViews[item.entryID] == nil
      let itemView = itemViews[item.entryID] ?? makeItemView(for: item.entryID)
      setFrame(item.frame, of: itemView, transition: isNew ? .none : transition)
      itemView.apply(presentation, palette: palette, reduceMotion: reduceMotion)
      if isNew { animateInsertion(itemView, transition: transition) }
    }
    let visibleGroupCloseIDs = Set(
      nextLayout.groups.compactMap { $0.closeButtonFrame == nil ? nil : $0.id }
    )
    for groupID in groupCloseButtons.keys.filter({ !visibleGroupCloseIDs.contains($0) }) {
      remove(groupCloseButtons.removeValue(forKey: groupID), transition: transition)
    }
    for group in nextLayout.groups {
      guard let frame = group.closeButtonFrame else { continue }
      let isNew = groupCloseButtons[group.id] == nil
      let button = groupCloseButtons[group.id] ?? makeGroupCloseButton(for: group.id)
      setFrame(frame, of: button, transition: isNew ? .none : transition)
      button.apply(palette: palette)
      if isNew { animateInsertion(button, transition: transition) }
    }
    layout = nextLayout
    setFrame(nextLayout.newTabFrame, of: newTabButton, transition: transition)
    newTabButton.apply(palette: palette)
    overflowButton.isHidden = nextLayout.overflowFrame == nil
    if let overflowFrame = nextLayout.overflowFrame {
      setFrame(overflowFrame, of: overflowButton, transition: transition)
    }
    overflowButton.apply(palette: palette)
    if let separatorFrame = nextLayout.sectionSeparatorFrame {
      setFrame(separatorFrame, of: sectionSeparator, transition: transition)
      sectionSeparator.apply(palette: palette)
      sectionSeparator.isHidden = false
    } else {
      sectionSeparator.isHidden = true
    }
    updateDropIndicator()
  }

  private func groupPresentation(
    for group: TerminalHorizontalTabLayout.Group,
    layout: TerminalHorizontalTabLayout,
    snapshot: TerminalTabSurfaceSnapshot
  ) -> HorizontalTabGroupChrome? {
    guard
      let model = snapshot.collection.rootItems.compactMap({ root -> TerminalTabGroupItem? in
        guard case .group(let model) = root, model.id == group.id else { return nil }
        return model
      }).first,
      let header = layout.items.first(where: { $0.entryID == .group(group.id) })
    else { return nil }
    let firstChild = layout.items.first { item in
      guard case .groupedTab(_, let groupID, let index) = item.kind else { return false }
      return groupID == group.id && index == 0
    }
    let localHeader = header.frame.offsetBy(dx: -group.frame.minX, dy: -group.frame.minY)
    let localChild = firstChild?.frame.offsetBy(dx: -group.frame.minX, dy: -group.frame.minY)
    let firstChildIsSelected =
      firstChild.flatMap { item -> Bool? in
        guard case .tab(let tabID) = item.entryID else { return nil }
        return tabID == snapshot.collection.selectedTabID
      } == true
    return HorizontalTabGroupChrome(
      color: model.color,
      isCollapsed: group.isCollapsed,
      headerFrame: localHeader,
      firstChildFrame: localChild,
      isFirstChildSelected: firstChildIsSelected
    )
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
    itemView.onNewTab = { [weak self] in
      guard case .group(let groupID) = entryID else { return }
      self?.actions?.newTabInGroup(groupID)
    }
    itemView.onContextMenu = { [weak self] event in
      self?.showContextMenu(for: entryID, event: event)
    }
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

  private func makeGroupCloseButton(
    for groupID: TerminalTabGroupID
  ) -> TerminalHorizontalTabGroupCloseButton {
    let button = TerminalHorizontalTabGroupCloseButton()
    button.onClose = { [weak self] in self?.actions?.closeGroup(groupID) }
    groupCloseButtons[groupID] = button
    stripView.addSubview(button, positioned: .below, relativeTo: insertionIndicator)
    return button
  }

  private func pressed(_ entryID: TerminalSidebarEntryID, event: NSEvent) {
    beginPointerInteraction(
      entryID: entryID,
      at: stripView.convert(event.locationInWindow, from: nil),
      modifiers: event.modifierFlags,
      clickCount: event.clickCount
    )
  }

  private func dragged(_ entryID: TerminalSidebarEntryID, event: NSEvent) -> Bool {
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

  private func showContextMenu(for entryID: TerminalSidebarEntryID, event: NSEvent) {
    dragController.cancelInteractions()
    guard
      let itemView = itemViews[entryID],
      let menu = actions?.contextMenu(entryID)
    else { return }
    NSMenu.popUpContextMenu(menu, with: event, for: itemView)
  }

  private func sourceViews(for source: TerminalSidebarDragSource) -> [NSView] {
    guard let snapshot else { return [] }
    let entryIDs = TerminalSidebarOutline(snapshot: snapshot).liftedEntryIDs(for: source)
    var views: [NSView] = entryIDs.compactMap { itemViews[$0] }
    if case .group(let groupID) = source, let groupView = groupViews[groupID] {
      views.insert(groupView, at: 0)
      if let closeButton = groupCloseButtons[groupID] {
        views.append(closeButton)
      }
    }
    return views
  }

  private func settlementFrame(for entryID: TerminalSidebarEntryID) -> CGRect? {
    guard let pendingPresentation else {
      return layout?.dragSourceFrame(for: entryID)
    }
    let presentations = HorizontalTabPresentationBuilder.presentations(
      snapshot: pendingPresentation.snapshot,
      surface: pendingPresentation.surface,
      selectionState: tabSelectionState
    )
    return makeLayout(
      snapshot: pendingPresentation.snapshot,
      presentations: presentations
    ).dragSourceFrame(for: entryID)
  }

  private func makeLayout(
    snapshot: TerminalTabSurfaceSnapshot,
    presentations: [TerminalSidebarEntryID: TerminalHorizontalTabItemPresentation]
  ) -> TerminalHorizontalTabLayout {
    TerminalHorizontalTabLayout(
      snapshot: snapshot,
      availableWidth: stripView.bounds.width,
      titleForEntry: { entryID, fallback in
        presentations[entryID]?.displayTitle ?? fallback
      },
      measureContent: { entryID, fallback in
        HorizontalTabPresentationBuilder.measureContent(
          presentations[entryID],
          fallback: fallback
        )
      }
    )
  }

  private func selectLiveTab(_ tabID: TerminalTabID) {
    liveSelectedTabID = tabID
    actions?.selectTab(tabID)
  }

  private func close(_ entryID: TerminalSidebarEntryID) {
    switch entryID {
    case .group(let groupID):
      actions?.closeGroup(groupID)
    case .tab(let tabID):
      actions?.closeTab(tabID)
    case .newTab, .pinDivider:
      break
    }
  }

  private func configureButton(
    _ button: TerminalHorizontalTabControlButton,
    symbol: String,
    pointSize: CGFloat,
    weight: NSFont.Weight,
    action: Selector
  ) {
    button.bezelStyle = .inline
    button.isBordered = false
    button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
    button.imagePosition = .imageOnly
    button.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: pointSize, weight: weight)
    button.target = self
    button.action = action
  }

  @objc private func createTab() {
    actions?.newTab()
  }

  @objc private func showOverflow() {
    guard let snapshot, let layout else { return }
    let presentations = HorizontalTabPresentationBuilder.presentations(
      snapshot: snapshot,
      surface: surfacePresentation,
      selectionState: tabSelectionState
    )
    let model = TerminalHorizontalTabOverflowModel(
      snapshot: snapshot,
      hiddenEntryIDs: Set(layout.hiddenEntryIDs),
      presentations: presentations,
      selectionState: tabSelectionState
    )
    let menu = TerminalHorizontalTabOverflowMenu.make(
      model: model,
      selectTab: { [weak self] tabID in
        self?.tabSelectionState?.clear()
        self?.selectLiveTab(tabID)
      },
      toggleGroup: { [weak self] in self?.actions?.toggleGroup($0) }
    )
    guard !menu.items.isEmpty else { return }
    overflowButton.isMenuOpen = true
    defer { overflowButton.isMenuOpen = false }
    menu.popUp(
      positioning: nil,
      at: CGPoint(x: overflowButton.frame.minX, y: overflowButton.frame.maxY),
      in: stripView
    )
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

  func updateDrop(_ payload: TerminalTabDragPayload, at point: CGPoint) -> NSDragOperation {
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

  func sourceOperationMask() -> NSDragOperation {
    [.copy, .move]
  }

  func sourceSessionMoved(to screenPoint: CGPoint) {
    dragController.sourceSessionMoved(to: screenPoint)
  }

  func sourceSessionEnded(operation: NSDragOperation) {
    dragController.sourceSessionEnded(operation: operation)
  }

  private func updateDropIndicator() {
    guard
      let path = dropPlan?.path,
      let layout,
      let palette
    else {
      insertionIndicator.isHidden = true
      return
    }
    switch path {
    case .groupEntry(let groupID):
      guard let frame = layout.groups.first(where: { $0.id == groupID })?.frame else {
        insertionIndicator.isHidden = true
        return
      }
      insertionIndicator.frame = frame
      insertionIndicator.layer?.cornerRadius = 8
      insertionIndicator.layer?.backgroundColor =
        NSColor(palette.accent)
        .withAlphaComponent(palette.isDark ? 0.18 : 0.12).cgColor
    default:
      guard let frame = layout.indicatorFrame(for: path) else {
        insertionIndicator.isHidden = true
        return
      }
      insertionIndicator.frame = frame
      insertionIndicator.layer?.cornerRadius = 1
      insertionIndicator.layer?.backgroundColor = NSColor(palette.accent).cgColor
    }
    insertionIndicator.isHidden = false
  }

  private func setDropPlan(_ plan: TerminalSidebarDropPlan?) {
    dropPlan = plan
    updateDropIndicator()
  }

  private func remove(_ view: NSView?, transition: LayoutTransition) {
    guard let view else { return }
    view.setAccessibilityElement(false)
    let key = ObjectIdentifier(view)
    frameAnimationIDs.removeValue(forKey: key)
    guard transition != .none, !reduceMotion, view.window != nil, let layer = view.layer else {
      view.removeFromSuperview()
      return
    }
    let animationID = UUID()
    frameAnimationIDs[key] = animationID
    let animation = frameAnimation(
      keyPath: "opacity",
      from: layer.presentation()?.opacity ?? layer.opacity,
      to: 0,
      transition: transition
    )
    layerWithoutActions { layer.opacity = 0 }
    layer.add(animation, forKey: "horizontalTabRemoval")
    DispatchQueue.main.asyncAfter(deadline: .now() + animation.duration) { [weak self, weak view] in
      guard
        let self,
        let view,
        frameAnimationIDs[key] == animationID
      else { return }
      frameAnimationIDs.removeValue(forKey: key)
      view.removeFromSuperview()
    }
  }

  private func animateInsertion(_ view: NSView, transition: LayoutTransition) {
    guard transition != .none, !reduceMotion, view.window != nil, let layer = view.layer else {
      return
    }
    let opacity = frameAnimation(
      keyPath: "opacity",
      from: 0,
      to: layer.opacity,
      transition: transition
    )
    let scale = frameAnimation(
      keyPath: "transform.scale",
      from: 0.98,
      to: 1,
      transition: transition
    )
    layer.add(opacity, forKey: "horizontalTabInsertionOpacity")
    layer.add(scale, forKey: "horizontalTabInsertionScale")
  }

  private func setFrame(
    _ frame: CGRect,
    of view: NSView,
    transition: LayoutTransition
  ) {
    let key = ObjectIdentifier(view)
    let animationID = UUID()
    frameAnimationIDs[key] = animationID
    guard transition != .none, !reduceMotion, view.window != nil, let layer = view.layer else {
      layerWithoutActions { view.frame = frame }
      view.layer?.removeAnimation(forKey: "horizontalTabPosition")
      view.layer?.removeAnimation(forKey: "horizontalTabBounds")
      return
    }
    let oldPosition = layer.presentation()?.position ?? layer.position
    let oldBounds = layer.presentation()?.bounds ?? layer.bounds
    layerWithoutActions { view.frame = frame }
    let animationDuration: TimeInterval
    if oldPosition != layer.position {
      let animation = frameAnimation(
        keyPath: "position",
        from: NSValue(point: oldPosition),
        to: NSValue(point: layer.position),
        transition: transition
      )
      layer.add(animation, forKey: "horizontalTabPosition")
      animationDuration = animation.duration
    } else {
      animationDuration = 0
    }
    var completionDelay = animationDuration
    if oldBounds != layer.bounds {
      let animation = frameAnimation(
        keyPath: "bounds",
        from: NSValue(rect: oldBounds),
        to: NSValue(rect: layer.bounds),
        transition: transition
      )
      layer.add(animation, forKey: "horizontalTabBounds")
      completionDelay = max(completionDelay, animation.duration)
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + completionDelay) { [weak self, weak view] in
      guard
        let self,
        let view,
        frameAnimationIDs[key] == animationID
      else { return }
      view.layer?.removeAnimation(forKey: "horizontalTabPosition")
      view.layer?.removeAnimation(forKey: "horizontalTabBounds")
      frameAnimationIDs.removeValue(forKey: key)
    }
  }

  private func frameAnimation(
    keyPath: String,
    from: Any,
    to: Any,
    transition: LayoutTransition
  ) -> CAAnimation {
    switch transition {
    case .none:
      preconditionFailure()
    case .ordinary:
      let animation = CABasicAnimation(keyPath: keyPath)
      animation.fromValue = from
      animation.toValue = to
      animation.duration = 0.12
      animation.timingFunction = CAMediaTimingFunction(name: .easeOut)
      return animation
    case .groupExpansion:
      let animation = CASpringAnimation(keyPath: keyPath)
      animation.fromValue = from
      animation.toValue = to
      animation.mass = 1
      animation.stiffness = pow(2 * Double.pi / 0.3, 2)
      animation.damping = 4 * Double.pi * 0.82 / 0.3
      animation.duration = animation.settlingDuration
      return animation
    }
  }

  private func animateSelectedEntrance(_ tabID: TerminalTabID) {
    itemViews[.tab(tabID)]?.animateSelectedEntrance()
  }

  private func layerWithoutActions(_ apply: () -> Void) {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    apply()
    CATransaction.commit()
  }

}

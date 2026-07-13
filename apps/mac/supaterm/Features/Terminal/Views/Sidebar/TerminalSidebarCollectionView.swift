import AppKit
import QuartzCore
import SwiftUI

@MainActor
final class TerminalSidebarCollectionViewController: NSViewController {
  let collectionView = TerminalSidebarCollectionView()
  let collectionLayout = TerminalSidebarCollectionLayout()
  var onAutoscroll: ((CGFloat) -> Void)?

  private let scrollView = NSScrollView()
  private let dropIndicatorView = TerminalSidebarDropIndicatorView()
  private lazy var expansionAnimator = TerminalSidebarExpansionAnimator(
    collectionView: collectionView,
    layout: collectionLayout,
    onFrame: { [weak self] in self?.layoutDidChange() }
  )
  private lazy var dragLayoutAnimator = TerminalSidebarDragLayoutAnimator(
    collectionView: collectionView,
    layout: collectionLayout,
    onFrame: { [weak self] in self?.layoutDidChange() }
  )
  private lazy var autoscrollController = TerminalSidebarDragAutoscrollController(
    collectionView: collectionView,
    scrollView: scrollView,
    onScroll: { [weak self] pointerY in self?.onAutoscroll?(pointerY) }
  )
  private var dragSessionSource: TerminalSidebarDragSessionSource?
  private var animationsEnabled = true

  override func loadView() {
    scrollView.drawsBackground = false
    scrollView.hasVerticalScroller = false
    scrollView.contentInsets.top = TerminalSidebarLayout.firstVisibleSectionTopInset
    collectionView.translatesAutoresizingMaskIntoConstraints = false
    scrollView.documentView = collectionView
    collectionView.widthAnchor.constraint(equalTo: scrollView.contentView.widthAnchor).isActive = true
    collectionView.collectionViewLayout = collectionLayout
    collectionView.backgroundColors = [.clear]
    collectionView.isSelectable = false
    collectionView.register(
      TerminalSidebarCollectionItem.self,
      forItemWithIdentifier: TerminalSidebarCollectionItem.identifier
    )
    collectionView.addSubview(dropIndicatorView)
    view = scrollView
  }

  func configure(
    entries: [TerminalSidebarEntry],
    collapsedProjectIDs: Set<TerminalProjectID>,
    animated: Bool,
    animationsEnabled: Bool
  ) {
    self.animationsEnabled = animationsEnabled
    if entries != collectionLayout.entries {
      dragLayoutAnimator.animate(
        enabled: animated,
        changes: { collectionLayout.setEntries(entries) }
      )
    }
    expansionAnimator.setTargets(
      Dictionary(
        uniqueKeysWithValues: entries.compactMap { entry in
          guard case .project(let projectID, _) = entry.kind else { return nil }
          return (projectID, collapsedProjectIDs.contains(projectID) ? 0 : 1)
        }),
      animated: animated
    )
    invalidateLayout()
  }

  func beginDragging(
    value: TerminalSidebarDragValue,
    event: NSEvent,
    sessionID: UUID
  ) -> Bool {
    let draggedEntryIDs = draggedEntries(for: value)
    guard
      !draggedEntryIDs.isEmpty,
      let previewRect = previewRect(for: draggedEntryIDs),
      let preview = snapshot(in: previewRect)
    else { return false }

    let pasteboardItem = NSPasteboardItem()
    pasteboardItem.setString(value.pasteboardValue, forType: TerminalSidebarProjectList.dragType)
    let draggingItem = NSDraggingItem(pasteboardWriter: pasteboardItem)
    draggingItem.setDraggingFrame(previewRect, contents: preview)
    collectionLayout.draggedEntryIDs = draggedEntryIDs
    invalidateLayout()
    let source = TerminalSidebarDragSessionSource { [weak self] source, operation in
      guard let self else { return }
      guard dragSessionSource === source else { return }
      dragSessionSource = nil
      collectionView.onDragEnded?(sessionID, operation)
    }
    dragSessionSource = source
    let session = collectionView.beginDraggingSession(
      with: [draggingItem],
      event: event,
      source: source
    )
    session.draggingFormation = .none
    return true
  }

  func framesByEntryID() -> [TerminalSidebarEntryID: CGRect] {
    Dictionary(uniqueKeysWithValues: collectionLayout.targetPlan.items.map { ($0.id, $0.frame) })
  }

  func setDropTarget(_ target: TerminalSidebarDropTarget?, pointerY: CGFloat?) {
    guard collectionLayout.dropTarget != target else {
      if let pointerY { autoscrollController.update(pointerY: pointerY) }
      return
    }
    dragLayoutAnimator.animate(enabled: animationsEnabled) {
      self.collectionLayout.dropTarget = target
    }
    if let pointerY {
      autoscrollController.update(pointerY: pointerY)
    } else {
      autoscrollController.stop()
    }
    invalidateLayout()
  }

  func finishDragging() {
    autoscrollController.stop()
    collectionLayout.draggedEntryIDs = []
    if collectionLayout.dropTarget != nil {
      dragLayoutAnimator.animate(enabled: animationsEnabled) {
        self.collectionLayout.dropTarget = nil
      }
    }
    invalidateLayout()
  }

  func invalidateLayout() {
    collectionLayout.invalidateLayout()
    collectionView.needsLayout = true
    collectionView.layoutSubtreeIfNeeded()
    layoutDidChange()
  }

  private func draggedEntries(for value: TerminalSidebarDragValue) -> Set<TerminalSidebarEntryID> {
    switch value {
    case .tab(let tabID):
      return [.tab(tabID)]
    case .project(let projectID):
      guard
        let headerIndex = collectionLayout.entries.firstIndex(where: {
          if case .project(let id, _) = $0.kind { return id == projectID }
          return false
        })
      else { return [] }
      let trailingEntries = collectionLayout.entries[headerIndex...]
      return Set(
        trailingEntries.prefix { entry in
          if entry.id == .project(projectID) { return true }
          if case .tab(_, let ownerID, _) = entry.kind { return ownerID == projectID }
          return false
        }.map(\.id))
    }
  }

  private func previewRect(for entryIDs: Set<TerminalSidebarEntryID>) -> CGRect? {
    let frames = collectionLayout.plan.items.compactMap { item in
      entryIDs.contains(item.id) && item.frame.height > 0 ? item.frame : nil
    }
    return frames.reduce(nil) { partial, frame in
      partial?.union(frame) ?? frame
    }
  }

  private func snapshot(in rect: CGRect) -> NSImage? {
    guard rect.width > 0, rect.height > 0,
      let representation = collectionView.bitmapImageRepForCachingDisplay(in: rect)
    else { return nil }
    collectionView.cacheDisplay(in: rect, to: representation)
    let image = NSImage(size: rect.size)
    image.addRepresentation(representation)
    return image
  }

  private func layoutDidChange() {
    guard let frame = collectionLayout.plan.dropIndicatorFrame else {
      dropIndicatorView.isHidden = true
      return
    }
    dropIndicatorView.frame = frame
    dropIndicatorView.isHidden = false
  }
}

@MainActor
final class TerminalSidebarCollectionView: NSCollectionView {
  private struct PendingDrag {
    let indexPath: IndexPath
    let location: CGPoint
  }

  var onDragBegan: ((IndexPath, NSEvent) -> Void)?
  var onDragEnded: ((UUID, NSDragOperation) -> Void)?
  var onDragExited: (() -> Void)?
  private var eventMonitor: Any?
  private var pendingDrag: PendingDrag?

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  isolated deinit {
    if let eventMonitor {
      NSEvent.removeMonitor(eventMonitor)
    }
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if let eventMonitor {
      NSEvent.removeMonitor(eventMonitor)
      self.eventMonitor = nil
    }
    guard window != nil else { return }
    eventMonitor = NSEvent.addLocalMonitorForEvents(
      matching: [.leftMouseDown, .leftMouseDragged, .leftMouseUp]
    ) { [weak self] event in
      self?.handle(event) ?? event
    }
  }

  override func setFrameSize(_ newSize: NSSize) {
    let widthChanged = newSize.width != frame.width
    super.setFrameSize(newSize)
    if widthChanged {
      if let collectionLayout = collectionViewLayout as? TerminalSidebarCollectionLayout {
        collectionLayout.resize(to: newSize.width)
      } else {
        collectionViewLayout?.invalidateLayout()
      }
      needsLayout = true
      layoutSubtreeIfNeeded()
    }
  }

  override func draggingExited(_ sender: (any NSDraggingInfo)?) {
    super.draggingExited(sender)
    onDragExited?()
  }

  private func handle(_ event: NSEvent) -> NSEvent? {
    guard event.window === window else { return event }
    let location = convert(event.locationInWindow, from: nil)
    switch event.type {
    case .leftMouseDown:
      pendingDrag = indexPathForItem(at: location).map {
        PendingDrag(indexPath: $0, location: location)
      }
      return event
    case .leftMouseDragged:
      guard let pendingDrag,
        hypot(location.x - pendingDrag.location.x, location.y - pendingDrag.location.y) >= 3
      else { return event }
      self.pendingDrag = nil
      onDragBegan?(pendingDrag.indexPath, event)
      return nil
    case .leftMouseUp:
      pendingDrag = nil
      return event
    default:
      return event
    }
  }
}

@MainActor
private final class TerminalSidebarDragSessionSource: NSObject, NSDraggingSource {
  private let onEnded: (TerminalSidebarDragSessionSource, NSDragOperation) -> Void

  init(onEnded: @escaping (TerminalSidebarDragSessionSource, NSDragOperation) -> Void) {
    self.onEnded = onEnded
  }

  func draggingSession(
    _ session: NSDraggingSession,
    sourceOperationMaskFor context: NSDraggingContext
  ) -> NSDragOperation {
    .move
  }

  func draggingSession(
    _ session: NSDraggingSession,
    endedAt screenPoint: NSPoint,
    operation: NSDragOperation
  ) {
    onEnded(self, operation)
  }
}

@MainActor
final class TerminalSidebarCollectionItem: NSCollectionViewItem {
  static let identifier = NSUserInterfaceItemIdentifier("TerminalSidebarCollectionItem")

  private var hostingView: NSHostingView<AnyView>?

  override func loadView() {
    view = NSView()
  }

  func host(_ view: AnyView) {
    if let hostingView {
      hostingView.rootView = view
      return
    }
    let hostingView = NSHostingView(rootView: view)
    hostingView.translatesAutoresizingMaskIntoConstraints = false
    self.view.addSubview(hostingView)
    NSLayoutConstraint.activate([
      hostingView.leadingAnchor.constraint(equalTo: self.view.leadingAnchor),
      hostingView.trailingAnchor.constraint(equalTo: self.view.trailingAnchor),
      hostingView.topAnchor.constraint(equalTo: self.view.topAnchor),
      hostingView.bottomAnchor.constraint(equalTo: self.view.bottomAnchor),
    ])
    self.hostingView = hostingView
  }
}

@MainActor
private final class TerminalSidebarDropIndicatorView: NSView {
  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    layer?.backgroundColor = NSColor.controlAccentColor.cgColor
    layer?.cornerRadius = 1
    layer?.zPosition = 100
    isHidden = true
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  override func hitTest(_ point: NSPoint) -> NSView? {
    nil
  }
}

@MainActor
private final class TerminalSidebarDisplayLinkDriver: NSObject {
  private weak var collectionView: NSCollectionView?
  private let onFrame: (CADisplayLink) -> Bool
  private var displayLink: CADisplayLink?

  init(
    collectionView: NSCollectionView?,
    onFrame: @escaping (CADisplayLink) -> Bool
  ) {
    self.collectionView = collectionView
    self.onFrame = onFrame
  }

  isolated deinit {
    displayLink?.invalidate()
  }

  func start() {
    guard displayLink == nil, let collectionView else { return }
    let displayLink = collectionView.displayLink(target: self, selector: #selector(update(_:)))
    displayLink.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
    displayLink.add(to: .main, forMode: .common)
    self.displayLink = displayLink
  }

  func stop() {
    displayLink?.invalidate()
    displayLink = nil
  }

  @objc private func update(_ displayLink: CADisplayLink) {
    if !onFrame(displayLink) { stop() }
  }
}

@MainActor
private final class TerminalSidebarExpansionAnimator {
  private struct Motion {
    let from: CGFloat
    let to: CGFloat
    let startedAt: TimeInterval
  }

  private weak var collectionView: NSCollectionView?
  private weak var layout: TerminalSidebarCollectionLayout?
  private let onFrame: () -> Void
  private var motions: [TerminalProjectID: Motion] = [:]
  private let duration: TimeInterval = 0.22
  private lazy var displayLinkDriver = TerminalSidebarDisplayLinkDriver(
    collectionView: collectionView,
    onFrame: { [weak self] displayLink in self?.update(displayLink) ?? false }
  )

  init(
    collectionView: NSCollectionView,
    layout: TerminalSidebarCollectionLayout,
    onFrame: @escaping () -> Void
  ) {
    self.collectionView = collectionView
    self.layout = layout
    self.onFrame = onFrame
  }

  func setTargets(_ targets: [TerminalProjectID: CGFloat], animated: Bool) {
    guard let layout else { return }
    guard animated else {
      motions.removeAll()
      displayLinkDriver.stop()
      layout.expansionProgress = targets
      return
    }
    layout.expansionProgress = layout.expansionProgress.filter { targets[$0.key] != nil }
    motions = motions.filter { targets[$0.key] != nil }
    let now = CACurrentMediaTime()
    for (projectID, target) in targets {
      guard let current = layout.expansionProgress[projectID] else {
        layout.expansionProgress[projectID] = target
        continue
      }
      if motions[projectID]?.to == target || current == target { continue }
      motions[projectID] = Motion(from: current, to: target, startedAt: now)
    }
    if motions.isEmpty {
      displayLinkDriver.stop()
    } else {
      displayLinkDriver.start()
    }
  }

  private func update(_ displayLink: CADisplayLink) -> Bool {
    guard let layout else { return false }
    var completed: [TerminalProjectID] = []
    for (projectID, motion) in motions {
      let elapsed = displayLink.timestamp - motion.startedAt
      layout.expansionProgress[projectID] = TerminalSidebarAnimationCurve.interpolate(
        from: motion.from,
        to: motion.to,
        elapsed: elapsed,
        duration: duration
      )
      if elapsed >= duration {
        layout.expansionProgress[projectID] = motion.to
        completed.append(projectID)
      }
    }
    for projectID in completed {
      motions[projectID] = nil
    }
    layout.invalidateLayout()
    collectionView?.needsLayout = true
    collectionView?.layoutSubtreeIfNeeded()
    onFrame()
    return !motions.isEmpty
  }
}

@MainActor
private final class TerminalSidebarDragLayoutAnimator {
  private weak var collectionView: NSCollectionView?
  private weak var layout: TerminalSidebarCollectionLayout?
  private let onFrame: () -> Void
  private var startedAt: TimeInterval = 0
  private let duration: TimeInterval = 0.16
  private lazy var displayLinkDriver = TerminalSidebarDisplayLinkDriver(
    collectionView: collectionView,
    onFrame: { [weak self] displayLink in self?.update(displayLink) ?? false }
  )

  init(
    collectionView: NSCollectionView,
    layout: TerminalSidebarCollectionLayout,
    onFrame: @escaping () -> Void
  ) {
    self.collectionView = collectionView
    self.layout = layout
    self.onFrame = onFrame
  }

  func animate(
    enabled: Bool,
    changes: () -> Void
  ) {
    guard let layout else {
      changes()
      return
    }
    if enabled {
      layout.beginTransition()
    } else {
      finish()
    }
    changes()
    guard enabled else { return }
    startedAt = CACurrentMediaTime()
    displayLinkDriver.start()
  }

  func finish() {
    displayLinkDriver.stop()
    layout?.finishTransition()
  }

  private func update(_ displayLink: CADisplayLink) -> Bool {
    guard let layout else { return false }
    let elapsed = displayLink.timestamp - startedAt
    layout.updateTransition(
      progress: TerminalSidebarAnimationCurve.interpolate(
        from: 0,
        to: 1,
        elapsed: elapsed,
        duration: duration
      )
    )
    layout.invalidateLayout()
    collectionView?.needsLayout = true
    collectionView?.layoutSubtreeIfNeeded()
    onFrame()
    guard elapsed < duration else {
      layout.finishTransition()
      return false
    }
    return true
  }
}

@MainActor
private final class TerminalSidebarDragAutoscrollController {
  private weak var collectionView: NSCollectionView?
  private weak var scrollView: NSScrollView?
  private let onScroll: (CGFloat) -> Void
  private var pointerY: CGFloat?
  private var velocity: CGFloat = 0
  private let edgeSize: CGFloat = 36
  private let maximumSpeed: CGFloat = 720
  private lazy var displayLinkDriver = TerminalSidebarDisplayLinkDriver(
    collectionView: collectionView,
    onFrame: { [weak self] displayLink in self?.update(displayLink) ?? false }
  )

  init(
    collectionView: NSCollectionView,
    scrollView: NSScrollView,
    onScroll: @escaping (CGFloat) -> Void
  ) {
    self.collectionView = collectionView
    self.scrollView = scrollView
    self.onScroll = onScroll
  }

  func update(pointerY: CGFloat) {
    guard let collectionView else { return }
    self.pointerY = pointerY
    let visibleRect = collectionView.visibleRect
    if pointerY < visibleRect.minY + edgeSize {
      velocity = -maximumSpeed * (1 - max(0, pointerY - visibleRect.minY) / edgeSize)
    } else if pointerY > visibleRect.maxY - edgeSize {
      velocity = maximumSpeed * (1 - max(0, visibleRect.maxY - pointerY) / edgeSize)
    } else {
      stop()
      return
    }
    displayLinkDriver.start()
  }

  func stop() {
    velocity = 0
    pointerY = nil
    displayLinkDriver.stop()
  }

  private func update(_ displayLink: CADisplayLink) -> Bool {
    guard let collectionView, let scrollView else { return false }
    let clipView = scrollView.contentView
    let maximumY = max(0, collectionView.bounds.height - clipView.bounds.height)
    let previousY = clipView.bounds.origin.y
    let nextY = max(0, min(previousY + velocity * displayLink.duration, maximumY))
    guard nextY != previousY else {
      velocity = 0
      pointerY = nil
      return false
    }
    clipView.scroll(to: CGPoint(x: clipView.bounds.origin.x, y: nextY))
    scrollView.reflectScrolledClipView(clipView)
    if let pointerY {
      let updatedPointerY = pointerY + nextY - previousY
      self.pointerY = updatedPointerY
      onScroll(updatedPointerY)
    }
    return true
  }
}

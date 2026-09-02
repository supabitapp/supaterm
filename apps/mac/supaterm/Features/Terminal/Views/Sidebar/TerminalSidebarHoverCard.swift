import AppKit
import ComposableArchitecture
import Observation
import QuartzCore
import SupatermUI
import SwiftUI

struct TerminalSidebarHoverCardContent: Equatable {
  let tabTitle: String
  let workingDirectoryPath: String?
  let branch: TerminalTabAgentWorkspace.Branch?
  let response: TerminalHostState.TabAgentResponse?
}

enum TerminalSidebarHoverCardMetrics {
  static let width: CGFloat = 320
  static let horizontalPadding: CGFloat = 14
  static let maximumResponseHeight: CGFloat = 320

  @MainActor
  static func responseHeight(for response: AttributedString) -> CGFloat {
    let controller = NSHostingController(
      rootView: TerminalSidebarHoverCardResponseView(response: response)
    )
    let contentWidth = width - horizontalPadding * 2
    let height = controller.sizeThatFits(
      in: CGSize(width: contentWidth, height: maximumResponseHeight)
    ).height
    return min(max(ceil(height), 1), maximumResponseHeight)
  }
}

@MainActor
final class TerminalSidebarHoverCardController {
  struct Source {
    let view: NSView
  }

  var presentationChanged: (() -> Void)?

  private(set) var phase = TerminalSidebarHoverCardPhase.idle
  private let tabAtPoint: (CGPoint) -> TerminalTabID?
  private let sourceForTab: (TerminalTabID) -> Source?
  private let content: (TerminalTabID) -> TerminalSidebarHoverCardContent?
  private let allowsPresentation: () -> Bool
  private let reduceMotion: () -> Bool
  private let presenter = TerminalSidebarHoverCardPresenter()
  private var generation: UInt64 = 0
  private var coldPresentationTask: Task<Void, Never>?
  private var stoppedTask: Task<Void, Never>?
  private var dismissTask: Task<Void, Never>?
  private var delayedUpdateTask: Task<Void, Never>?
  private var inputMonitor: Any?
  private var movementMonitor: Any?
  private var observers: [NSObjectProtocol] = []
  private var observationGeneration: UInt64 = 0
  private var suppressedTabID: TerminalTabID?
  private var directionTracker = TerminalSidebarHoverDirectionTracker()

  init(
    tabAtPoint: @escaping (CGPoint) -> TerminalTabID?,
    sourceForTab: @escaping (TerminalTabID) -> Source?,
    content: @escaping (TerminalTabID) -> TerminalSidebarHoverCardContent?,
    allowsPresentation: @escaping () -> Bool,
    reduceMotion: @escaping () -> Bool
  ) {
    self.tabAtPoint = tabAtPoint
    self.sourceForTab = sourceForTab
    self.content = content
    self.allowsPresentation = allowsPresentation
    self.reduceMotion = reduceMotion
  }

  isolated deinit {
    cancelColdPresentation()
    cancelStopped()
    cancelDismiss()
    cancelDelayedUpdate()
    removeEventMonitors()
    removeObservers()
  }

  var isPresented: Bool {
    phase.isPresented
  }

  var isMonitoringEvents: Bool {
    inputMonitor != nil || movementMonitor != nil
  }

  func pointerMoved() {
    guard !phase.isPresented else { return }
    installInputMonitor()
    moved(to: NSEvent.mouseLocation)
  }

  func pointerExited() {
    if phase.isPresented {
      moved(to: NSEvent.mouseLocation)
    } else {
      pointerMoved()
    }
  }

  private func moved(to screenPoint: CGPoint) {
    guard allowsPresentation() else {
      dismiss()
      return
    }
    scheduleStopped()
    if phase.isPresented {
      cancelDelayedUpdate()
    }
    let eligibleTabID = eligibleTabID(at: screenPoint)
    let insideSafeHull = phase.tabID.map { isInsideSafeHull(screenPoint, for: $0) } ?? false
    apply(
      TerminalSidebarHoverInteraction.moved(
        phase: phase,
        eligibleTabID: eligibleTabID,
        insideSafeHull: insideSafeHull
      )
    )
  }

  func refresh() {
    guard let tabID = phase.tabID else { return }
    guard allowsPresentation(), let source = sourceForTab(tabID) else {
      dismiss()
      return
    }
    switch phase {
    case .idle:
      return
    case .pending:
      guard content(tabID) != nil else {
        dismiss()
        return
      }
    case .presented:
      guard let content = observedContent(for: tabID) else {
        dismiss()
        return
      }
      guard
        presenter.update(
          content,
          sourceView: source.view,
          reduceMotion: reduceMotion()
        )
      else {
        dismiss()
        return
      }
    }
  }

  func dismiss() {
    let wasPresented = phase.isPresented
    generation &+= 1
    observationGeneration &+= 1
    cancelColdPresentation()
    cancelStopped()
    cancelDismiss()
    cancelDelayedUpdate()
    directionTracker.reset()
    phase = .idle
    removeEventMonitors()
    removeObservers()
    presenter.dismiss(reduceMotion: reduceMotion())
    if wasPresented {
      presentationChanged?()
    }
  }

  private func beginPending(_ tabID: TerminalTabID) {
    cancelColdPresentation()
    generation &+= 1
    phase = .pending(tabID, generation)
  }

  private func schedulePresentation(for tabID: TerminalTabID, after delay: Duration) {
    cancelColdPresentation()
    let generation = generation
    coldPresentationTask = Task { [weak self] in
      do {
        try await Task.sleep(for: delay)
      } catch {
        return
      }
      guard let self else { return }
      present(tabID: tabID, generation: generation)
    }
  }

  private func present(tabID: TerminalTabID, generation: UInt64) {
    guard phase == .pending(tabID, generation) else { return }
    guard allowsPresentation(), let source = sourceForTab(tabID),
      let sourceWindow = source.view.window,
      sourceWindow.isKeyWindow,
      let content = observedContent(for: tabID)
    else {
      dismiss()
      return
    }
    guard
      presenter.present(
        content,
        sourceView: source.view,
        reduceMotion: reduceMotion()
      ) != nil
    else {
      dismiss()
      return
    }
    coldPresentationTask = nil
    phase = .presented(tabID)
    directionTracker.reset()
    installInputMonitor()
    installMovementMonitor()
    observe(sourceWindow)
    presentationChanged?()
  }

  private func observedContent(for tabID: TerminalTabID) -> TerminalSidebarHoverCardContent? {
    observationGeneration &+= 1
    let observationGeneration = observationGeneration
    return withObservationTracking {
      content(tabID)
    } onChange: { [weak self] in
      Task { @MainActor [weak self] in
        guard let self,
          self.observationGeneration == observationGeneration,
          self.phase.tabID == tabID
        else { return }
        refresh()
      }
    }
  }

  private func isInsideSafeHull(_ screenPoint: CGPoint, for tabID: TerminalTabID) -> Bool {
    guard let source = sourceForTab(tabID),
      let sourceFrame = TerminalSidebarHoverCardGeometry.screenFrame(of: source.view),
      let cardFrame = presenter.frame
    else { return false }
    if sourceFrame.containsClosed(screenPoint) {
      directionTracker.reset()
      return true
    }
    if cardFrame.containsClosed(screenPoint) { return true }
    let corridor = TerminalSidebarHoverCorridor(sourceFrame: sourceFrame, cardFrame: cardFrame)
    let permitsHull = directionTracker.permitsHull(at: screenPoint, corridor: corridor)
    return corridor.contains(screenPoint) && permitsHull
  }

  private func updatePresentedCard(to tabID: TerminalTabID) {
    guard allowsPresentation(), let source = sourceForTab(tabID),
      let content = observedContent(for: tabID)
    else {
      dismiss()
      return
    }
    cancelDismiss()
    cancelDelayedUpdate()
    guard presenter.update(content, sourceView: source.view, reduceMotion: reduceMotion()) else {
      dismiss()
      return
    }
    phase = .presented(tabID)
    directionTracker.reset()
  }

  private func scheduleStopped() {
    cancelStopped()
    stoppedTask = Task { [weak self] in
      do {
        try await Task.sleep(for: TerminalSidebarHoverTiming.stopped)
      } catch {
        return
      }
      guard let self, !Task.isCancelled else { return }
      stoppedTask = nil
      pointerStopped(at: NSEvent.mouseLocation)
    }
  }

  private func pointerStopped(at screenPoint: CGPoint) {
    let tabID = eligibleTabID(at: screenPoint)
    let insideSafeHull = phase.tabID.map { isInsideSafeHull(screenPoint, for: $0) } ?? false
    apply(
      TerminalSidebarHoverInteraction.stopped(
        phase: phase,
        eligibleTabID: tabID,
        insideSafeHull: insideSafeHull,
        canReuseCard: presenter.frame != nil
      )
    )
  }

  private func apply(_ intent: TerminalSidebarHoverIntent) {
    switch intent {
    case .none:
      return
    case .replacePending(let tabID):
      beginPending(tabID)
    case .cancelPending:
      cancelPendingPresentation()
    case .cancelDismiss:
      cancelDismiss()
    case .rearmDismiss:
      scheduleDismiss()
    case .startCold(let tabID):
      beginPending(tabID)
      schedulePresentation(for: tabID, after: TerminalSidebarHoverTiming.coldPresentation)
    case .reuse(let tabID):
      reusePresentedCard(tabID)
    case .present(let tabID):
      cancelColdPresentation()
      if phase.tabID != tabID { beginPending(tabID) }
      present(tabID: tabID, generation: generation)
    case .update(let tabID):
      updatePresentedCard(to: tabID)
    case .delayUpdate(let tabID):
      schedulePresentedUpdate(to: tabID)
    case .dismiss:
      dismiss()
    }
  }

  private func scheduleDismiss() {
    guard case .presented = phase else { return }
    cancelDismiss()
    let phase = phase
    dismissTask = Task { [weak self] in
      do {
        try await Task.sleep(for: TerminalSidebarHoverTiming.dismiss)
      } catch {
        return
      }
      guard let self, !Task.isCancelled, self.phase == phase else { return }
      dismissTask = nil
      dismiss()
    }
  }

  private func reusePresentedCard(_ tabID: TerminalTabID) {
    guard allowsPresentation(), let source = sourceForTab(tabID),
      let sourceWindow = source.view.window, sourceWindow.isKeyWindow,
      let content = observedContent(for: tabID),
      presenter.update(content, sourceView: source.view, reduceMotion: reduceMotion())
    else {
      dismiss()
      return
    }
    phase = .presented(tabID)
    directionTracker.reset()
    installInputMonitor()
    installMovementMonitor()
    observe(sourceWindow)
    presentationChanged?()
  }

  private func schedulePresentedUpdate(to tabID: TerminalTabID) {
    guard case .presented = phase else { return }
    cancelDelayedUpdate()
    let phase = phase
    delayedUpdateTask = Task { [weak self] in
      do {
        try await Task.sleep(for: TerminalSidebarHoverTiming.coldPresentation)
      } catch {
        return
      }
      guard let self, !Task.isCancelled, self.phase == phase else { return }
      delayedUpdateTask = nil
      updatePresentedCard(to: tabID)
    }
  }

  private func cancelPendingPresentation() {
    guard case .pending = phase else { return }
    generation &+= 1
    cancelColdPresentation()
    cancelStopped()
    phase = .idle
    removeEventMonitors()
  }

  private func cancelColdPresentation() {
    coldPresentationTask?.cancel()
    coldPresentationTask = nil
  }

  private func cancelStopped() {
    stoppedTask?.cancel()
    stoppedTask = nil
  }

  private func cancelDismiss() {
    dismissTask?.cancel()
    dismissTask = nil
  }

  private func cancelDelayedUpdate() {
    delayedUpdateTask?.cancel()
    delayedUpdateTask = nil
  }

  private func installInputMonitor() {
    guard inputMonitor == nil else { return }
    inputMonitor = NSEvent.addLocalMonitorForEvents(
      matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown, .keyDown]
    ) { [weak self] event in
      MainActor.assumeIsolated {
        self?.handleInput(event)
      }
      return event
    }
  }

  private func installMovementMonitor() {
    guard movementMonitor == nil else { return }
    movementMonitor = NSEvent.addLocalMonitorForEvents(
      matching: [.mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged]
    ) { [weak self] event in
      MainActor.assumeIsolated {
        self?.moved(to: NSEvent.mouseLocation)
      }
      return event
    }
  }

  private func handleInput(_ event: NSEvent) {
    switch event.type {
    case .leftMouseDown, .rightMouseDown, .otherMouseDown:
      let screenPoint = NSEvent.mouseLocation
      switch TerminalSidebarHoverInputInteraction.mouseDown(
        phase: phase,
        pointedTabID: tabAtPoint(screenPoint),
        isInsideCard: presenter.frame?.containsClosed(screenPoint) == true
      ) {
      case .keep:
        return
      case .dismiss(let suppressedTabID):
        self.suppressedTabID = suppressedTabID
        dismiss()
      }
    case .keyDown:
      dismiss()
    default:
      break
    }
  }

  private func eligibleTabID(at screenPoint: CGPoint) -> TerminalTabID? {
    let pointedTabID = tabAtPoint(screenPoint)
    if pointedTabID != suppressedTabID {
      suppressedTabID = nil
    }
    guard
      let pointedTabID = TerminalSidebarHoverInteraction.eligibleTabID(
        pointedTabID: pointedTabID,
        screenPoint: screenPoint,
        cardFrame: presenter.frame
      ), pointedTabID != suppressedTabID
    else {
      return nil
    }
    return pointedTabID
  }

  private func observe(_ sourceWindow: NSWindow) {
    removeObservers()
    let center = NotificationCenter.default
    observers = [
      center.addObserver(
        forName: NSWindow.didResignKeyNotification,
        object: sourceWindow,
        queue: .main
      ) { [weak self] _ in
        MainActor.assumeIsolated { self?.dismiss() }
      },
      center.addObserver(
        forName: NSWindow.willCloseNotification,
        object: sourceWindow,
        queue: .main
      ) { [weak self] _ in
        MainActor.assumeIsolated { self?.dismiss() }
      },
      center.addObserver(
        forName: NSApplication.didResignActiveNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        MainActor.assumeIsolated { self?.dismiss() }
      },
    ]
  }

  private func removeEventMonitors() {
    if let inputMonitor {
      NSEvent.removeMonitor(inputMonitor)
      self.inputMonitor = nil
    }
    if let movementMonitor {
      NSEvent.removeMonitor(movementMonitor)
      self.movementMonitor = nil
    }
  }

  private func removeObservers() {
    for observer in observers {
      NotificationCenter.default.removeObserver(observer)
    }
    observers.removeAll()
  }
}

@MainActor
private final class TerminalSidebarHoverCardPresenter {
  private let window = TerminalSidebarHoverCardWindow()
  private var hostingController: NSHostingController<TerminalSidebarHoverCardView>?
  private weak var parentWindow: NSWindow?
  private var animationGeneration: UInt64 = 0

  var frame: CGRect? {
    window.isVisible ? window.frame : nil
  }

  func present(
    _ content: TerminalSidebarHoverCardContent,
    sourceView: NSView,
    reduceMotion: Bool
  ) -> CGRect? {
    apply(
      content,
      sourceView: sourceView,
      reduceMotion: reduceMotion,
      animated: true
    )
  }

  func update(
    _ content: TerminalSidebarHoverCardContent,
    sourceView: NSView,
    reduceMotion: Bool
  ) -> Bool {
    apply(
      content,
      sourceView: sourceView,
      reduceMotion: reduceMotion,
      animated: false
    ) != nil
  }

  private func apply(
    _ content: TerminalSidebarHoverCardContent,
    sourceView: NSView,
    reduceMotion: Bool,
    animated: Bool
  ) -> CGRect? {
    guard let sourceWindow = sourceView.window else { return nil }
    animationGeneration &+= 1
    let rootView = TerminalSidebarHoverCardView(content: content)
    let hostingController: NSHostingController<TerminalSidebarHoverCardView>
    if let current = self.hostingController {
      current.rootView = rootView
      hostingController = current
    } else {
      let current = NSHostingController(rootView: rootView)
      current.view.wantsLayer = true
      window.contentViewController = current
      self.hostingController = current
      hostingController = current
    }
    let visibleFrame =
      sourceWindow.screen?.visibleFrame ?? NSScreen.main?.visibleFrame
      ?? sourceWindow.frame
    let cardSize = hostingController.sizeThatFits(
      in: CGSize(
        width: TerminalSidebarHoverCardMetrics.width,
        height: max(120, visibleFrame.height - 16)
      )
    )
    guard
      let sourceFrame = TerminalSidebarHoverCardGeometry.screenFrame(of: sourceView),
      cardSize.width > 0,
      cardSize.height > 0
    else { return nil }
    let frame = TerminalSidebarHoverCardGeometry.frame(
      sourceFrame: sourceFrame,
      cardSize: cardSize,
      visibleFrame: visibleFrame
    )
    if parentWindow !== sourceWindow {
      parentWindow?.removeChildWindow(window)
      sourceWindow.addChildWindow(window, ordered: .above)
      parentWindow = sourceWindow
    }
    window.appearance = sourceWindow.appearance
    window.ignoresMouseEvents = false
    window.setFrame(frame, display: false)
    window.orderFront(nil)
    show(reduceMotion: reduceMotion, animated: animated)
    return frame
  }

  func dismiss(reduceMotion: Bool) {
    guard window.isVisible else { return }
    animationGeneration &+= 1
    let generation = animationGeneration
    guard !reduceMotion, let layer = hostingController?.view.layer else {
      close()
      return
    }
    window.ignoresMouseEvents = true
    layer.removeAllAnimations()
    let opacity = layer.presentation()?.opacity ?? layer.opacity
    let scale = layer.presentation()?.value(forKeyPath: "transform.scale") as? CGFloat ?? 1
    CATransaction.begin()
    CATransaction.setCompletionBlock { [weak self] in
      Task { @MainActor [weak self] in
        guard let self, animationGeneration == generation else { return }
        close()
      }
    }
    layer.opacity = 0
    layer.setValue(0.92, forKeyPath: "transform.scale")
    layer.add(
      TerminalLayerAnimation.basic(
        keyPath: "opacity",
        from: opacity,
        to: 0,
        duration: 0.1,
        timingFunction: CAMediaTimingFunction(controlPoints: 0.25, 0.46, 0.45, 0.94)
      ),
      forKey: "sidebarHoverCardOpacity"
    )
    layer.add(
      TerminalLayerAnimation.spring(
        keyPath: "transform.scale",
        from: scale,
        to: 0.92,
        spring: TerminalLayerSpring(response: 0.2, dampingRatio: 0.6)
      ),
      forKey: "sidebarHoverCardScale"
    )
    CATransaction.commit()
  }

  private func show(reduceMotion: Bool, animated: Bool) {
    guard let layer = hostingController?.view.layer else { return }
    layer.removeAllAnimations()
    layer.opacity = 1
    layer.setValue(1, forKeyPath: "transform.scale")
    guard animated, !reduceMotion else { return }
    layer.add(
      TerminalLayerAnimation.basic(
        keyPath: "opacity",
        from: 0,
        to: 1,
        duration: 0.1,
        timingFunction: CAMediaTimingFunction(controlPoints: 0.25, 0.46, 0.45, 0.94)
      ),
      forKey: "sidebarHoverCardOpacity"
    )
    layer.add(
      TerminalLayerAnimation.spring(
        keyPath: "transform.scale",
        from: 0.92,
        to: 1,
        spring: TerminalLayerSpring(response: 0.25, dampingRatio: 0.75)
      ),
      forKey: "sidebarHoverCardScale"
    )
  }

  private func close() {
    hostingController?.view.layer?.removeAllAnimations()
    parentWindow?.removeChildWindow(window)
    window.orderOut(nil)
    window.ignoresMouseEvents = false
    parentWindow = nil
  }
}

@MainActor
private final class TerminalSidebarHoverCardWindow: NSWindow {
  init() {
    super.init(
      contentRect: .zero,
      styleMask: .borderless,
      backing: .buffered,
      defer: false
    )
    isOpaque = false
    backgroundColor = .clear
    hasShadow = true
    isReleasedWhenClosed = false
    acceptsMouseMovedEvents = true
    collectionBehavior = [.transient, .ignoresCycle]
  }

  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
}

struct TerminalSidebarHoverCardView: View {
  private let content: TerminalSidebarHoverCardContent
  private let response: AttributedString?
  private let responseHeight: CGFloat?

  @MainActor
  init(content: TerminalSidebarHoverCardContent) {
    self.content = content
    let response = content.response.map {
      (try? AttributedString(markdown: $0.text)) ?? AttributedString($0.text)
    }
    self.response = response
    responseHeight = response.map(TerminalSidebarHoverCardMetrics.responseHeight)
  }

  var body: some View {
    PopoverSurface(
      theme: .system,
      style: SurfaceCardStyle(
        background: .material,
        corners: SurfaceCorners(10),
        borderWidth: 0.5,
        shadowRadius: 0,
        shadowY: 0
      ),
      contentPadding: 0
    ) {
      VStack(alignment: .leading, spacing: 10) {
        Text(content.tabTitle)
          .font(.system(size: 13, weight: .medium))
          .fixedSize(horizontal: false, vertical: true)

        if content.branch != nil || content.workingDirectoryPath != nil {
          VStack(alignment: .leading, spacing: 8) {
            if let branch = content.branch {
              TerminalSidebarHoverCardActionRow(
                icon: .asset("git-branch"),
                title: branch.name,
                action: .copy(branch.name),
                accessibilityName: "branch"
              )
              if let pullRequest = branch.pullRequest {
                TerminalSidebarHoverCardActionRow(
                  icon: pullRequest.icon,
                  title: pullRequest.title,
                  action: .pullRequest(pullRequest),
                  accessibilityName: "pull request"
                )
              }
            }
            if let workingDirectoryPath = content.workingDirectoryPath {
              TerminalSidebarHoverCardActionRow(
                icon: .system("folder"),
                title: (workingDirectoryPath as NSString).abbreviatingWithTildeInPath,
                action: .copy(workingDirectoryPath),
                accessibilityName: "working directory",
                truncationMode: .middle
              )
            }
          }
        }

        if let agentName = content.response?.agent.displayName,
          let response,
          let responseHeight
        {
          Text("\(agentName) · Latest response")
            .font(.system(size: 12))
            .foregroundStyle(.secondary)
            .lineLimit(1)
          Divider()
          ScrollView {
            TerminalSidebarHoverCardResponseView(response: response)
          }
          .frame(height: responseHeight)
        }
      }
      .padding(.horizontal, TerminalSidebarHoverCardMetrics.horizontalPadding)
      .padding(.vertical, 16)
      .frame(width: TerminalSidebarHoverCardMetrics.width, alignment: .leading)
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Tab details for \(content.tabTitle)")
  }
}

enum TerminalSidebarHoverCardRowAction {
  case copy(String)
  case open(URL)

  static func pullRequest(_ pullRequest: TerminalTabAgentWorkspace.PullRequest) -> Self {
    guard let url = pullRequest.url else { return .copy(pullRequest.title) }
    return .open(url)
  }

  @MainActor
  func perform(
    clipboardClient: ClipboardClient,
    externalNavigationClient: ExternalNavigationClient
  ) {
    switch self {
    case .copy(let value):
      clipboardClient.copyString(value)
    case .open(let url):
      _ = externalNavigationClient.open(url)
    }
  }

  var verb: String {
    switch self {
    case .copy:
      "Copy"
    case .open:
      "Open"
    }
  }

  var copyValue: String? {
    guard case .copy(let value) = self else { return nil }
    return value
  }
}

private struct TerminalSidebarHoverCardActionRow: View {
  @Dependency(ClipboardClient.self) private var clipboardClient
  @Dependency(ExternalNavigationClient.self) private var externalNavigationClient
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  let icon: TerminalMetadataIcon
  let title: String
  let action: TerminalSidebarHoverCardRowAction
  let accessibilityName: String
  var truncationMode: Text.TruncationMode = .tail

  @State private var isHovering = false
  @State private var copyFeedbackID: UUID?

  var body: some View {
    Button(action: perform) {
      HStack(spacing: 8) {
        iconView
        Text(copyFeedbackID == nil ? title : "Copied")
          .font(.system(size: 12))
          .lineLimit(1)
          .truncationMode(truncationMode)
          .contentTransition(.opacity)
        Spacer(minLength: 0)
      }
      .frame(maxWidth: .infinity, minHeight: 16, alignment: .leading)
      .contentShape(.rect)
      .background {
        RoundedRectangle(cornerRadius: 5)
          .fill(isHovering ? Color.primary.opacity(0.08) : .clear)
          .padding(.vertical, -4)
          .padding(.horizontal, -5)
      }
    }
    .buttonStyle(.plain)
    .foregroundStyle(isHovering ? .primary : .secondary)
    .onHover { isHovering = $0 }
    .help("\(action.verb) \(accessibilityName)")
    .accessibilityLabel(
      copyFeedbackID == nil ? "\(action.verb) \(accessibilityName)" : "Copied"
    )
    .accessibilityValue(copyFeedbackID == nil ? action.copyValue ?? title : "")
    .task(id: copyFeedbackID) {
      guard let feedbackID = copyFeedbackID else { return }
      do {
        try await Task.sleep(for: .seconds(1))
      } catch {
        return
      }
      guard copyFeedbackID == feedbackID else { return }
      TerminalMotion.animate(.easeInOut(duration: 0.15), reduceMotion: reduceMotion) {
        copyFeedbackID = nil
      }
    }
  }

  private func perform() {
    action.perform(
      clipboardClient: clipboardClient,
      externalNavigationClient: externalNavigationClient
    )
    guard action.copyValue != nil else { return }
    TerminalMotion.animate(.easeInOut(duration: 0.15), reduceMotion: reduceMotion) {
      copyFeedbackID = UUID()
    }
  }

  private var iconView: some View {
    Group {
      if isHovering {
        switch action {
        case .copy:
          Image("copy")
            .renderingMode(.template)
            .resizable()
            .aspectRatio(contentMode: .fit)
            .frame(width: 12, height: 12)
            .accessibilityHidden(true)
        case .open:
          Image(systemName: "arrow.up.right")
            .font(.system(size: 9, weight: .bold))
            .accessibilityHidden(true)
        }
      } else {
        switch icon {
        case .asset(let name):
          Image(name)
            .renderingMode(.template)
            .resizable()
            .aspectRatio(contentMode: .fit)
            .frame(width: 13, height: 13)
            .accessibilityHidden(true)
        case .system(let name):
          Image(systemName: name)
            .font(.system(size: 11, weight: .medium))
            .accessibilityHidden(true)
        }
      }
    }
    .frame(width: 14)
  }
}

private struct TerminalSidebarHoverCardResponseView: View {
  let response: AttributedString

  var body: some View {
    Text(response)
      .font(.system(size: 13))
      .frame(maxWidth: .infinity, alignment: .leading)
      .fixedSize(horizontal: false, vertical: true)
      .textSelection(.enabled)
  }
}

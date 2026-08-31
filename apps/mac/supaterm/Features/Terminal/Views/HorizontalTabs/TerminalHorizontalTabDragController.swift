import AppKit

enum TerminalHorizontalTabDragSourcePhase: Equatable {
  case idle
  case pending(TerminalSidebarEntryID)
  case active(TerminalSidebarEntryID)
  case failed(TerminalSidebarEntryID)
}

@MainActor
final class TerminalHorizontalTabDragController {
  struct Configuration {
    let sourceView: NSView
    let draggingSource: any NSDraggingSource
    let windowControllerID: UUID
    let tabDragRegistry: TerminalTabDragRegistry
    let nativeStart: TerminalTabNativeDragSession.NativeStart
    let captureRequest: () -> TerminalWindowCaptureRequest?
    let snapshot: () -> TerminalTabSurfaceSnapshot?
    let layout: () -> TerminalHorizontalTabLayout?
    let reduceMotion: () -> Bool
    let shouldPlayTabMoveHaptics: () -> Bool
    let liveSelectedTabID: () -> TerminalTabID?
    let tabSelectionState: () -> TerminalTabSelectionState?
    let selectTab: (TerminalTabID) -> Void
    let toggleGroup: (TerminalTabGroupID) -> Void
    let performDrop: (TerminalSidebarDropCommand) -> TerminalSidebarDropReceipt?
    let sourceViews: (TerminalSidebarDragSource) -> [NSView]
    let settlementFrame: (TerminalSidebarEntryID) -> CGRect?
    let setDropPlan: (TerminalSidebarDropPlan?) -> Void
    let projectionReleased: () -> Void
  }

  private struct PendingSource {
    let interaction: TerminalSidebarPendingDrag
    let payload: TerminalSidebarDragPayload
  }

  private struct ActiveSource {
    var shared: TerminalSidebarActiveDrag
    let payload: TerminalTabDragPayload
    let anchorEntryID: TerminalSidebarEntryID
    var frozenPlan: TerminalSidebarDropPlan?
    var isCommitting = false
    var cleanupStarted = false
    var velocityTracker: TerminalSidebarDragVelocityTracker

    var entryID: TerminalSidebarEntryID {
      anchorEntryID
    }
  }

  private enum SourceState {
    case idle
    case pending(PendingSource)
    case active(ActiveSource)
    case failed(TerminalSidebarEntryID)
  }

  private enum DestinationSource {
    case local(TerminalSidebarDragPayload)
    case external(TerminalSidebarTopologyStamp)
  }

  private struct DestinationSession {
    let payload: TerminalTabDragPayload
    let source: DestinationSource
    var dropTarget = TerminalSidebarDragTargetState.none
    var frozenPlan: TerminalSidebarDropPlan?

    func matches(
      payload: TerminalTabDragPayload,
      topologyStamp: TerminalSidebarTopologyStamp
    ) -> Bool {
      guard self.payload == payload else { return false }
      switch source {
      case .local(let sourcePayload):
        return sourcePayload.topologyStamp == topologyStamp
      case .external(let sourceTopologyStamp):
        return sourceTopologyStamp == topologyStamp
      }
    }
  }

  private let configuration: Configuration
  private let presentation: TerminalHorizontalTabDragPresentation
  private var sourceState = SourceState.idle
  private var destinationSession: DestinationSession?
  private var hapticTracker = TerminalSidebarHapticTargetTracker()

  private lazy var nativeDragSession = TerminalTabNativeDragSession(
    sourceView: configuration.sourceView,
    draggingSource: configuration.draggingSource,
    sourceSurfaceView: configuration.sourceView,
    registry: configuration.tabDragRegistry,
    captureClient: .live,
    captureRequest: configuration.captureRequest,
    nativeStart: configuration.nativeStart
  )

  init(configuration: Configuration) {
    self.configuration = configuration
    presentation = TerminalHorizontalTabDragPresentation(
      containerView: configuration.sourceView
    )
  }

  var sourcePhase: TerminalHorizontalTabDragSourcePhase {
    switch sourceState {
    case .idle:
      .idle
    case .pending(let source):
      .pending(source.interaction.entryID)
    case .active(let source):
      .active(source.entryID)
    case .failed(let entryID):
      .failed(entryID)
    }
  }

  var activeCoordinatorPhase: TerminalSidebarDragCoordinator.Phase? {
    guard case .active(let source) = sourceState else { return nil }
    return source.shared.coordinator.phase
  }

  var activePayload: TerminalTabDragPayload? {
    guard case .active(let source) = sourceState else { return nil }
    return source.payload
  }

  var sourceHoldScreenFrame: CGRect {
    presentation.sourceHoldScreenFrame()
  }

  var cleanupCount: Int {
    presentation.cleanupCount
  }

  var hasSourcePlaceholder: Bool {
    presentation.isActive
  }

  var hiddenSourceViewCount: Int {
    presentation.hiddenViewCount
  }

  func press(
    entryID: TerminalSidebarEntryID,
    location: CGPoint,
    modifiers: NSEvent.ModifierFlags,
    clickCount: Int
  ) {
    guard clickCount == 1 else { return }
    if case .active = sourceState { return }
    cancelPendingSource(restoringSelection: false)
    beginPendingSource(
      entryID: entryID,
      location: location,
      modifiers: modifiers
    )
  }

  func drag(
    entryID: TerminalSidebarEntryID,
    location: CGPoint,
    screenPoint: CGPoint,
    nativeEvent: NSEvent?
  ) -> Bool {
    guard case .pending(let source) = sourceState,
      source.interaction.entryID == entryID
    else {
      if case .failed(let failedEntryID) = sourceState, failedEntryID == entryID {
        return true
      }
      return false
    }
    guard
      TerminalSidebarDragActivation.decision(
        origin: source.interaction.origin,
        location: location
      ) == .begin
    else { return false }
    beginActiveSource(
      source,
      pointer: location,
      screenPoint: screenPoint,
      nativeEvent: nativeEvent
    )
    return true
  }

  func release(entryID: TerminalSidebarEntryID, location: CGPoint) {
    switch sourceState {
    case .pending(let source) where source.interaction.entryID == entryID:
      nativeDragSession.cancelSourceCapture()
      sourceState = .idle
      switch entryID {
      case .group(let groupID):
        if configuration.layout()?.items.first(where: { $0.entryID == entryID })?.frame
          .contains(location) == true
        {
          configuration.toggleGroup(groupID)
        }
      case .tab:
        resolveDeferredSelection(source.interaction)
      case .newTab, .pinDivider:
        break
      }
    case .failed(let failedEntryID) where failedEntryID == entryID:
      sourceState = .idle
    case .idle, .pending, .active, .failed:
      break
    }
  }

  func receive(_ snapshot: TerminalTabSurfaceSnapshot) -> Bool {
    let incomingStamp = TerminalSidebarOutline(snapshot: snapshot).topologyStamp
    switch sourceState {
    case .idle:
      return false
    case .pending(let source):
      if incomingStamp == source.payload.topologyStamp,
        let appliedSnapshot = configuration.snapshot(),
        TerminalSidebarOutline(snapshot: snapshot).roots
          == TerminalSidebarOutline(snapshot: appliedSnapshot).roots
      {
        return false
      }
      cancelPendingSource(restoringSelection: false)
      return false
    case .failed:
      sourceState = .idle
      return false
    case .active(var source):
      if acceptsTopologyChange(incomingStamp, source: source) { return true }
      guard let appliedSnapshot = configuration.snapshot() else { return true }
      let disposition = TerminalSidebarDragOutlineDisposition.tracking(
        incoming: TerminalSidebarOutline(snapshot: snapshot),
        applied: TerminalSidebarOutline(snapshot: appliedSnapshot),
        sourceTopologyStamp: source.shared.payload.topologyStamp
      )
      switch disposition {
      case .unchanged:
        if case .tracking = source.shared.coordinator.phase { return false }
        return true
      case .queue:
        return true
      case .replaceAndCancel:
        source.shared.coordinator.cancel(topologyChanged: true)
        endSourceTarget(&source)
        sourceState = .active(source)
        return true
      case .inactive:
        return true
      }
    }
  }

  func updateDrop(
    _ payload: TerminalTabDragPayload,
    at point: CGPoint
  ) -> NSDragOperation {
    guard
      configuration.tabDragRegistry.activePayload == payload,
      let snapshot = configuration.snapshot(),
      let layout = configuration.layout()
    else {
      clearDestination()
      return []
    }
    if case .active(var source) = sourceState, source.payload == payload {
      guard case .tracking = source.shared.coordinator.phase else { return [] }
      let resolution = TerminalSidebarDropResolution(
        payload: source.shared.payload,
        path: layout.semanticPath(at: point, source: source.shared.payload.source),
        outline: TerminalSidebarOutline(snapshot: snapshot)
      )
      let accepted = transitionSourceTarget(&source, resolution: resolution)
      sourceState = .active(source)
      return accepted ? .move : []
    }
    return updateDestination(payload, at: point, snapshot: snapshot, layout: layout)
  }

  func draggingExited() {
    if case .active(var source) = sourceState,
      case .tracking = source.shared.coordinator.phase
    {
      endSourceTarget(&source)
      sourceState = .active(source)
      return
    }
    clearDestination()
  }

  func destinationDraggingEnded() {
    draggingExited()
  }

  func prepareDrop(_ payload: TerminalTabDragPayload) -> Bool {
    if case .active(var source) = sourceState, source.payload == payload {
      guard
        source.shared.dropTarget.acceptsDrop,
        let plan = source.shared.dropTarget.plan,
        source.shared.coordinator.freeze(plan) != nil
      else { return false }
      source.frozenPlan = plan
      sourceState = .active(source)
      return true
    }
    guard var destinationSession,
      destinationSession.payload == payload,
      let plan = destinationSession.dropTarget.plan
    else { return false }
    destinationSession.frozenPlan = plan
    self.destinationSession = destinationSession
    return true
  }

  func performDrop(_ payload: TerminalTabDragPayload) -> Bool {
    if case .active(let source) = sourceState, source.payload == payload {
      if case .tracking = source.shared.coordinator.phase,
        !prepareDrop(payload)
      {
        return false
      }
      guard case .active(var preparedSource) = sourceState,
        preparedSource.payload == payload,
        let command = preparedSource.shared.coordinator.command
      else { return false }
      preparedSource.isCommitting = true
      sourceState = .active(preparedSource)
      let receipt = configuration.performDrop(command)
      guard case .active(var completedSource) = sourceState,
        completedSource.payload == payload
      else { return false }
      completedSource.isCommitting = false
      let completed = completedSource.shared.coordinator.complete(receipt)
      sourceState = .active(completedSource)
      return completed && receipt != nil
    }
    guard var destinationSession, destinationSession.payload == payload else { return false }
    if destinationSession.frozenPlan == nil {
      guard prepareDrop(payload), let prepared = self.destinationSession else { return false }
      destinationSession = prepared
    }
    guard
      let plan = destinationSession.frozenPlan,
      let snapshot = configuration.snapshot()
    else { return false }
    let outline = TerminalSidebarOutline(snapshot: snapshot)
    let accepted: Bool
    switch destinationSession.source {
    case .local(let sourcePayload):
      guard sourcePayload.topologyStamp == outline.topologyStamp,
        let command = plan.command(for: sourcePayload)
      else {
        clearDestination()
        return false
      }
      accepted = configuration.performDrop(command) != nil
    case .external(let topologyStamp):
      let drop = TerminalSidebarExternalDrop(
        payload: payload,
        topologyStamp: topologyStamp,
        target: plan
      )
      guard let command = drop.command(in: outline) else {
        clearDestination()
        return false
      }
      accepted =
        configuration.tabDragRegistry.performTransfer(
          payload,
          to: TerminalTabDragRegistry.Destination(
            windowControllerID: configuration.windowControllerID,
            spaceID: command.topologyStamp.spaceID,
            expectedTopologyRevision: command.topologyStamp.revision,
            placement: command.destination
          )
        ) != nil
    }
    clearDestination()
    return accepted
  }

  func sourceSessionMoved(to screenPoint: CGPoint) {
    guard case .active(var source) = sourceState else { return }
    switch source.shared.coordinator.phase {
    case .cancelled, .settling, .finished:
      return
    case .tracking, .frozen, .awaitingNativeEnd:
      break
    }
    source.velocityTracker.update(
      point: screenPoint,
      timestamp: ProcessInfo.processInfo.systemUptime
    )
    sourceState = .active(source)
    let presentationState = nativeDragSession.move(
      to: screenPoint,
      sourceSurfaceFrame: presentation.sourceHoldScreenFrame()
    )
    guard case .active(let current) = sourceState else { return }
    switch current.shared.coordinator.phase {
    case .cancelled, .settling, .finished:
      return
    case .tracking, .frozen, .awaitingNativeEnd:
      break
    }
    presentation.move(to: screenPoint, state: presentationState)
  }

  func sourceSessionEnded(operation _: NSDragOperation) {
    clearDestination()
    guard case .active(var source) = sourceState else { return }
    endSourceTarget(&source)
    if source.shared.externalSourceDisposition != nil,
      case .tracking = source.shared.coordinator.phase
    {
      sourceState = .active(source)
      settleSource(
        operationID: source.shared.payload.operationID,
        outcome: .moved,
        destination: nil
      )
      return
    }
    let settlement = source.shared.coordinator.nativeEnded()
    sourceState = .active(source)
    switch settlement {
    case .accepted:
      let destination = configuration.settlementFrame(source.entryID).map {
        CGPoint(x: $0.midX, y: $0.midY)
      }
      settleSource(
        operationID: source.shared.payload.operationID,
        outcome: .moved,
        destination: destination
      )
    case .rejected:
      settleSource(
        operationID: source.shared.payload.operationID,
        outcome: .cancelled,
        destination: nil
      )
    case nil:
      break
    }
  }

  func cancelInteractions() {
    clearDestination()
    switch sourceState {
    case .idle:
      nativeDragSession.cancelSourceCapture()
    case .pending:
      cancelPendingSource(restoringSelection: true)
    case .failed:
      nativeDragSession.cancelSourceCapture()
      sourceState = .idle
    case .active(var source):
      source.shared.coordinator.cancel(topologyChanged: false)
      sourceState = .active(source)
      finishSource(
        operationID: source.shared.payload.operationID,
        outcome: .cancelled,
        failedEntryID: nil
      )
    }
  }

  private func beginPendingSource(
    entryID: TerminalSidebarEntryID,
    location: CGPoint,
    modifiers: NSEvent.ModifierFlags
  ) {
    guard
      let snapshot = configuration.snapshot(),
      let layout = configuration.layout(),
      layout.dragSourceFrame(for: entryID) != nil
    else {
      sourceState = .failed(entryID)
      return
    }
    let outline = TerminalSidebarOutline(snapshot: snapshot)
    let primaryTabID = configuration.liveSelectedTabID()
    let selection: TerminalTabSelectionPress
    switch entryID {
    case .tab(let tabID):
      guard let selectionState = configuration.tabSelectionState() else {
        sourceState = .failed(entryID)
        return
      }
      selection = TerminalTabSelectionInteraction.press(
        tabID: tabID,
        modifiers: modifiers,
        context: TerminalTabSelectionContext(
          primaryTabID: primaryTabID,
          visibleTabIDs: outline.visibleTabIDs,
          state: selectionState
        ),
        selectPrimary: configuration.selectTab
      )
    case .group:
      configuration.tabSelectionState()?.clear()
      selection = .empty
    case .newTab, .pinDivider:
      sourceState = .failed(entryID)
      return
    }
    guard
      let payload = outline.dragPayload(
        for: entryID,
        selectedTabIDs: selection.selectedTabIDs
      )
    else {
      sourceState = .failed(entryID)
      return
    }
    let handoff = TerminalSidebarTabDragSelectionHandoff.resolve(
      entryID: entryID,
      primaryTabID: primaryTabID,
      modifiers: modifiers,
      selectedTabIDs: selection.selectedTabIDs
    )
    let pending = PendingSource(
      interaction: TerminalSidebarPendingDrag(
        entryID: entryID,
        origin: location,
        selectedTabIDs: selection.selectedTabIDs,
        defersSelection: selection.defersSelection,
        selectionHandoff: handoff
      ),
      payload: payload
    )
    let previewSize =
      configuration.sourceView.window.map {
        TerminalTabDragPreviewLayout.sourceContentSize(for: $0.frame)
      } ?? configuration.sourceView.bounds.size
    guard
      nativeDragSession.prepareSourceCapture(
        previewContentSize: previewSize
      )
    else {
      sourceState = .failed(entryID)
      return
    }
    sourceState = .pending(pending)
  }

  private func beginActiveSource(
    _ pending: PendingSource,
    pointer: CGPoint,
    screenPoint: CGPoint,
    nativeEvent: NSEvent?
  ) {
    restoreSelectionHandoff(pending.interaction)
    hapticTracker.reset()
    guard
      case .pending(let current) = sourceState,
      current.payload.operationID == pending.payload.operationID,
      let snapshot = configuration.snapshot(),
      let layout = configuration.layout(),
      TerminalSidebarOutline(snapshot: snapshot).topologyStamp == pending.payload.topologyStamp,
      let sourceFrame = layout.dragSourceFrame(for: pending.interaction.entryID),
      let payload = TerminalTabDragPayload(
        operationID: pending.payload.operationID,
        sourceWindowID: configuration.windowControllerID,
        sourceSpaceID: pending.payload.topologyStamp.spaceID,
        sourceTopologyRevision: pending.payload.topologyStamp.revision,
        itemIDs: pending.payload.source.itemIDs
      )
    else {
      nativeDragSession.cancelSourceCapture()
      resolveDeferredSelection(pending.interaction)
      sourceState = .failed(pending.interaction.entryID)
      return
    }
    let liftedEntryIDs = TerminalSidebarOutline(snapshot: snapshot).liftedEntryIDs(
      for: pending.payload.source
    )
    guard
      nativeDragSession.register(
        payload,
        didTransfer: { [weak self] operationID, disposition in
          self?.externalTransferDidComplete(operationID, disposition: disposition)
        }
      )
    else {
      resolveDeferredSelection(pending.interaction)
      sourceState = .failed(pending.interaction.entryID)
      return
    }
    guard
      presentation.begin(
        sourceFrame: sourceFrame,
        hotspot: CGPoint(x: pointer.x - sourceFrame.minX, y: pointer.y - sourceFrame.minY),
        hiddenViews: configuration.sourceViews(pending.payload.source),
        reduceMotion: configuration.reduceMotion()
      )
    else {
      nativeDragSession.finish(operationID: pending.payload.operationID, outcome: .cancelled)
      resolveDeferredSelection(pending.interaction)
      sourceState = .failed(pending.interaction.entryID)
      return
    }
    sourceState = .active(
      ActiveSource(
        shared: TerminalSidebarActiveDrag(
          payload: pending.payload,
          liftedEntryIDs: liftedEntryIDs,
          coordinator: TerminalSidebarDragCoordinator(payload: pending.payload)
        ),
        payload: payload,
        anchorEntryID: pending.interaction.entryID,
        frozenPlan: nil,
        velocityTracker: velocityTracker(
          point: screenPoint,
          timestamp: ProcessInfo.processInfo.systemUptime
        )
      )
    )
    let state = nativeDragSession.move(
      to: screenPoint,
      sourceSurfaceFrame: presentation.sourceHoldScreenFrame()
    )
    guard case .active(let current) = sourceState,
      current.shared.payload.operationID == pending.payload.operationID,
      configuration.tabDragRegistry.activePayload == payload
    else { return }
    presentation.move(to: screenPoint, state: state)
    guard
      nativeDragSession.beginDraggingSession(
        payload: payload,
        frame: sourceFrame,
        event: nativeEvent
      )
    else {
      resolveDeferredSelection(pending.interaction)
      finishSource(
        operationID: pending.payload.operationID,
        outcome: .cancelled,
        failedEntryID: pending.interaction.entryID
      )
      return
    }
  }

  private func updateDestination(
    _ payload: TerminalTabDragPayload,
    at point: CGPoint,
    snapshot: TerminalTabSurfaceSnapshot,
    layout: TerminalHorizontalTabLayout
  ) -> NSDragOperation {
    let outline = TerminalSidebarOutline(snapshot: snapshot)
    guard let topologyStamp = outline.topologyStamp else {
      clearDestination()
      return []
    }
    let source: DestinationSource
    let sidebarPayload: TerminalSidebarDragPayload
    if case .rootItems = payload.source,
      payload.sourceWindowID == configuration.windowControllerID,
      payload.sourceSpaceID == topologyStamp.spaceID,
      payload.sourceTopologyRevision == topologyStamp.revision,
      let localPayload = payload.sidebarPayload(
        topologyStamp: TerminalSidebarTopologyStamp(
          spaceID: payload.sourceSpaceID,
          revision: payload.sourceTopologyRevision
        )
      )
    {
      source = .local(localPayload)
      sidebarPayload = localPayload
    } else {
      guard let externalPayload = payload.sidebarPayload(topologyStamp: topologyStamp) else {
        clearDestination()
        return []
      }
      source = .external(topologyStamp)
      sidebarPayload = externalPayload
    }
    if destinationSession?.matches(payload: payload, topologyStamp: topologyStamp) != true {
      clearDestination()
      destinationSession = DestinationSession(payload: payload, source: source)
    }
    guard var destinationSession, destinationSession.frozenPlan == nil else { return [] }
    let resolution = TerminalSidebarDropResolution(
      payload: sidebarPayload,
      path: layout.semanticPath(at: point, source: sidebarPayload.source),
      outline: outline
    )
    let decision = destinationSession.dropTarget.transition(
      TerminalSidebarDragTargetEvent(resolution)
    )
    self.destinationSession = destinationSession
    configuration.tabDragRegistry.setSidebarDestination(
      payload,
      windowControllerID: configuration.windowControllerID,
      isActive: true
    )
    applyTargetDecision(decision)
    return destinationSession.dropTarget.acceptsDrop ? .move : []
  }

  private func transitionSourceTarget(
    _ source: inout ActiveSource,
    resolution: TerminalSidebarDropResolution
  ) -> Bool {
    let decision = source.shared.dropTarget.transition(TerminalSidebarDragTargetEvent(resolution))
    configuration.tabDragRegistry.setSidebarDestination(
      source.payload,
      windowControllerID: configuration.windowControllerID,
      isActive: true
    )
    applyTargetDecision(decision)
    return source.shared.dropTarget.acceptsDrop
  }

  private func applyTargetDecision(_ decision: TerminalSidebarDragTargetDecision) {
    switch decision.haptic {
    case .none:
      break
    case .update(let path):
      if hapticTracker.shouldPerform(for: path), configuration.shouldPlayTabMoveHaptics() {
        NSHapticFeedbackManager.defaultPerformer.perform(.generic, performanceTime: .now)
      }
    case .reset:
      hapticTracker.reset()
    }
    switch decision.target {
    case .retain, .unchanged:
      break
    case .update(let plan):
      configuration.setDropPlan(plan)
    case .clear:
      configuration.setDropPlan(nil)
    }
  }

  private func endSourceTarget(_ source: inout ActiveSource) {
    let decision = source.shared.dropTarget.transition(.ended)
    configuration.tabDragRegistry.setSidebarDestination(
      source.payload,
      windowControllerID: configuration.windowControllerID,
      isActive: false
    )
    applyTargetDecision(decision)
  }

  private func clearDestination() {
    if let payload = destinationSession?.payload {
      configuration.tabDragRegistry.setSidebarDestination(
        payload,
        windowControllerID: configuration.windowControllerID,
        isActive: false
      )
    }
    destinationSession = nil
    hapticTracker.reset()
    configuration.setDropPlan(nil)
  }

  private func externalTransferDidComplete(
    _ operationID: TerminalTabMoveOperationID,
    disposition: TerminalTabDragRegistry.SourceDisposition
  ) {
    guard case .active(var source) = sourceState,
      source.shared.completeExternal(
        operationID: operationID,
        sourceDisposition: disposition
      )
    else { return }
    sourceState = .active(source)
  }

  private func acceptsTopologyChange(
    _ incomingStamp: TerminalSidebarTopologyStamp?,
    source: ActiveSource
  ) -> Bool {
    guard let incomingStamp else { return false }
    if source.isCommitting || source.shared.externalSourceDisposition != nil { return true }
    guard
      case .awaitingNativeEnd(_, let receipt?) = source.shared.coordinator.phase
    else { return false }
    return incomingStamp.spaceID == receipt.topologyStamp.spaceID
      && incomingStamp.revision >= receipt.topologyStamp.revision
  }

  private func settleSource(
    operationID: TerminalTabMoveOperationID,
    outcome: TerminalTabDragRegistry.Outcome,
    destination: CGPoint?
  ) {
    guard case .active(let source) = sourceState,
      source.shared.payload.operationID == operationID
    else { return }
    guard let destination else {
      finishSource(operationID: operationID, outcome: outcome, failedEntryID: nil)
      return
    }
    presentation.settle(
      at: destination,
      velocity: source.velocityTracker.velocity,
      reduceMotion: configuration.reduceMotion()
    ) { [weak self] in
      self?.finishSource(operationID: operationID, outcome: outcome, failedEntryID: nil)
    }
  }

  private func finishSource(
    operationID: TerminalTabMoveOperationID,
    outcome: TerminalTabDragRegistry.Outcome,
    failedEntryID: TerminalSidebarEntryID?
  ) {
    guard case .active(var source) = sourceState,
      source.shared.payload.operationID == operationID,
      !source.cleanupStarted
    else { return }
    source.cleanupStarted = true
    source.shared.coordinator.finish()
    sourceState = .active(source)
    presentation.cleanup()
    nativeDragSession.finish(operationID: operationID, outcome: outcome)
    sourceState = failedEntryID.map(SourceState.failed) ?? .idle
    hapticTracker.reset()
    configuration.setDropPlan(nil)
    configuration.projectionReleased()
  }

  private func cancelPendingSource(restoringSelection: Bool) {
    guard case .pending(let source) = sourceState else {
      if case .failed = sourceState { sourceState = .idle }
      return
    }
    if restoringSelection {
      restoreSelectionHandoff(source.interaction)
    }
    nativeDragSession.cancelSourceCapture()
    sourceState = .idle
  }

  private func restoreSelectionHandoff(_ pending: TerminalSidebarPendingDrag) {
    guard
      let handoff = pending.selectionHandoff,
      case .tab(let draggedTabID) = pending.entryID,
      let tabID = handoff.tabIDToRestore(
        draggedTabID: draggedTabID,
        liveSelectedTabID: configuration.liveSelectedTabID()
      )
    else { return }
    configuration.selectTab(tabID)
  }

  private func resolveDeferredSelection(_ pending: TerminalSidebarPendingDrag) {
    guard
      pending.defersSelection,
      case .tab(let tabID) = pending.entryID,
      let selectionState = configuration.tabSelectionState()
    else { return }
    TerminalTabSelectionInteraction.resolveDeferred(
      tabID: tabID,
      selectionState: selectionState,
      selectPrimary: configuration.selectTab
    )
  }

  private func velocityTracker(
    point: CGPoint,
    timestamp: TimeInterval
  ) -> TerminalSidebarDragVelocityTracker {
    var tracker = TerminalSidebarDragVelocityTracker()
    tracker.update(point: point, timestamp: timestamp)
    return tracker
  }
}
